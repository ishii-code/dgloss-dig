"use client";

import { useMemo, useState } from "react";
import { man, loanStatusStyle, loanTypeStyle, pct } from "@/lib/format";
import { ALL_LOANS, type LoanView, scheduleOf } from "@/lib/loans";
import { SectionHeader } from "./ui";

function Badge({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${cls}`}>{text}</span>
  );
}

// ── 借入者ビュー（Digloss Bank） ──
export function DiglossBank() {
  const loans = ALL_LOANS.filter((l) => l.status === "承認済");
  const totalOutstanding = loans.reduce((s, l) => s + l.currentBalance, 0);

  return (
    <>
      <SectionHeader
        title="Digloss Bank（借入残高）"
        note="入社時の必須初回借入＋承認済の追加借入。実績Digから自動返済。"
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="承認済 借入件数" value={`${loans.length}件`} />
        <StatCard label="残高合計" value={man(totalOutstanding)} accent />
        <StatCard label="月次返済合計" value={man(loans.reduce((s, l) => s + l.monthlyRepayment, 0))} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {loans.map((l) => (
          <LoanCard key={l.id} loan={l} />
        ))}
      </div>
    </>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular mt-1 text-2xl font-bold ${accent ? "text-brand-accent" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function LoanCard({ loan }: { loan: LoanView }) {
  const [open, setOpen] = useState(false);
  const sched = useMemo(() => scheduleOf(loan), [loan]);
  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">{loan.borrowerName}</span>
          <Badge text={loan.loanType} cls={loanTypeStyle(loan.loanType)} />
          <Badge text={loan.status} cls={loanStatusStyle(loan.status)} />
        </div>
        <span className="text-xs text-ink-muted">{loan.lender}</span>
      </div>
      <div className="tabular mt-3 grid grid-cols-3 gap-2 text-sm">
        <Field label="借入額" value={man(loan.principal)} />
        <Field label="現在残高" value={man(loan.currentBalance)} strong />
        <Field label="月次返済" value={man(loan.monthlyRepayment)} />
        <Field label="月利" value={pct(loan.monthlyRate)} />
        <Field label="返済期間" value={`${loan.termMonths}ヶ月`} />
        <Field label="承認" value={loan.approvedBy ?? "—"} />
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-xs font-semibold text-brand-primary"
      >
        {open ? "返済スケジュールを隠す" : "返済スケジュールを表示"}
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-card border border-surface-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-panel text-left text-ink-muted">
                <th className="px-3 py-1.5">回</th>
                <th className="px-3 py-1.5 text-right">月初残高</th>
                <th className="px-3 py-1.5 text-right">利息</th>
                <th className="px-3 py-1.5 text-right">返済</th>
                <th className="px-3 py-1.5 text-right">返済後残高</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {sched.map((r, i) => (
                <tr key={i} className="border-t border-surface-border">
                  <td className="px-3 py-1.5">{i + 1}</td>
                  <td className="px-3 py-1.5 text-right text-ink-muted">{man(r.openingBalance)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-muted">{man(r.interest)}</td>
                  <td className="px-3 py-1.5 text-right">{man(r.repayment)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{man(r.closingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={strong ? "font-bold text-ink" : "text-ink"}>{value}</div>
    </div>
  );
}

// ── ディグロス金融 管理画面（承認コンソール） ──
type Decision = "申請中" | "承認済" | "却下";

export function FinanceConsole() {
  const [rate, setRate] = useState(DEFAULT_ANNUAL);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const applications = ALL_LOANS.filter((l) => l.loanType === "追加");

  const decide = (id: string, d: Decision) =>
    setDecisions((prev) => ({ ...prev, [id]: d }));

  const pending = applications.filter((l) => (decisions[l.id] ?? l.status) === "申請中");

  return (
    <>
      <SectionHeader
        title="ディグロス金融 管理画面"
        note="追加借入の承認・却下と金利設定（AIはL4まで・最終判断は人）"
        accent="accent"
      />

      {/* 金利設定 */}
      <div className="mb-6 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-ink-muted">会社金利（年利）</div>
            <div className="tabular text-2xl font-bold text-ink">{rate.toFixed(1)}%</div>
          </div>
          <div className="text-xs text-ink-muted">
            月利 {(rate / 12).toFixed(3)}%（新規借入に適用・既存借入は借入時レートを保持）
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={24}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="accent-brand-primary"
            />
            <button
              onClick={() => setRate(DEFAULT_ANNUAL)}
              className="rounded-card border border-surface-border px-3 py-1 text-xs font-semibold text-ink-muted"
            >
              既定に戻す
            </button>
          </div>
        </div>
      </div>

      {/* 承認キュー */}
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink">承認待ちキュー</span>
        <span className="rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-bold text-semantic-warn">
          {pending.length}件
        </span>
      </div>
      <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-4 py-2.5 font-semibold">借入者</th>
              <th className="px-4 py-2.5 font-semibold">種別</th>
              <th className="px-4 py-2.5 text-right font-semibold">申請額</th>
              <th className="px-4 py-2.5 text-right font-semibold">期間</th>
              <th className="px-4 py-2.5 font-semibold">理由</th>
              <th className="px-4 py-2.5 font-semibold">申請日</th>
              <th className="px-4 py-2.5 text-center font-semibold">判定</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {applications.map((l) => {
              const d = decisions[l.id] ?? l.status;
              return (
                <tr key={l.id} className="border-b border-surface-border last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{l.borrowerName}</td>
                  <td className="px-4 py-2.5">
                    <Badge text={l.loanType} cls={loanTypeStyle(l.loanType)} />
                  </td>
                  <td className="px-4 py-2.5 text-right">{man(l.principal)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{l.termMonths}ヶ月</td>
                  <td className="px-4 py-2.5 text-ink-muted">{l.reason ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{l.appliedOn}</td>
                  <td className="px-4 py-2.5">
                    {d === "申請中" ? (
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => decide(l.id, "承認済")}
                          className="rounded-card bg-brand-primary px-3 py-1 text-xs font-bold text-white"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => decide(l.id, "却下")}
                          className="rounded-card border border-semantic-danger px-3 py-1 text-xs font-bold text-semantic-danger"
                        >
                          却下
                        </button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Badge text={d} cls={loanStatusStyle(d)} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 text-[11px] text-ink-faint">
          ※ 初回借入（入社時）は自動承認のためキューに出ません。永続化・監査ログは P4（Supabase）で実装。
        </div>
      </div>
    </>
  );
}

const DEFAULT_ANNUAL = 12;
