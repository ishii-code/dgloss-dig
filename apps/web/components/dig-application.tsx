"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man, yen } from "@/lib/format";
import { SectionHeader } from "./ui";

export interface DigApplicationRow {
  id: number;
  applicantId: string;
  applicantName: string;
  companyId: string | null;
  companyName: string;
  productName: string;
  contractSummary: string | null;
  grantedDig: number;
  splitDig: number;
  splitPartnerId: string | null;
  splitPartnerName: string | null;
  contractDate: string;
  note: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedOn: string | null;
  rejectReason: string | null;
}

interface ContractHit {
  contractId: string;
  contractNo: string | null;
  companyId: string | null;
  companyName: string;
  division: string;
  productName: string;
  termMonths: number;
  contractSummary: string | null;
  startDate: string | null;
  baseAmount: number;
  status: string;
  suggestedDig: number;
}

interface PickerMember {
  personId: string;
  name: string;
  division: string;
}

const EMPTY_FORM = {
  companyId: "",
  companyName: "",
  productName: "",
  contractSummary: "",
  contractId: "" as string | null,
  grantedDig: "",
  splitDig: "",
  splitPartnerId: "",
  contractDate: "",
  note: "",
};

/**
 * Dig申請フォーム＋申請一覧＋（ADMIN以上）承認キュー。
 * 顧客IDを入力して契約管理DBを引くと、企業名・商材・契約内容・契約日・獲得Digの目安を自動記載する。
 * 契約DBに該当が無い場合も手入力で申請できる（契約DBは順次連携予定）。
 */
export function DigApplicationPanel({
  applicantId,
  applicantName,
  actorId,
  isAdmin,
  isSelf,
  members,
}: {
  applicantId: string;
  applicantName: string;
  actorId: string;
  isAdmin: boolean;
  isSelf: boolean;
  members: PickerMember[];
}) {
  const [rows, setRows] = useState<DigApplicationRow[]>([]);
  const [queue, setQueue] = useState<DigApplicationRow[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [hits, setHits] = useState<ContractHit[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await apiGet<DigApplicationRow[]>(
        `/api/dig-applications?personId=${encodeURIComponent(applicantId)}`,
      );
      setRows(mine);
    } catch (e) {
      setErr(`申請一覧を取得できませんでした: ${(e as Error).message}`);
    }
    if (!isAdmin) {
      setQueue([]);
      return;
    }
    try {
      const all = await apiGet<DigApplicationRow[]>("/api/dig-applications");
      setQueue(all.filter((r) => r.status === "申請中"));
    } catch {
      /* 承認キューの取得失敗は一覧表示に影響させない */
    }
  }, [applicantId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // 顧客IDで契約管理DBを検索し、1件なら即反映・複数なら選択させる。
  const lookup = async () => {
    const id = form.companyId.trim();
    if (!id) {
      setErr("顧客IDを入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const found = await apiGet<ContractHit[]>(`/api/contracts/lookup?companyId=${encodeURIComponent(id)}`);
      setHits(found);
      if (found.length === 0) {
        setMsg("契約管理DBに該当する契約がありません。企業名・契約内容は手入力してください。");
      } else if (found.length === 1) {
        applyHit(found[0]);
        setMsg("契約管理DBから反映しました。内容を確認して申請してください。");
      } else {
        setMsg(`${found.length}件見つかりました。該当の契約を選択してください。`);
      }
    } catch (e) {
      setErr(`契約DBを参照できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyHit = (h: ContractHit) => {
    setForm((f) => ({
      ...f,
      companyId: h.companyId ?? f.companyId,
      companyName: h.companyName,
      productName: h.productName || f.productName,
      contractSummary: [h.companyName, h.contractSummary].filter(Boolean).join("、"),
      contractId: h.contractId,
      grantedDig: h.suggestedDig > 0 ? String(h.suggestedDig) : f.grantedDig,
      contractDate: h.startDate ?? f.contractDate,
    }));
  };

  const submit = async () => {
    setErr(null);
    setMsg(null);
    const granted = Number(form.grantedDig);
    const split = form.splitDig.trim() === "" ? 0 : Number(form.splitDig);
    if (!form.companyName.trim()) return setErr("企業名を入力してください");
    if (!form.productName.trim()) return setErr("商材を入力してください");
    if (!Number.isFinite(granted) || granted <= 0) return setErr("獲得ポイント(D)を入力してください");
    if (!Number.isFinite(split) || split < 0) return setErr("折半ポイント(D)が不正です");
    if (split > granted) return setErr("折半ポイントは獲得ポイント以下にしてください");
    if (split > 0 && !form.splitPartnerId) return setErr("折半相手を選択してください");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.contractDate)) return setErr("契約日を入力してください");
    setBusy(true);
    try {
      await apiSend("/api/dig-applications", "POST", {
        applicantId,
        companyId: form.companyId.trim() || null,
        companyName: form.companyName.trim(),
        productName: form.productName.trim(),
        contractSummary: form.contractSummary.trim() || null,
        contractId: form.contractId || null,
        grantedDig: granted,
        splitDig: split,
        splitPartnerId: split > 0 ? form.splitPartnerId : null,
        contractDate: form.contractDate,
        note: form.note.trim() || null,
      });
      setForm({ ...EMPTY_FORM });
      setHits(null);
      setMsg("Dig申請を登録しました。承認されると契約日の月の成果Digに反映されます。");
      await load();
    } catch (e) {
      setErr(`申請できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: number, approve: boolean) => {
    const reason = approve ? null : window.prompt("却下理由を入力してください（任意）") ?? null;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiSend<{ applied: boolean; partnerApplied: boolean }>(
        `/api/dig-applications/${id}/decision`,
        "POST",
        { approve, actor: actorId, rejectReason: reason },
      );
      setMsg(
        approve
          ? r.applied
            ? "承認しました。契約日の月の成果Digへ加算しました。"
            : "承認しました。※契約日の月の評価台帳が未作成のため、Digは台帳生成時に反映されません（評価台帳を生成してから再確認してください）。"
          : "却下しました。",
      );
      await load();
    } catch (e) {
      setErr(`処理できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pendingMine = useMemo(() => rows.filter((r) => r.status === "申請中").length, [rows]);
  const approvedTotal = useMemo(
    () =>
      rows
        .filter((r) => r.status === "承認済")
        .reduce(
          (a, r) => a + (r.applicantId === applicantId ? r.grantedDig - r.splitDig : r.splitDig),
          0,
        ),
    [rows, applicantId],
  );

  return (
    <>
      <SectionHeader
        title="Dig申請（成果Dig）"
        note={`申請中 ${pendingMine}件 / 承認済 計 ${man(approvedTotal)}`}
      />

      {isSelf && (
        <div className="mb-4 rounded-card border border-surface-border bg-white shadow-card">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-ink"
          >
            <span>＋ 新規申請（顧客IDを入れると契約管理DBから自動記載）</span>
            <span className="text-ink-muted">{open ? "閉じる" : "開く"}</span>
          </button>

          {open && (
            <div className="border-t border-surface-border px-4 py-4">
              {/* 顧客IDから契約DBを参照 */}
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <Field label="顧客ID" hint="契約管理DBの顧客ID／契約番号">
                  <input
                    value={form.companyId}
                    onChange={(e) => set("companyId", e.target.value)}
                    placeholder="例: C-10023"
                    className="w-56 rounded-card border border-surface-border px-3 py-1.5 text-sm"
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => void lookup()}
                  disabled={busy}
                  className="rounded-card bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  契約DBから取得
                </button>
              </div>

              {hits && hits.length > 1 && (
                <div className="mb-4 overflow-x-auto rounded-card border border-surface-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-surface-border bg-surface-panel text-left text-ink-muted">
                        <th className="px-2 py-1.5 font-semibold">契約番号</th>
                        <th className="px-2 py-1.5 font-semibold">企業名</th>
                        <th className="px-2 py-1.5 font-semibold">商材</th>
                        <th className="px-2 py-1.5 font-semibold">契約内容</th>
                        <th className="px-2 py-1.5 font-semibold">契約日</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Dig目安</th>
                        <th className="px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {hits.map((h) => (
                        <tr key={h.contractId} className="border-b border-surface-border last:border-0">
                          <td className="px-2 py-1.5">{h.contractNo ?? "—"}</td>
                          <td className="px-2 py-1.5">{h.companyName}</td>
                          <td className="px-2 py-1.5">{h.productName}</td>
                          <td className="px-2 py-1.5">{h.contractSummary ?? "—"}</td>
                          <td className="px-2 py-1.5">{h.startDate ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right">{yen(h.suggestedDig)}</td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => applyHit(h)}
                              className="rounded-card border border-brand-primary px-2 py-0.5 font-semibold text-brand-primary"
                            >
                              反映
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 申請内容 */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="申請主">
                  <input
                    value={applicantName}
                    readOnly
                    className="w-full rounded-card border border-surface-border bg-surface-panel px-3 py-1.5 text-sm text-ink-muted"
                  />
                </Field>
                <Field label="商材" hint="例: AIテレアポ">
                  <input
                    value={form.productName}
                    onChange={(e) => set("productName", e.target.value)}
                    placeholder="AIテレアポ"
                    className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="企業名">
                  <input
                    value={form.companyName}
                    onChange={(e) => set("companyName", e.target.value)}
                    placeholder="株式会社データラーニング"
                    className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="契約内容" hint="例: 株式会社データラーニング、3ヵ月プラン">
                  <input
                    value={form.contractSummary}
                    onChange={(e) => set("contractSummary", e.target.value)}
                    placeholder="株式会社データラーニング、3ヵ月プラン"
                    className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="獲得ポイント（D）">
                  <input
                    value={form.grantedDig}
                    onChange={(e) => set("grantedDig", e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="numeric"
                    placeholder="750000"
                    className="tabular w-full rounded-card border border-surface-border px-3 py-1.5 text-right text-sm"
                  />
                </Field>
                <Field label="契約日">
                  <input
                    type="date"
                    value={form.contractDate}
                    onChange={(e) => set("contractDate", e.target.value)}
                    className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="折半ポイント（D）" hint="無しは空欄（0）">
                  <input
                    value={form.splitDig}
                    onChange={(e) => set("splitDig", e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="numeric"
                    placeholder="0"
                    className="tabular w-full rounded-card border border-surface-border px-3 py-1.5 text-right text-sm"
                  />
                </Field>
                <Field label="折半相手" hint="折半ポイントがある場合のみ">
                  <select
                    value={form.splitPartnerId}
                    onChange={(e) => set("splitPartnerId", e.target.value)}
                    disabled={form.splitDig.trim() === "" || Number(form.splitDig) === 0}
                    className="w-full rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm disabled:bg-surface-panel disabled:text-ink-faint"
                  >
                    <option value="">無し</option>
                    {members
                      .filter((m) => m.personId !== applicantId)
                      .map((m) => (
                        <option key={m.personId} value={m.personId}>
                          {m.name}（{m.division}）
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="備考">
                    <textarea
                      value={form.note}
                      onChange={(e) => set("note", e.target.value)}
                      rows={2}
                      className="w-full rounded-card border border-surface-border px-3 py-1.5 text-sm"
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className="rounded-card bg-brand-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  申請する
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForm({ ...EMPTY_FORM });
                    setHits(null);
                    setMsg(null);
                    setErr(null);
                  }}
                  className="rounded-card border border-surface-border px-4 py-2 text-sm font-semibold text-ink-muted"
                >
                  クリア
                </button>
                <span className="text-[11px] text-ink-faint">
                  承認されると契約日の月の成果Digへ加算されます（折半分は相手側へ計上）。
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div className="mb-3 rounded-card bg-emerald-50 px-3 py-2 text-xs text-semantic-success">{msg}</div>}
      {err && <div className="mb-3 rounded-card bg-rose-50 px-3 py-2 text-xs text-semantic-danger">{err}</div>}

      {/* 申請一覧（本人分／折半相手として関係する分） */}
      <div className="mb-6 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">契約日</th>
              <th className="px-3 py-2 font-semibold">申請主</th>
              <th className="px-3 py-2 font-semibold">商材</th>
              <th className="px-3 py-2 font-semibold">契約内容</th>
              <th className="px-3 py-2 text-right font-semibold">獲得(D)</th>
              <th className="px-3 py-2 text-right font-semibold">折半(D)</th>
              <th className="px-3 py-2 font-semibold">折半相手</th>
              <th className="px-3 py-2 text-center font-semibold">状態</th>
              <th className="px-3 py-2 font-semibold">備考</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-3 text-ink-muted">
                  Dig申請はまだありません
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-surface-border last:border-0">
                  <td className="px-3 py-2 text-ink-muted">{r.contractDate}</td>
                  <td className="px-3 py-2">{r.applicantName}</td>
                  <td className="px-3 py-2">{r.productName}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.contractSummary ?? r.companyName}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">{yen(r.grantedDig)}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{r.splitDig > 0 ? yen(r.splitDig) : "無し"}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.splitPartnerName ?? "無し"}</td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {r.status === "却下" && r.rejectReason ? `却下理由: ${r.rejectReason}` : (r.note ?? "—")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 承認キュー（ADMIN以上） */}
      {isAdmin && (
        <>
          <SectionHeader title="Dig申請の承認（ADMIN以上）" note={`未処理 ${queue.length}件`} />
          <div className="mb-6 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-3 py-2 font-semibold">契約日</th>
                  <th className="px-3 py-2 font-semibold">申請主</th>
                  <th className="px-3 py-2 font-semibold">商材</th>
                  <th className="px-3 py-2 font-semibold">契約内容</th>
                  <th className="px-3 py-2 text-right font-semibold">獲得(D)</th>
                  <th className="px-3 py-2 text-right font-semibold">折半(D)</th>
                  <th className="px-3 py-2 font-semibold">折半相手</th>
                  <th className="px-3 py-2 font-semibold">備考</th>
                  <th className="px-3 py-2 text-center font-semibold">判定</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {queue.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-3 text-ink-muted">
                      未処理の申請はありません
                    </td>
                  </tr>
                ) : (
                  queue.map((r) => (
                    <tr key={r.id} className="border-b border-surface-border last:border-0">
                      <td className="px-3 py-2 text-ink-muted">{r.contractDate}</td>
                      <td className="px-3 py-2 font-medium text-ink">{r.applicantName}</td>
                      <td className="px-3 py-2">{r.productName}</td>
                      <td className="px-3 py-2 text-ink-muted">{r.contractSummary ?? r.companyName}</td>
                      <td className="px-3 py-2 text-right font-semibold text-ink">{yen(r.grantedDig)}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{r.splitDig > 0 ? yen(r.splitDig) : "無し"}</td>
                      <td className="px-3 py-2 text-ink-muted">{r.splitPartnerName ?? "無し"}</td>
                      <td className="px-3 py-2 text-xs text-ink-muted">{r.note ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => void decide(r.id, true)}
                            disabled={busy}
                            className="rounded-card bg-semantic-success px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            承認
                          </button>
                          <button
                            type="button"
                            onClick={() => void decide(r.id, false)}
                            disabled={busy}
                            className="rounded-card border border-surface-border px-3 py-1 text-xs font-semibold text-ink-muted disabled:opacity-50"
                          >
                            却下
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[11px] text-ink-faint">
              ※ 承認すると契約日の年月の評価へ成果Digを加算します（確定済みの月は加算できません）。
            </div>
          </div>
        </>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "承認済"
      ? "bg-emerald-100 text-semantic-success"
      : status === "申請中"
        ? "bg-amber-100 text-semantic-warn"
        : "bg-rose-100 text-semantic-danger";
  return <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
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
