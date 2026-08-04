"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man } from "@/lib/format";
import { SectionHeader } from "./ui";

interface Transfer {
  id: number;
  yearMonth: string;
  tradedOn: string;
  payerId: string;
  payerName: string;
  payeeId: string;
  payeeName: string;
  amount: number;
  description: string;
  note: string | null;
  status: string;
  decidedBy: string | null;
  decidedOn: string | null;
  rejectReason: string | null;
}

interface PickerMember {
  personId: string;
  name: string;
  division: string;
}

/**
 * Dig譲渡。通常の配分はそのままに、当事者間の相対で調整するための仕組み。
 * 譲る側が申請し、**受け取る側が承認**した時点で対象月の成果Digが移動する。
 */
export function DigTransfer({
  personId,
  personName,
  actorId,
  isSelf,
  isAdmin,
  members,
  defaultYearMonth,
}: {
  personId: string;
  personName: string;
  actorId: string;
  isSelf: boolean;
  isAdmin: boolean;
  members: PickerMember[];
  defaultYearMonth: string;
}) {
  const [rows, setRows] = useState<Transfer[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    payeeId: "",
    amount: "",
    yearMonth: defaultYearMonth,
    tradedOn: new Date().toISOString().slice(0, 10),
    description: "",
    note: "",
  });

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Transfer[]>(`/api/transfers?personId=${encodeURIComponent(personId)}`));
    } catch (e) {
      setErr(`譲渡の取得に失敗しました: ${(e as Error).message}`);
    }
  }, [personId]);
  useEffect(() => {
    void load();
  }, [load]);

  // 自分宛の承認待ち（受け取る側）と、自分が出した申請。
  const incoming = useMemo(
    () => rows.filter((r) => r.status === "申請中" && r.payeeId === personId),
    [rows, personId],
  );
  const outgoing = useMemo(
    () => rows.filter((r) => r.status === "申請中" && r.payerId === personId),
    [rows, personId],
  );
  const history = useMemo(() => rows.filter((r) => r.status !== "申請中"), [rows]);

  async function submit() {
    setErr(null);
    setMsg(null);
    const amount = Number(form.amount);
    if (!form.payeeId) return setErr("譲る相手を選択してください");
    if (!Number.isFinite(amount) || amount <= 0) return setErr("譲渡するDigを入力してください");
    if (!form.description.trim()) return setErr("理由を入力してください");
    setBusy(true);
    try {
      await apiSend("/api/transfers", "POST", {
        yearMonth: form.yearMonth,
        tradedOn: form.tradedOn,
        payerId: personId,
        payeeId: form.payeeId,
        amount,
        description: form.description.trim(),
        note: form.note.trim() || null,
        actor: actorId,
      });
      setForm({ ...form, payeeId: "", amount: "", description: "", note: "" });
      setMsg("譲渡を申請しました。相手が承認すると成果Digが移動します。");
      await load();
    } catch (e) {
      setErr(`申請できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: number, approve: boolean) {
    const reason = approve ? null : (window.prompt("却下理由を入力してください（任意）") ?? null);
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await apiSend(`/api/transfers/${id}/decision`, "POST", {
        approve,
        actor: actorId,
        rejectReason: reason,
      });
      setMsg(approve ? "受け取りました。成果Digが移動しました。" : "却下しました。");
      await load();
    } catch (e) {
      setErr(`処理できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: number) {
    if (!confirm("この譲渡申請を取り消しますか？")) return;
    setBusy(true);
    try {
      await apiSend(`/api/transfers/${id}/cancel`, "POST", { actor: actorId });
      setMsg("申請を取り消しました。");
      await load();
    } catch (e) {
      setErr(`取り消せませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        title="Dig譲渡"
        note="相対で配分を調整する仕組み。受け取る側が承認すると成果Digが移動します"
      />

      {incoming.length > 0 && (
        <div className="mb-4 rounded-card border border-brand-primary bg-blue-50 p-3">
          <div className="mb-2 text-sm font-semibold text-brand-primary">
            受け取り待ち {incoming.length}件
          </div>
          <div className="space-y-2">
            {incoming.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-ink">{t.payerName}</span>
                <span className="text-ink-muted">→ あなた</span>
                <span className="tabular font-semibold text-ink">{man(t.amount)}</span>
                <span className="text-xs text-ink-muted">
                  {t.yearMonth} / {t.description}
                </span>
                <button
                  onClick={() => void decide(t.id, true)}
                  disabled={busy}
                  className="rounded-card bg-semantic-success px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  受け取る
                </button>
                <button
                  onClick={() => void decide(t.id, false)}
                  disabled={busy}
                  className="rounded-card border border-surface-border px-3 py-1 text-xs font-semibold text-ink-muted disabled:opacity-50"
                >
                  却下
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(isSelf || isAdmin) && (
        <div className="mb-4 rounded-card border border-surface-border bg-white shadow-card">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-ink"
          >
            <span>＋ Digを譲渡する（相手の承認で成立）</span>
            <span className="text-ink-muted">{open ? "閉じる" : "開く"}</span>
          </button>

          {open && (
            <div className="grid gap-3 border-t border-surface-border px-4 py-4 sm:grid-cols-2">
              <Field label="譲る人">
                <input
                  value={personName}
                  readOnly
                  className="w-full rounded-card border border-surface-border bg-surface-panel px-3 py-1.5 text-sm text-ink-muted"
                />
              </Field>
              <Field label="譲る相手">
                <select
                  value={form.payeeId}
                  onChange={(e) => setForm({ ...form, payeeId: e.target.value })}
                  className="w-full rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">選択してください</option>
                  {members
                    .filter((m) => m.personId !== personId)
                    .map((m) => (
                      <option key={m.personId} value={m.personId}>
                        {m.name}（{m.division}）
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="対象月" hint="この月の成果Digが移動します">
                <input
                  value={form.yearMonth}
                  onChange={(e) => setForm({ ...form, yearMonth: e.target.value })}
                  placeholder="2026-07"
                  className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                />
              </Field>
              <Field label="譲渡するDig">
                <input
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, "") })}
                  inputMode="numeric"
                  placeholder="270000"
                  className="tabular w-full rounded-card border border-surface-border px-3 py-1.5 text-right text-sm"
                />
              </Field>
              <Field label="理由" hint="例: アップセル分の相対調整">
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                />
              </Field>
              <Field label="備考">
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                />
              </Field>
              <div className="sm:col-span-2">
                <button
                  onClick={() => void submit()}
                  disabled={busy}
                  className="rounded-card bg-brand-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  譲渡を申請する
                </button>
                <span className="ml-3 text-[11px] text-ink-faint">
                  ※ 対象月の自分の成果Digの範囲内でのみ申請できます。相手が承認するまでDigは動きません。
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div className="mb-3 rounded-card bg-emerald-50 px-3 py-2 text-xs text-semantic-success">{msg}</div>}
      {err && <div className="mb-3 rounded-card bg-rose-50 px-3 py-2 text-xs text-semantic-danger">{err}</div>}

      <div className="mb-6 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">対象月</th>
              <th className="px-3 py-2 font-semibold">譲る人</th>
              <th className="px-3 py-2 font-semibold">受け取る人</th>
              <th className="px-3 py-2 text-right font-semibold">Dig</th>
              <th className="px-3 py-2 font-semibold">理由</th>
              <th className="px-3 py-2 text-center font-semibold">状態</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-ink-muted">
                  譲渡はまだありません
                </td>
              </tr>
            ) : (
              [...outgoing, ...incoming, ...history].map((t) => (
                <tr key={t.id} className="border-b border-surface-border last:border-0">
                  <td className="px-3 py-2 text-ink-muted">{t.yearMonth}</td>
                  <td className="px-3 py-2">{t.payerName}</td>
                  <td className="px-3 py-2">{t.payeeName}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">{man(t.amount)}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {t.status === "却下" && t.rejectReason ? `却下理由: ${t.rejectReason}` : t.description}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {t.status === "申請中" && t.payerId === personId && (
                      <button
                        onClick={() => void cancel(t.id)}
                        disabled={busy}
                        className="text-xs text-semantic-danger disabled:opacity-50"
                      >
                        取消
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※ 承認された時点で、対象月の成果Digが譲る人から受け取る人へ移動します（確定済みの月は不可）。
          通常の配分ルールは変わりません。相対で調整したいときにだけ使います。
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "承認済"
      ? "bg-emerald-100 text-semantic-success"
      : status === "申請中"
        ? "bg-amber-100 text-semantic-warn"
        : status === "取消"
          ? "bg-slate-100 text-ink-muted"
          : "bg-rose-100 text-semantic-danger";
  return <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink-muted">
        {label}
        {hint && <span className="ml-1 font-normal text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
