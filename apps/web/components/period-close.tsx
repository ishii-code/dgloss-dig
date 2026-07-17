"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man, yen } from "@/lib/format";
import type { CurrentAccount } from "./loan-thread";
import { SectionHeader } from "./ui";

const YM = "2026-01";

interface Ev {
  personId: string;
  seikaDig: number;
  bonusDig: number;
  monthlyBudgetDig: number;
  surplusChoice: string;
  seikaApproved: boolean;
  seikaInputBy: string | null;
  finalized: boolean;
}
interface Retire {
  personId: string;
  name: string;
  division: string;
  loanBalance: number;
  settled: boolean;
}

export function PeriodClose({ account }: { account: CurrentAccount }) {
  const [evs, setEvs] = useState<Ev[]>([]);
  const [pending, setPending] = useState<Ev[]>([]);
  const [retire, setRetire] = useState<Retire[]>([]);
  const [members, setMembers] = useState<{ personId: string; name: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [snap, setSnap] = useState<{ personId: string; incentive: number; promotionStep: number }[]>([]);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  const load = useCallback(async () => {
    try {
      const [e, p, r, m] = await Promise.all([
        apiGet<Ev[]>(`/api/evaluations?ym=${YM}`),
        apiGet<Ev[]>("/api/evaluations/seika"),
        apiGet<Retire[]>("/api/retirement"),
        apiGet<{ personId: string; name: string }[]>("/api/members"),
      ]);
      setEvs(e);
      setPending(p);
      setRetire(r);
      setMembers(m);
      setSource("db");
    } catch {
      setSource("mock");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (id: string) => members.find((m) => m.personId === id)?.name ?? id;
  const isSuper = account.role === "SUPER_ADMIN";

  async function finalize() {
    if (!confirm(`${YM} の評価を確定します。よろしいですか？`)) return;
    try {
      const res = await apiSend<{ finalized: number; snapshot: typeof snap }>(
        "/api/evaluations/finalize",
        "POST",
        { yearMonth: YM, actor: account.id },
      );
      setSnap(res.snapshot);
      setMsg(`期末確定: ${res.finalized}件を凍結しました`);
      await load();
    } catch (e) {
      setMsg(`確定失敗: ${(e as Error).message}`);
    }
  }
  async function choose(personId: string, choice: "incentive" | "carryover") {
    try {
      await apiSend("/api/evaluations/surplus-choice", "POST", { yearMonth: YM, personId, choice, actor: account.id });
      await load();
    } catch (e) {
      setMsg(`選択失敗: ${(e as Error).message}`);
    }
  }
  async function approve(personId: string) {
    try {
      await apiSend("/api/evaluations/seika/approve", "POST", { yearMonth: YM, personId, approver: account.id });
      setMsg(`${nameOf(personId)} の成果Digを承認しました`);
      await load();
    } catch (e) {
      setMsg(`承認失敗: ${(e as Error).message}`);
    }
  }

  const surplusRows = evs
    .map((e) => ({ ...e, surplus: Math.max(e.seikaDig - e.monthlyBudgetDig, 0) }))
    .filter((e) => e.surplus > 0);

  return (
    <>
      <SectionHeader title="期末処理" note="期末確定（Q8）・超過分の選択（Q3）・成果Dig承認（Q13）・退社精算（Q14）" accent="accent" />
      {source === "mock" && <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>}
      {msg && <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      {/* Q8 期末確定 */}
      <div className="mb-6 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">期末確定（Q8）</div>
            <div className="text-xs text-ink-muted">評価を凍結し、インセン・昇降級を確定（四半期の人は四半期末）。</div>
          </div>
          <button onClick={finalize} className="rounded-card bg-brand-accent px-4 py-1.5 text-sm font-bold text-white">
            {YM} を確定
          </button>
        </div>
        {snap.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-card border border-surface-border">
            <table className="w-full text-xs tabular">
              <thead><tr className="bg-surface-panel text-left text-ink-muted"><th className="px-3 py-1.5">氏名</th><th className="px-3 py-1.5 text-right">インセン</th><th className="px-3 py-1.5 text-center">昇降級</th></tr></thead>
              <tbody>
                {snap.map((s) => (
                  <tr key={s.personId} className="border-t border-surface-border">
                    <td className="px-3 py-1.5">{nameOf(s.personId)}</td>
                    <td className="px-3 py-1.5 text-right text-brand-accent">{man(s.incentive)}</td>
                    <td className={`px-3 py-1.5 text-center font-bold ${s.promotionStep > 0 ? "text-semantic-success" : s.promotionStep < 0 ? "text-semantic-danger" : "text-ink-muted"}`}>
                      {s.promotionStep > 0 ? `▲${s.promotionStep}` : s.promotionStep < 0 ? `▼${-s.promotionStep}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Q3 超過分の選択 */}
      <div className="mb-2 text-sm font-semibold text-ink">超過分の処理（Q3・本人選択）</div>
      <div className="mb-6 overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm tabular">
          <thead><tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted"><th className="px-4 py-2">氏名</th><th className="px-4 py-2 text-right">超過分</th><th className="px-4 py-2 text-right">インセン(20%)</th><th className="px-4 py-2 text-center">選択</th></tr></thead>
          <tbody>
            {surplusRows.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-ink-faint">超過している人はいません</td></tr>}
            {surplusRows.map((e) => (
              <tr key={e.personId} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2 font-medium text-ink">{nameOf(e.personId)}</td>
                <td className="px-4 py-2 text-right">{man(e.surplus)}</td>
                <td className="px-4 py-2 text-right text-brand-accent">{man(e.surplus * 0.2)}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-center gap-1">
                    {(["incentive", "carryover"] as const).map((c) => (
                      <button key={c} onClick={() => choose(e.personId, c)} disabled={e.finalized}
                        className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${e.surplusChoice === c ? "bg-brand-primary text-white" : "bg-slate-100 text-ink-muted"} disabled:opacity-40`}>
                        {c === "incentive" ? "インセン" : "持ち越し"}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Q13 成果Dig手入力承認 */}
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink">成果Dig手入力の承認（Q13）</span>
        <span className="rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-bold text-semantic-warn">{pending.length}件</span>
        {!isSuper && <span className="text-xs text-ink-faint">※承認はスーパーADMINのみ</span>}
      </div>
      <div className="mb-6 overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm tabular">
          <thead><tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted"><th className="px-4 py-2">氏名</th><th className="px-4 py-2 text-right">成果Dig</th><th className="px-4 py-2">入力者</th><th className="px-4 py-2 text-center">承認</th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-ink-faint">承認待ちはありません（自動計上は承認済）</td></tr>}
            {pending.map((e) => (
              <tr key={e.personId} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2 font-medium text-ink">{nameOf(e.personId)}</td>
                <td className="px-4 py-2 text-right">{yen(e.seikaDig)}</td>
                <td className="px-4 py-2 text-ink-muted">{e.seikaInputBy ?? "—"}</td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => approve(e.personId)} disabled={!isSuper}
                    className="rounded-card bg-brand-primary px-3 py-1 text-xs font-bold text-white disabled:opacity-40">承認</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Q14 退社精算 */}
      <div className="mb-2 text-sm font-semibold text-ink">退社時の借入残高精算（Q14・グループ負担）</div>
      <div className="space-y-3">
        {retire.length === 0 && <div className="rounded-card border border-dashed border-surface-border p-4 text-center text-xs text-ink-faint">退社者はいません</div>}
        {retire.map((r) => (
          <RetireCard key={r.personId} r={r} members={members} account={account} onDone={(m) => { setMsg(m); void load(); }} />
        ))}
      </div>
    </>
  );
}

function RetireCard({
  r,
  members,
  account,
  onDone,
}: {
  r: Retire;
  members: { personId: string; name: string }[];
  account: CurrentAccount;
  onDone: (msg: string) => void;
}) {
  const [shares, setShares] = useState<{ personId: string; amount: number }[]>([
    { personId: members[0]?.personId ?? "", amount: r.loanBalance },
  ]);
  const sum = shares.reduce((s, x) => s + x.amount, 0);
  const nameOf = (id: string) => members.find((m) => m.personId === id)?.name ?? id;

  async function settle() {
    try {
      await apiSend("/api/retirement", "POST", {
        personId: r.personId, yearMonth: "2026-01", loanBalance: r.loanBalance, shares, note: null, actor: account.id,
      });
      onDone(`${r.name} の退社精算を登録しました`);
    } catch (e) {
      onDone(`精算失敗: ${(e as Error).message}`);
    }
  }

  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{r.name}</span>
        <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] text-ink-muted">{r.division}</span>
        {r.settled && <span className="rounded-pill bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-semantic-success">精算済</span>}
        <span className="tabular ml-auto text-sm">借入残高 <b className="text-semantic-danger">{man(r.loanBalance)}</b></span>
      </div>
      {!r.settled && (
        <div className="mt-3 space-y-2">
          {shares.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <select className="rounded-card border border-surface-border px-2 py-1" value={s.personId} onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, personId: e.target.value } : x)))}>
                {members.map((m) => <option key={m.personId} value={m.personId}>{m.name}</option>)}
              </select>
              <input type="number" className="w-32 rounded-card border border-surface-border px-2 py-1 tabular" value={s.amount} onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
              <span className="text-xs text-ink-muted">Dig</span>
              <button onClick={() => setShares(shares.filter((_, j) => j !== i))} className="text-xs text-semantic-danger">削除</button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button onClick={() => setShares([...shares, { personId: members[0]?.personId ?? "", amount: 0 }])} className="text-xs font-semibold text-brand-primary">＋負担者を追加</button>
            <span className={`text-xs ${Math.round(sum) === Math.round(r.loanBalance) ? "text-semantic-success" : "text-semantic-warn"}`}>合計 {man(sum)} / 残高 {man(r.loanBalance)}</span>
            <button onClick={settle} className="rounded-card bg-brand-primary px-3 py-1 text-xs font-bold text-white">精算を登録</button>
          </div>
          <div className="text-[11px] text-ink-faint">※ 同一グループ内の相対貸借がある場合は相殺のうえ配分してください（負担合計＝借入残高）。</div>
        </div>
      )}
    </div>
  );
}
