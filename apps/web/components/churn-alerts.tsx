"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man, yen } from "@/lib/format";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";

export interface ChurnAlert {
  contractId: string;
  contractNo: string | null;
  customerName: string;
  division: string;
  monthlyAmount: number;
  termMonths: number;
  startDate: string | null;
  canceledOn: string | null;
  remainingMonths: number;
  /** 残存粗利から自動計算したマイナスDig（負値） */
  suggestedDig: number;
  churnDig: number | null;
  churnDecidedBy: string | null;
  churnDecidedOn: string | null;
  churnNote: string | null;
  shares: { personId: string; sharePercent: number }[];
}

/**
 * 途中解約アラート。契約管理DBの途中解約フラグを日次同期で取り込み、
 * 管理者がマイナスDigを確定するまで未処理として出し続ける。
 */
export function ChurnAlerts() {
  const [rows, setRows] = useState<ChurnAlert[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 行ごとの入力値。初期値は計算値（管理者が上書きできる）。
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const list = await apiGet<ChurnAlert[]>(`/api/contracts/churn${showAll ? "?all=1" : ""}`);
      setRows(list);
      setDraft(
        Object.fromEntries(
          list.map((r) => [r.contractId, String(Math.abs(r.churnDig ?? r.suggestedDig) || "")]),
        ),
      );
    } catch (e) {
      setMsg(`取得に失敗しました: ${(e as Error).message}`);
    }
  }, [showAll]);
  useEffect(() => {
    void load();
  }, [load]);

  const pending = rows.filter((r) => r.churnDig === null);

  async function decide(r: ChurnAlert) {
    const raw = (draft[r.contractId] ?? "").trim();
    if (raw === "" || !Number.isFinite(Number(raw))) {
      setMsg("マイナスDigを入力してください");
      return;
    }
    setBusy(r.contractId);
    try {
      await apiSend(`/api/contracts/${encodeURIComponent(r.contractId)}/churn`, "PATCH", {
        churnDig: Number(raw),
        actor: ACTOR,
      });
      setMsg(`${r.customerName} のマイナスDigを確定しました`);
      await load();
    } catch (e) {
      setMsg(`確定できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function clear(r: ChurnAlert) {
    if (!confirm(`${r.customerName} の確定を取り消しますか？（アラートに戻ります）`)) return;
    setBusy(r.contractId);
    try {
      const res = await fetch(
        `/api/contracts/${encodeURIComponent(r.contractId)}/churn?actor=${ACTOR}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "失敗");
      await load();
    } catch (e) {
      setMsg(`取り消せませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SectionHeader
        title="途中解約アラート"
        note="契約管理DBの途中解約フラグを毎日取込み。マイナスDigを確定するまで表示され続けます"
        accent="accent"
      />

      {msg && (
        <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <div
          className={`rounded-card px-3 py-2 text-xs font-bold ${
            pending.length > 0
              ? "bg-red-50 text-semantic-danger"
              : "bg-emerald-50 text-semantic-success"
          }`}
        >
          {pending.length > 0
            ? `未処理 ${pending.length}件 — マイナスDigを確定してください`
            : "未処理の途中解約はありません"}
        </div>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          確定済みも表示
        </label>
      </div>

      <div className="mb-8 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">顧客</th>
              <th className="px-3 py-2 font-semibold">事業部</th>
              <th className="px-3 py-2 text-right font-semibold">月額</th>
              <th className="px-3 py-2 font-semibold">解約日</th>
              <th className="px-3 py-2 text-right font-semibold">残月数</th>
              <th className="px-3 py-2 text-right font-semibold">計算値</th>
              <th className="px-3 py-2 text-center font-semibold">マイナスDig</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-ink-muted">
                  途中解約フラグの立っている契約はありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.contractId}
                  className={`border-b border-surface-border last:border-0 ${
                    r.churnDig === null ? "bg-red-50/40" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{r.customerName}</div>
                    <div className="text-[10px] text-ink-faint">{r.contractNo ?? r.contractId}</div>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.division}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{yen(r.monthlyAmount)}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.canceledOn ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{r.remainingMonths}ヶ月</td>
                  <td className="px-3 py-2 text-right text-ink-faint">{man(r.suggestedDig)}</td>
                  <td className="px-3 py-2 text-center">
                    {r.churnDig === null ? (
                      <>
                        <span className="mr-1 text-xs text-semantic-danger">▲</span>
                        <input
                          type="number"
                          min={0}
                          step={1000}
                          disabled={busy === r.contractId}
                          value={draft[r.contractId] ?? ""}
                          onChange={(e) =>
                            setDraft({ ...draft, [r.contractId]: e.target.value })
                          }
                          className="tabular w-32 rounded-card border border-surface-border px-2 py-1 text-right text-xs"
                        />
                      </>
                    ) : (
                      <span className="font-bold text-semantic-danger">{man(r.churnDig)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.churnDig === null ? (
                      <button
                        onClick={() => void decide(r)}
                        disabled={busy === r.contractId}
                        className="rounded-card bg-brand-primary px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                      >
                        確定
                      </button>
                    ) : (
                      <button
                        onClick={() => void clear(r)}
                        disabled={busy === r.contractId}
                        className="text-xs text-ink-muted underline disabled:opacity-50"
                      >
                        取り消し
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※ 計算値 = 月額 × 粗利率50% × 残契約月数（千円切捨）。入力欄には計算値が入っているので、
          そのまま確定するか金額を上書きしてください。更新月での解約（満了）は契約管理DB側でフラグが
          立たない想定です。確定するとアラートから消えます。
        </div>
      </div>
    </>
  );
}
