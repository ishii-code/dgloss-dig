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
import { FeatureRequests } from "@/components/requests";
import { RulesAndContracts } from "@/components/rules";
import { SalaryTable } from "@/components/salary-table";
import { apiGet } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { man, pct, promotionLabel, promotionStyle, rateColor } from "@/lib/format";
import { byDivision, type Leg, MEMBERS, QUARTER, totals } from "@/lib/mock";

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

  const account = ACCOUNTS[role];
  const t = useMemo(() => totals(leg), [leg]);
  const divs = useMemo(() => byDivision(leg), [leg]);

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
          <span className="rounded-card border border-surface-border bg-white px-3 py-1.5 font-semibold">
            {QUARTER}（{leg === "monthly" ? "単月" : "累計"}）
          </span>
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
          <span className="ml-auto rounded-pill bg-amber-50 px-2 py-0.5 text-xs font-semibold text-semantic-warn">
            即時速報
          </span>
        </div>

        {activeTab === "monitor" ? (
          <>
            {/* 全社 */}
            <SectionHeader title="全社" note={`${MEMBERS.length}名の合計`} />
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
            <MemberTable leg={leg} />
          </>
        ) : activeTab === "members" ? (
          <>
            <SectionHeader title="メンバー評価（残高計算）" note="予算Dig vs 実績Dig" />
            <MemberTable leg={leg} />
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

function MemberTable({ leg }: { leg: Leg }) {
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
          {MEMBERS.map((m) => {
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
