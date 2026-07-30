"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { man, pct, rateColor, yen } from "@/lib/format";
import { monthLabel, monthsOfQuarter, fiscalOf, quarterLabelOf, quarterOptions } from "@/lib/period";
import { RankBadge, SectionHeader } from "./ui";

interface MonthRow {
  yearMonth: string;
  monthlyBudgetDig: number;
  monthlyActualDig: number;
  monthlyRate: number;
  monthlyRank: string | null;
  cumulativeBudgetDig: number;
  cumulativeActualDig: number;
  cumulativeRate: number;
  seikaDig: number;
  bonusDig: number;
  loanDig: number;
  incentive: number;
  balance: number;
  finalized: boolean;
}

interface LoanRow {
  id: number;
  yearMonth: string;
  lender: string;
  loanType: string;
  status: string;
  principal: number;
  monthlyRatePct: number;
  termMonths: number;
  appliedOn: string;
  approvedOn: string | null;
  totalRepayment: number;
  totalInterest: number;
  paidCount: number;
  remaining: number;
  monthlyRepayment: number;
  note: string | null;
}

interface BonusRow {
  yearMonth: string;
  recordedOn: string;
  itemId: string;
  grantedDig: number;
  note: string | null;
}

interface MyPageData {
  member: {
    personId: string;
    name: string;
    division: string;
    position: string;
    employmentType: string;
    evaluationCycle: string;
    joinedOn: string;
    positionBase: number;
    salaryGrade: string | null;
  };
  months: MonthRow[];
  loans: LoanRow[];
  bonuses: BonusRow[];
  group: Array<{ personId: string; name: string }>;
}

interface PickerMember {
  personId: string;
  name: string;
  division: string;
}

/**
 * マイページ。本人の四半期推移・借入/返済状況・ボーナスDig・インセンティブを表示。
 * ADMIN 以上は他メンバーを選択して閲覧できる。
 */
export function MyPage({
  personId,
  canViewOthers,
  initialYm,
}: {
  personId: string | null;
  canViewOthers: boolean;
  initialYm: string;
}) {
  const [target, setTarget] = useState<string | null>(personId);
  const [ym, setYm] = useState(initialYm);
  const [members, setMembers] = useState<PickerMember[]>([]);
  const [data, setData] = useState<MyPageData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { fyYear, quarter } = useMemo(() => fiscalOf(ym), [ym]);
  const months = useMemo(() => monthsOfQuarter(fyYear, quarter), [fyYear, quarter]);
  const quarters = useMemo(() => quarterOptions(initialYm), [initialYm]);

  // ADMIN以上はメンバー一覧を取得して選択できる。
  useEffect(() => {
    if (!canViewOthers) return;
    void (async () => {
      try {
        setMembers(await apiGet<PickerMember[]>("/api/my-page/members"));
      } catch {
        /* 取得失敗は無視（本人分のみ表示） */
      }
    })();
  }, [canViewOthers]);

  const load = useCallback(async () => {
    if (!target) {
      setData(null);
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const d = await apiGet<MyPageData>(
        `/api/my-page?personId=${encodeURIComponent(target)}&months=${months.join(",")}`,
      );
      setData(d);
    } catch (e) {
      setData(null);
      setMsg(`取得できませんでした: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [target, months]);
  useEffect(() => {
    void load();
  }, [load]);

  // 四半期合計（インセン・ボーナス・実績）。
  const totals = useMemo(() => {
    const ms = data?.months ?? [];
    return {
      budget: ms.reduce((a, m) => a + m.monthlyBudgetDig, 0),
      actual: ms.reduce((a, m) => a + m.monthlyActualDig, 0),
      seika: ms.reduce((a, m) => a + m.seikaDig, 0),
      bonus: ms.reduce((a, m) => a + m.bonusDig, 0),
      incentive: ms.reduce((a, m) => a + m.incentive, 0),
    };
  }, [data]);
  const rate = totals.budget > 0 ? totals.actual / totals.budget : 0;
  const loanTotal = (data?.loans ?? []).reduce((a, l) => a + l.principal, 0);
  const loanRemaining = (data?.loans ?? []).reduce((a, l) => a + l.remaining, 0);

  if (!target) {
    return (
      <>
        <SectionHeader title="マイページ" note="自分の実績・借入・ボーナスDig・インセンティブ" />
        <div className="rounded-card border border-surface-border bg-white p-6 text-sm text-ink-muted">
          このアカウントは従業員マスタと紐づいていないため、本人の実績を表示できません。
          {canViewOthers && "（下のメンバー選択から他メンバーの状況は確認できます）"}
        </div>
        {canViewOthers && (
          <div className="mt-3">
            <MemberPicker members={members} value={target} onChange={setTarget} />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <SectionHeader
        title="マイページ"
        note={`${quarterLabelOf(ym)} の実績推移・借入/返済・ボーナスDig・インセンティブ`}
      />

      {/* 対象の切替（四半期／メンバー） */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
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
        {canViewOthers && <MemberPicker members={members} value={target} onChange={setTarget} />}
        {loading && <span className="text-xs text-ink-muted">読み込み中…</span>}
      </div>

      {msg && <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">{msg}</div>}

      {data && (
        <>
          {/* プロフィール */}
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-card border border-surface-border bg-white px-4 py-3 text-sm">
            <span className="text-lg font-bold text-ink">{data.member.name}</span>
            <span className="text-ink-muted">{data.member.personId}</span>
            <span className="text-ink-muted">{data.member.division}</span>
            <span className="text-ink-muted">
              {data.member.position}／{data.member.employmentType}
            </span>
            <span className="text-ink-muted">評価サイクル {data.member.evaluationCycle}</span>
            <span className="text-ink-muted">入社 {data.member.joinedOn}</span>
            <span className="text-ink-muted">
              役職ベース {data.member.positionBase > 0 ? yen(data.member.positionBase) : "未設定"}
              {data.member.salaryGrade ? `（レンジ${data.member.salaryGrade}）` : ""}
            </span>
            {data.group.length > 0 && (
              <span className="rounded-pill bg-blue-50 px-2 py-0.5 text-xs font-semibold text-brand-primary">
                グループ長（配下 {data.group.map((g) => g.name).join("・")}）
              </span>
            )}
          </div>

          {/* サマリー */}
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="四半期 予算Dig" value={man(totals.budget)} />
            <Stat label="四半期 実績Dig" value={man(totals.actual)} sub={`達成率 ${pct(rate)}`} subClass={rateColor(rate)} />
            <Stat label="ボーナスDig" value={man(totals.bonus)} />
            <Stat label="インセンティブ（見込み）" value={man(totals.incentive)} accent />
          </div>

          {/* 月次推移 */}
          <div className="mb-6 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-3 py-2 font-semibold">対象月</th>
                  <th className="px-3 py-2 text-right font-semibold">予算Dig</th>
                  <th className="px-3 py-2 text-right font-semibold">実績Dig</th>
                  <th className="px-3 py-2 text-right font-semibold">達成率</th>
                  <th className="px-3 py-2 text-center font-semibold">ランク</th>
                  <th className="px-3 py-2 text-right font-semibold">成果Dig</th>
                  <th className="px-3 py-2 text-right font-semibold">ボーナス</th>
                  <th className="px-3 py-2 text-right font-semibold">借入</th>
                  <th className="px-3 py-2 text-right font-semibold">インセン</th>
                  <th className="px-3 py-2 text-center font-semibold">状態</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {data.months.map((m) => (
                  <tr key={m.yearMonth} className="border-b border-surface-border last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{monthLabel(m.yearMonth)}</td>
                    <td className="px-3 py-2 text-right text-ink-muted">{man(m.monthlyBudgetDig)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink">{man(m.monthlyActualDig)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${rateColor(m.monthlyRate)}`}>
                      {pct(m.monthlyRate)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {m.monthlyRank ? <RankBadge rank={m.monthlyRank as never} /> : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">{man(m.seikaDig)}</td>
                    <td className="px-3 py-2 text-right text-ink-muted">{man(m.bonusDig)}</td>
                    <td className="px-3 py-2 text-right text-ink-muted">{man(m.loanDig)}</td>
                    <td className="px-3 py-2 text-right text-brand-accent">{man(m.incentive)}</td>
                    <td className="px-3 py-2 text-center text-xs">
                      {m.finalized ? (
                        <span className="rounded-pill bg-emerald-100 px-2 py-0.5 font-semibold text-semantic-success">確定</span>
                      ) : (
                        <span className="text-ink-faint">未確定</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[11px] text-ink-faint">
              ※ 実績Dig = 成果Dig + ボーナスDig + 借入Dig。インセンティブ原資は成果+ボーナス（借入は除外）。
            </div>
          </div>

          {/* 借入・返済状況 */}
          <SectionHeader
            title="借入・返済状況（Dig Bank）"
            note={`借入合計 ${man(loanTotal)} / 残高 ${man(loanRemaining)}`}
          />
          <div className="mb-6 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-3 py-2 font-semibold">種別</th>
                  <th className="px-3 py-2 font-semibold">貸主</th>
                  <th className="px-3 py-2 font-semibold">状態</th>
                  <th className="px-3 py-2 text-right font-semibold">借入額</th>
                  <th className="px-3 py-2 text-right font-semibold">月利</th>
                  <th className="px-3 py-2 text-right font-semibold">返済期間</th>
                  <th className="px-3 py-2 text-right font-semibold">毎月返済</th>
                  <th className="px-3 py-2 text-right font-semibold">返済済</th>
                  <th className="px-3 py-2 text-right font-semibold">残高</th>
                  <th className="px-3 py-2 font-semibold">申請日</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {data.loans.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-3 text-ink-muted">
                      借入はありません
                    </td>
                  </tr>
                ) : (
                  data.loans.map((l) => (
                    <tr key={l.id} className="border-b border-surface-border last:border-0">
                      <td className="px-3 py-2">{l.loanType}</td>
                      <td className="px-3 py-2 text-ink-muted">{l.lender}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${
                            l.status === "承認済"
                              ? "bg-emerald-100 text-semantic-success"
                              : l.status === "申請中"
                                ? "bg-amber-100 text-semantic-warn"
                                : l.status === "完済"
                                  ? "bg-blue-50 text-brand-primary"
                                  : "bg-slate-100 text-ink-muted"
                          }`}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-ink">{man(l.principal)}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{l.monthlyRatePct.toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{l.termMonths}ヶ月</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{man(l.monthlyRepayment)}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">
                        {l.paidCount}/{l.termMonths}回
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-ink">{man(l.remaining)}</td>
                      <td className="px-3 py-2 text-ink-muted">{l.appliedOn}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[11px] text-ink-faint">
              ※ 元利均等（借入額＋利息を返済回数で均等割）。返済済回数は承認月からの経過月数で算出。
            </div>
          </div>

          {/* ボーナスDig */}
          <SectionHeader title="ボーナスDigの獲得状況" note={`${quarterLabelOf(ym)} 合計 ${man(totals.bonus)}`} />
          <div className="overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-3 py-2 font-semibold">記録日</th>
                  <th className="px-3 py-2 font-semibold">対象月</th>
                  <th className="px-3 py-2 font-semibold">項目</th>
                  <th className="px-3 py-2 text-right font-semibold">獲得Dig</th>
                  <th className="px-3 py-2 font-semibold">メモ</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {data.bonuses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-ink-muted">
                      この四半期のボーナスDigはありません
                    </td>
                  </tr>
                ) : (
                  data.bonuses.map((b, i) => (
                    <tr key={`${b.itemId}-${i}`} className="border-b border-surface-border last:border-0">
                      <td className="px-3 py-2 text-ink-muted">{b.recordedOn}</td>
                      <td className="px-3 py-2 text-ink-muted">{monthLabel(b.yearMonth)}</td>
                      <td className="px-3 py-2">{b.itemId}</td>
                      <td className="px-3 py-2 text-right font-semibold text-ink">{man(b.grantedDig)}</td>
                      <td className="px-3 py-2 text-ink-muted">{b.note ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function MemberPicker({
  members,
  value,
  onChange,
}: {
  members: PickerMember[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <span className="ml-2 text-ink-muted">メンバー</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-card border border-surface-border bg-white px-3 py-1.5 font-semibold"
      >
        <option value="">選択してください</option>
        {members.map((m) => (
          <option key={m.personId} value={m.personId}>
            {m.name}（{m.division}）
          </option>
        ))}
      </select>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  subClass,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-card border bg-white p-4 shadow-card ${accent ? "border-violet-200" : "border-surface-border"}`}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-bold text-ink">{value}</div>
      <div className={`mt-1 text-xs ${subClass ?? "text-ink-faint"}`}>{sub ?? " "}</div>
    </div>
  );
}
