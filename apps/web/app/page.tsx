"use client";

import {
  BigMetricCard,
  DivisionCard,
  Header,
  RankBadge,
  SectionHeader,
  TabNav,
  type Tab,
} from "@/components/ui";
import { canAccessTab, DEFAULT_SETTING, type Role } from "@dig/contracts";
import { promotionRate, promotionStepDual } from "@dig/core";
import { AccountsAdmin } from "@/components/accounts";
import { DiglossBank, FinanceConsole } from "@/components/bank";
import type { CurrentAccount } from "@/components/loan-thread";
import { LoanApply } from "@/components/loans-apply";
import { MemberMaster } from "@/components/masters";
import { BonusDig, ReleaseNotes, SettingsView, TransactionLog } from "@/components/modules";
import { PeriodClose } from "@/components/period-close";
import { FeatureRequests } from "@/components/requests";
import { RulesAndContracts } from "@/components/rules";
import { SalaryTable } from "@/components/salary-table";
import { apiGet, apiSend } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { man, pct, promotionLabel, promotionStyle, rateColor } from "@/lib/format";
import {
  byDivisionOf,
  type Leg,
  MEMBERS,
  type MemberRow,
  totalsOf,
  YEAR_MONTH,
} from "@/lib/mock";
import {
  currentYm,
  fiscalOf,
  monthLabel,
  monthsOfQuarter,
  quarterLabelOf,
  quarterOptions,
} from "@/lib/period";
import { buildMembersFromDb, type EvaluationDto, type MemberDto } from "@/lib/evaluations";

const TABS: Tab[] = [
  { key: "monitor", label: "予実モニター", sub: "毎日更新" },
  { key: "members", label: "メンバー評価", sub: "月次更新" },
  { key: "bank", label: "Digloss Bank", sub: "借入・返済" },
  { key: "borrow-apply", label: "借入申請", sub: "会社/相対" },
  { key: "finance", label: "金融管理", sub: "承認・金利" },
  { key: "rules", label: "Dig獲得ルール", sub: "契約→Dig反映" },
  { key: "bonus", label: "ボーナスDig", sub: "都度更新" },
  { key: "txn", label: "取引ログ", sub: "都度更新" },
  { key: "master", label: "従業員マスタ", sub: "編集" },
  { key: "period-close", label: "期末処理", sub: "確定・承認・精算" },
  { key: "salary", label: "給与テーブル", sub: "全社統一" },
  { key: "accounts", label: "アカウント管理", sub: "権限" },
  { key: "requests", label: "改善リクエスト", sub: "投稿・対応" },
  { key: "release", label: "リリースノート", sub: "都度更新" },
  { key: "settings", label: "設定", sub: "マスタ" },
];

const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "USER"];

// ログイン中アカウント（本番は Supabase Auth 由来。デモはロール→代表アカウント）
const ACCOUNTS: Record<Role, CurrentAccount> = {
  SUPER_ADMIN: { id: "gou.ishii@dgloss.co.jp", name: "石井豪", personId: null, role: "SUPER_ADMIN" },
  ADMIN: { id: "kakehata@dgloss.co.jp", name: "掛端光", personId: "B0000064", role: "ADMIN" },
  USER: { id: "horikawa@dgloss.co.jp", name: "堀川璃歩", personId: "B0000097", role: "USER" },
};

export default function Page() {
  const [tab, setTab] = useState("monitor");
  const [leg, setLeg] = useState<Leg>("monthly");
  // ログイン中ロール（本番は Supabase Auth 由来。現状は切替で権限デモ）
  const [role, setRole] = useState<Role>("SUPER_ADMIN");
  const [unread, setUnread] = useState(0);
  // 対象月（YYYY-MM）。四半期/月セレクタで切替。
  // SSRとのhydration不一致を避けるため初期値は固定の YEAR_MONTH とし、
  // マウント後に現在月へ更新する（下の useEffect）。
  const [ym, setYm] = useState<string>(YEAR_MONTH);
  // 四半期リストの基準（選択で動かさず安定させるため ym とは別に保持）。
  const [anchorYm, setAnchorYm] = useState<string>(YEAR_MONTH);
  useEffect(() => {
    const cur = currentYm();
    setYm(cur);
    setAnchorYm(cur);
  }, []);
  // 予実モニター/メンバー評価の元データ。既定は mock、DB取得成功で実データへ差し替え。
  const [members, setMembers] = useState<MemberRow[]>(MEMBERS);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  // セレクタ用の四半期一覧（基準=現在月）と、対象月が属する四半期の3ヶ月。
  const quarters = useMemo(() => quarterOptions(anchorYm), [anchorYm]);
  const { fyYear, quarter } = useMemo(() => fiscalOf(ym), [ym]);
  const monthsInQuarter = useMemo(() => monthsOfQuarter(fyYear, quarter), [fyYear, quarter]);

  const account = ACCOUNTS[role];
  const t = useMemo(() => totalsOf(members, leg), [members, leg]);
  const divs = useMemo(() => byDivisionOf(members, leg), [members, leg]);

  // 未読数（iPhoneバッジ風）を取得
  const refreshUnread = useCallback(async () => {
    try {
      const u = await apiGet<{ total: number }>(`/api/loans/unread?accountId=${account.id}`);
      setUnread(u.total);
    } catch {
      setUnread(0);
    }
  }, [account.id]);
  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread]);

  // 実データ（評価）を取得。成功かつ1件以上なら実データ表示、失敗/0件は mock フォールバック。
  const loadMembers = useCallback(async () => {
    setSource("loading");
    try {
      const [evals, mem] = await Promise.all([
        apiGet<EvaluationDto[]>(`/api/evaluations?ym=${ym}`),
        apiGet<MemberDto[]>(`/api/members`),
      ]);
      if (Array.isArray(evals) && evals.length > 0) {
        setMembers(buildMembersFromDb(evals, mem ?? []));
        setSource("db");
      } else {
        setMembers(MEMBERS);
        setSource("mock");
      }
    } catch {
      setMembers(MEMBERS);
      setSource("mock");
    }
  }, [ym]);
  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  // 管理者操作: 在籍メンバーから対象月の評価台帳を生成（実データ化の初期投入）。
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  const generate = useCallback(async () => {
    setGenerating(true);
    setGenMsg(null);
    try {
      const r = await apiSend<{ created: number; skipped: number; total: number }>(
        "/api/evaluations/generate",
        "POST",
        { yearMonth: ym, actor: account.id },
      );
      setGenMsg(
        `${monthLabel(ym)}の評価台帳を生成しました: 新規 ${r.created} 件 / 既存 ${r.skipped} 件（対象 ${r.total} 名）`,
      );
      await loadMembers();
    } catch (e) {
      setGenMsg(`生成失敗: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [account.id, loadMembers, ym]);

  // ロールで表示可能なタブに絞り込み
  const visibleTabs = useMemo(() => TABS.filter((t) => canAccessTab(role, t.key)), [role]);
  const activeTab = canAccessTab(role, tab) ? tab : "monitor";

  // 未読バッジ: 借入申請（申請者）＋金融管理（承認者=SUPER_ADMIN）
  const badges: Record<string, number> = {
    "borrow-apply": unread,
    ...(role === "SUPER_ADMIN" ? { finance: unread } : {}),
  };

  return (
    <div className="min-h-screen bg-white">
      <Header role={role} onRoleChange={setRole} roles={ROLES} />
      <TabNav tabs={visibleTabs} active={activeTab} onSelect={setTab} badges={badges} />

      <main className="mx-auto max-w-[1200px] px-6 pb-20">
        {/* フィルタ行 */}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
          <span className="text-ink-muted">対象Q</span>
          <select
            value={quarterLabelOf(ym)}
            onChange={(e) => {
              const q = quarters.find((o) => o.label === e.target.value);
              if (q) setYm(monthsOfQuarter(q.fyYear, q.quarter)[0]);
            }}
            className="rounded-card border border-surface-border bg-white px-3 py-1.5 font-semibold"
          >
            {quarters.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="ml-2 text-ink-muted">対象月</span>
          <select
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            className="rounded-card border border-surface-border bg-white px-3 py-1.5 font-semibold"
          >
            {monthsInQuarter.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <span className="ml-2 text-ink-muted">集計</span>
          <div className="inline-flex rounded-card border border-surface-border bg-white p-0.5">
            {(["monthly", "cumulative"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLeg(l)}
                className={`rounded-[6px] px-3 py-1 text-sm font-semibold ${
                  leg === l ? "bg-brand-primary text-white" : "text-ink-muted"
                }`}
              >
                {l === "monthly" ? "単月" : "累計"}
              </button>
            ))}
          </div>
          <span
            className={`ml-auto rounded-pill px-2 py-0.5 text-xs font-bold ${
              source === "db"
                ? "bg-emerald-100 text-semantic-success"
                : source === "mock"
                  ? "bg-amber-100 text-semantic-warn"
                  : "bg-slate-100 text-ink-muted"
            }`}
          >
            {source === "db"
              ? "● DB接続（実データ）"
              : source === "mock"
                ? "○ モック表示（DB未接続／評価データなし）"
                : "接続中…"}
          </span>
          <span className="rounded-pill bg-amber-50 px-2 py-0.5 text-xs font-semibold text-semantic-warn">
            即時速報
          </span>
        </div>

        {/* 実データ化: 評価台帳が未生成のときの管理者向けアクション */}
        {source === "mock" && isAdmin && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <span className="text-semantic-warn">
              評価データが未生成のためサンプル表示中です。在籍メンバーの評価台帳（{quarterLabelOf(ym)} / {monthLabel(ym)}）を生成すると実データ表示に切り替わります。
            </span>
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="ml-auto shrink-0 rounded-card bg-brand-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              {generating ? "生成中…" : "実データを生成"}
            </button>
          </div>
        )}
        {genMsg && <div className="mt-2 text-xs text-ink-muted">{genMsg}</div>}

        {activeTab === "monitor" ? (
          <>
            {/* 全社 */}
            <SectionHeader title="全社" note={`${members.length}名の合計`} />
            <div className="grid gap-4 md:grid-cols-2">
              <BigMetricCard
                label="全社 実績Dig"
                value={man(t.actual)}
                rate={t.rate}
                budget={man(t.budget)}
                actual={man(t.actual)}
                diff={t.actual - t.budget}
                color="primary"
              />
              <BigMetricCard
                label="全社 インセンティブ（見込み）"
                value={man(t.incentive)}
                budget={man(t.budget)}
                actual={man(t.actual)}
                diff={t.actual - t.budget}
                color="accent"
              />
            </div>

            {/* 事業部別 */}
            <SectionHeader
              title="事業部別"
              note={`${divs.length}事業部（実績Dig / 達成率）`}
              accent="accent"
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {divs.map((d) => (
                <DivisionCard
                  key={d.division}
                  division={d.division}
                  value={man(d.actual)}
                  rate={d.rate}
                  budget={man(d.budget)}
                  diff={d.actual - d.budget}
                />
              ))}
            </div>

            {/* メンバー一覧（残高計算） */}
            <SectionHeader title="メンバー評価（残高計算）" note="予算Dig vs 実績Dig" />
            <MemberTable leg={leg} members={members} />
          </>
        ) : activeTab === "members" ? (
          <>
            <SectionHeader title="メンバー評価（残高計算）" note="予算Dig vs 実績Dig" />
            <MemberTable leg={leg} members={members} />
          </>
        ) : activeTab === "bank" ? (
          <DiglossBank />
        ) : activeTab === "borrow-apply" ? (
          <LoanApply account={account} onChanged={refreshUnread} />
        ) : activeTab === "finance" ? (
          <FinanceConsole account={account} onChanged={refreshUnread} />
        ) : activeTab === "rules" ? (
          <RulesAndContracts />
        ) : activeTab === "bonus" ? (
          <BonusDig />
        ) : activeTab === "txn" ? (
          <TransactionLog />
        ) : activeTab === "master" ? (
          <MemberMaster />
        ) : activeTab === "period-close" ? (
          <PeriodClose account={account} />
        ) : activeTab === "salary" ? (
          <SalaryTable />
        ) : activeTab === "accounts" ? (
          <AccountsAdmin />
        ) : activeTab === "requests" ? (
          <FeatureRequests />
        ) : activeTab === "release" ? (
          <ReleaseNotes />
        ) : (
          <SettingsView />
        )}
      </main>
    </div>
  );
}

function MemberTable({ leg, members }: { leg: Leg; members: MemberRow[] }) {
  return (
    <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
            <th className="px-4 py-2.5 font-semibold">氏名</th>
            <th className="px-4 py-2.5 font-semibold">事業部</th>
            <th className="px-4 py-2.5 text-right font-semibold">予算Dig</th>
            <th className="px-4 py-2.5 text-right font-semibold">実績Dig</th>
            <th className="px-4 py-2.5 text-right font-semibold">達成率</th>
            <th className="px-4 py-2.5 text-right font-semibold">インセン</th>
            <th className="px-4 py-2.5 text-center font-semibold">ランク</th>
            <th className="px-4 py-2.5 text-center font-semibold">昇降級</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {members.map((m) => {
            const budget =
              leg === "monthly" ? m.eval.monthlyBudgetDig : m.eval.cumulativeBudgetDig;
            const l = m.eval[leg];
            return (
              <tr key={m.personId} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{m.name}</td>
                <td className="px-4 py-2.5 text-ink-muted">{m.division}</td>
                <td className="px-4 py-2.5 text-right text-ink-muted">{man(budget)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-ink">
                  {man(l.actualDig)}
                </td>
                <td className={`px-4 py-2.5 text-right font-semibold ${rateColor(l.achievementRate)}`}>
                  {pct(l.achievementRate)}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-accent">{man(m.incentive)}</td>
                <td className="px-4 py-2.5 text-center">
                  <RankBadge rank={l.rank} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  {(() => {
                    // Q1案1: 昇級は借入抜き(成果+ボーナス)、降級は実績Dig(借入込み)
                    const step = promotionStepDual({
                      actualRate: l.achievementRate,
                      promoRate: promotionRate(m.eval.seikaDig, m.eval.bonusDig, budget),
                      setting: DEFAULT_SETTING,
                    });
                    return (
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${promotionStyle(step)}`}
                      >
                        {promotionLabel(step)}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 text-[11px] text-ink-faint">
        ※ 未達メンバーは人ルート（コーチング／タレント管理）へ自動連携。成果Digは手入力（v1.1 Q3）。
      </div>
    </div>
  );
}
