"use client";

import { COMPANY_LENDER } from "@dig/contracts";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man } from "@/lib/format";

export interface CurrentAccount {
  id: string;
  name: string;
  personId: string | null;
  role: string;
}

interface Msg {
  id: number;
  authorId: string;
  authorName: string;
  kind: string;
  body: string;
  createdAt: string;
}
interface Att {
  id: number;
  fileName: string;
  category: string;
  note: string | null;
}
interface Thread {
  id: number;
  borrowerId: string;
  lender: string;
  status: string;
  principal: number;
  termMonths: number;
  reason: string | null;
  messages: Msg[];
  attachments: Att[];
}

function statusStyle(s: string): string {
  switch (s) {
    case "承認済":
      return "bg-emerald-100 text-semantic-success";
    case "申請中":
      return "bg-amber-100 text-semantic-warn";
    case "差し戻し":
      return "bg-orange-100 text-semantic-warn";
    case "却下":
      return "bg-rose-100 text-semantic-danger";
    default:
      return "bg-slate-100 text-ink-muted";
  }
}
function kindStyle(k: string): string {
  if (k === "approve") return "text-semantic-success";
  if (k === "reject") return "text-semantic-danger";
  if (k === "return") return "text-semantic-warn";
  if (k === "apply") return "text-brand-primary";
  return "text-ink";
}

/** 借入申請スレッド（チャット・添付・承認/否決/差し戻し・再申請）。 */
export function LoanThread({
  loanId,
  account,
  onChanged,
}: {
  loanId: number;
  account: CurrentAccount;
  onChanged?: () => void;
}) {
  const [t, setT] = useState<Thread | null>(null);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    const data = await apiGet<Thread>(`/api/loans/${loanId}/thread?accountId=${account.id}`);
    setT(data);
  }, [loanId, account.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!t) return <div className="p-4 text-sm text-ink-muted">読み込み中…</div>;

  const isApplicant = t.borrowerId === account.personId;
  const isApprover =
    (t.lender === COMPANY_LENDER && account.role === "SUPER_ADMIN") ||
    t.lender === account.personId;
  const decidable = (t.status === "申請中" || t.status === "差し戻し") && isApprover;
  const resubmittable = t.status === "差し戻し" && isApplicant;

  async function post() {
    if (!comment.trim()) return;
    await apiSend(`/api/loans/${loanId}/messages`, "POST", {
      body: comment,
      authorAccountId: account.id,
      authorName: account.name,
    });
    setComment("");
    await load();
    onChanged?.();
  }
  async function decide(decision: "承認" | "否決" | "差し戻し") {
    await apiSend(`/api/loans/${loanId}/review`, "POST", {
      decision,
      comment: comment || null,
      actorAccountId: account.id,
      actorName: account.name,
    });
    setComment("");
    await load();
    onChanged?.();
  }
  async function resubmit() {
    await apiSend(`/api/loans/${loanId}/resubmit`, "POST", {
      body: comment || "内容を修正して再申請します",
      authorAccountId: account.id,
      authorName: account.name,
    });
    setComment("");
    await load();
    onChanged?.();
  }

  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">借入 #{t.id}</span>
        <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] text-ink-muted">
          {t.lender === COMPANY_LENDER ? "会社(ディグロスバンク)" : "相対"}
        </span>
        <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${statusStyle(t.status)}`}>{t.status}</span>
        <span className="tabular ml-auto text-sm text-ink-muted">
          {man(t.principal)} / {t.termMonths}ヶ月
        </span>
      </div>

      {/* 添付 */}
      {t.attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {t.attachments.map((a) => (
            <span key={a.id} className="rounded-card border border-surface-border bg-surface-panel px-2 py-1 text-xs text-ink">
              📎 {a.fileName}
              <span className="ml-1 text-ink-faint">{a.category}</span>
            </span>
          ))}
        </div>
      )}

      {/* チャット */}
      <div className="mb-3 max-h-72 space-y-2 overflow-y-auto rounded-card bg-surface-panel p-3">
        {t.messages.map((m) => {
          const mine = m.authorId === account.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${mine ? "bg-brand-primary text-white" : "bg-white text-ink shadow-card"}`}>
                <div className={`text-[11px] ${mine ? "text-white/80" : kindStyle(m.kind)}`}>
                  {m.authorName}
                  {m.kind !== "comment" && ` · ${m.kind === "apply" ? "申請" : m.kind === "approve" ? "承認" : m.kind === "reject" ? "否決" : "差し戻し"}`}
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 入力 */}
      <textarea
        className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
        rows={2}
        placeholder="コメント（過不足の確認など）"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={post} className="rounded-card border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink">
          コメント送信
        </button>
        {decidable && (
          <>
            <button onClick={() => decide("承認")} className="rounded-card bg-semantic-success px-3 py-1.5 text-xs font-bold text-white">承認</button>
            <button onClick={() => decide("差し戻し")} className="rounded-card bg-semantic-warn px-3 py-1.5 text-xs font-bold text-white">差し戻し</button>
            <button onClick={() => decide("否決")} className="rounded-card bg-semantic-danger px-3 py-1.5 text-xs font-bold text-white">否決</button>
          </>
        )}
        {resubmittable && (
          <button onClick={resubmit} className="rounded-card bg-brand-primary px-3 py-1.5 text-xs font-bold text-white">修正して再申請</button>
        )}
      </div>
    </div>
  );
}
