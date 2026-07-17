"use client";

import { COMPANY_LENDER } from "@dig/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man, loanStatusStyle, loanTypeStyle, pct } from "@/lib/format";
import { ALL_LOANS, type LoanView, scheduleOf } from "@/lib/loans";
import { type CurrentAccount, LoanThread } from "./loan-thread";
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


// ── ディグロス金融 管理画面（承認コンソール・チャット/差し戻し/添付対応） ──
const DEFAULT_ANNUAL = 12;

interface FinLoan {
  id: number;
  borrowerId: string;
  lender: string;
  status: string;
  principal: number;
  termMonths: number;
}

export function FinanceConsole({ account, onChanged }: { account: CurrentAccount; onChanged?: () => void }) {
  const [loans, setLoans] = useState<FinLoan[]>([]);
  const [members, setMembers] = useState<{ personId: string; name: string }[]>([]);
  const [rate, setRate] = useState(DEFAULT_ANNUAL);
  const [savedRate, setSavedRate] = useState(DEFAULT_ANNUAL);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, m, setting, u] = await Promise.all([
        apiGet<FinLoan[]>("/api/loans"),
        apiGet<{ personId: string; name: string }[]>("/api/members"),
        apiGet<{ annualRatePct: number }>("/api/settings?ym=2026-01"),
        apiGet<{ perLoan: Record<number, number> }>(`/api/loans/unread?accountId=${account.id}`),
      ]);
      setLoans(l);
      setMembers(m);
      setRate(setting.annualRatePct);
      setSavedRate(setting.annualRatePct);
      setUnread(u.perLoan);
      setSource("db");
    } catch {
      setSource("mock");
    }
  }, [account.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    void load();
    onChanged?.();
  };
  const nameOf = (id: string) => members.find((m) => m.personId === id)?.name ?? id;
  const queue = loans.filter((l) => l.lender === COMPANY_LENDER && (l.status === "申請中" || l.status === "差し戻し"));
  const decided = loans.filter((l) => l.lender === COMPANY_LENDER && (l.status === "承認済" || l.status === "却下"));

  async function saveRate() {
    if (source === "db") {
      try {
        await apiSend("/api/settings/rate", "PATCH", { yearMonth: "2026-01", annualRatePct: rate, actor: account.id });
      } catch {
        return;
      }
    }
    setSavedRate(rate);
  }

  return (
    <>
      <SectionHeader
        title="ディグロス金融 管理画面"
        note="会社借入の承認・否決・差し戻し（チャットで過不足を確認）と金利設定"
        accent="accent"
      />
      <div className="mb-4">
        <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${source === "db" ? "bg-emerald-100 text-semantic-success" : source === "mock" ? "bg-amber-100 text-semantic-warn" : "bg-slate-100 text-ink-muted"}`}>
          {source === "db" ? "● DB接続（承認・金利は永続化）" : source === "mock" ? "○ モック表示（DB未接続）" : "接続中…"}
        </span>
      </div>

      {/* 金利設定 */}
      <div className="mb-6 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-ink-muted">会社金利（年利）</div>
            <div className="tabular text-2xl font-bold text-ink">{rate.toFixed(1)}%</div>
          </div>
          <div className="text-xs text-ink-muted">
            月利 {(rate / 12).toFixed(3)}%（新規借入に適用・既存は借入時レート保持）
            {rate !== savedRate && <span className="ml-2 text-semantic-warn">未保存</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input type="range" min={0} max={24} step={0.5} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="accent-brand-primary" />
            <button onClick={saveRate} disabled={rate === savedRate} className="rounded-card bg-brand-primary px-3 py-1 text-xs font-bold text-white disabled:opacity-40">保存</button>
          </div>
        </div>
      </div>

      {/* 承認キュー（チャット付き） */}
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink">承認待ち・差し戻し</span>
        <span className="rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-bold text-semantic-warn">{queue.length}件</span>
      </div>
      <div className="space-y-2">
        {queue.length === 0 && <div className="rounded-card border border-dashed border-surface-border p-4 text-center text-xs text-ink-faint">承認待ちはありません</div>}
        {queue.map((l) => (
          <div key={l.id}>
            <button onClick={() => setOpen(open === l.id ? null : l.id)} className="flex w-full items-center gap-2 rounded-card border border-surface-border bg-white px-4 py-2.5 text-left text-sm shadow-card">
              <span className="font-medium text-ink">借入 #{l.id}</span>
              <span className="text-ink-muted">{nameOf(l.borrowerId)}</span>
              <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${l.status === "差し戻し" ? "bg-orange-100 text-semantic-warn" : "bg-amber-100 text-semantic-warn"}`}>{l.status}</span>
              <span className="tabular text-ink-muted">{man(l.principal)}</span>
              <span className="ml-auto flex items-center gap-2">
                {unread[l.id] ? <span className="inline-flex min-w-[18px] items-center justify-center rounded-pill bg-semantic-danger px-1.5 text-[11px] font-bold text-white">{unread[l.id]}</span> : null}
                <span className="text-xs text-brand-primary">{open === l.id ? "閉じる" : "開く"}</span>
              </span>
            </button>
            {open === l.id && <div className="mt-2"><LoanThread loanId={l.id} account={account} onChanged={refresh} /></div>}
          </div>
        ))}
      </div>

      {decided.length > 0 && (
        <div className="mt-6 text-xs text-ink-faint">処理済み: {decided.length}件（承認 {decided.filter((l) => l.status === "承認済").length} / 却下 {decided.filter((l) => l.status === "却下").length}）</div>
      )}
      <div className="mt-4 text-[11px] text-ink-faint">※ 初回借入（入社時）は自動承認のためキューに出ません。操作は監査ログに記録されます。</div>
    </>
  );
}
