"use client";

import { COMPANY_LENDER } from "@dig/contracts";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man } from "@/lib/format";
import { type CurrentAccount, LoanThread } from "./loan-thread";
import { SectionHeader } from "./ui";

interface LoanRow {
  id: number;
  borrowerId: string;
  lender: string;
  loanType: string;
  status: string;
  principal: number;
  termMonths: number;
  reason: string | null;
}
interface Att {
  fileName: string;
  category: "事業計画" | "その他";
  note: string | null;
}

function statusStyle(s: string): string {
  if (s === "承認済") return "bg-emerald-100 text-semantic-success";
  if (s === "申請中") return "bg-amber-100 text-semantic-warn";
  if (s === "差し戻し") return "bg-orange-100 text-semantic-warn";
  if (s === "却下") return "bg-rose-100 text-semantic-danger";
  return "bg-slate-100 text-ink-muted";
}

export function LoanApply({
  account,
  onChanged,
}: {
  account: CurrentAccount;
  onChanged?: () => void;
}) {
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [members, setMembers] = useState<{ personId: string; name: string }[]>([]);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  // フォーム
  const [lenderKind, setLenderKind] = useState<"会社" | "相対">("会社");
  const [lenderPersonId, setLenderPersonId] = useState("");
  const [principal, setPrincipal] = useState(1000000);
  const [termMonths, setTermMonths] = useState(12);
  const [reason, setReason] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);

  const load = useCallback(async () => {
    try {
      const [l, m, u] = await Promise.all([
        apiGet<LoanRow[]>("/api/loans"),
        apiGet<{ personId: string; name: string }[]>("/api/members"),
        apiGet<{ perLoan: Record<number, number> }>(`/api/loans/unread?accountId=${account.id}`),
      ]);
      setLoans(l);
      setMembers(m);
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

  const mine = loans.filter((l) => l.borrowerId === account.personId);
  const toMe = loans.filter((l) => l.lender === account.personId); // 相対で自分が貸し手

  async function apply() {
    if (!account.personId) {
      setMsg("この権限は従業員に紐付いていないため申請できません");
      return;
    }
    if (!reason.trim()) {
      setMsg("用途は必須です");
      return;
    }
    if (lenderKind === "相対" && !lenderPersonId) {
      setMsg("相対の相手を選択してください");
      return;
    }
    try {
      await apiSend("/api/loans", "POST", {
        borrowerId: account.personId,
        lenderKind,
        lenderPersonId: lenderKind === "相対" ? lenderPersonId : null,
        principal,
        termMonths,
        reason,
        attachments: atts,
        applicantAccountId: account.id,
        applicantName: account.name,
      });
      setMsg("借入を申請しました");
      setReason("");
      setAtts([]);
      refresh();
    } catch (e) {
      setMsg(`申請失敗: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <SectionHeader
        title="借入申請（ディグロスバンク / 相対）"
        note="会社借入・メンバー間の相対貸借はいずれも申請承認ベース。事業計画等を添付できます。"
      />
      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      {/* 申請フォーム */}
      <div className="mb-6 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">新規申請</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <F label="借入元">
            <select className="inp" value={lenderKind} onChange={(e) => setLenderKind(e.target.value as "会社" | "相対")}>
              <option value="会社">会社（ディグロスバンク）</option>
              <option value="相対">相対（メンバー間）</option>
            </select>
          </F>
          {lenderKind === "相対" && (
            <F label="貸し手">
              <select className="inp" value={lenderPersonId} onChange={(e) => setLenderPersonId(e.target.value)}>
                <option value="">選択</option>
                {members.filter((m) => m.personId !== account.personId).map((m) => (
                  <option key={m.personId} value={m.personId}>{m.name}</option>
                ))}
              </select>
            </F>
          )}
          <F label="金額(Dig)"><input type="number" className="inp" value={principal} onChange={(e) => setPrincipal(Number(e.target.value))} /></F>
          <F label="返済期間(ヶ月)"><input type="number" className="inp" value={termMonths} onChange={(e) => setTermMonths(Number(e.target.value))} /></F>
          <F label="用途・事業計画の概要">
            <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: OJT期間の運転資金" />
          </F>
        </div>

        {/* 添付（事業計画など） */}
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-ink-muted">添付（事業計画など・銀行借入のように）</div>
          {atts.map((a, i) => (
            <div key={i} className="mb-1 flex items-center gap-2 text-sm">
              <span className="rounded-card border border-surface-border bg-surface-panel px-2 py-1 text-xs">📎 {a.fileName}</span>
              <button onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-xs text-semantic-danger">削除</button>
            </div>
          ))}
          <AttachAdder onAdd={(a) => setAtts([...atts, a])} />
        </div>

        <button onClick={apply} className="mt-3 rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white">申請する</button>
      </div>

      {/* 自分の申請 */}
      <LoanList title="自分の申請" rows={mine} unread={unread} open={open} setOpen={setOpen} account={account} onChanged={refresh} />

      {/* 相対で自分宛の申請 */}
      {toMe.length > 0 && (
        <div className="mt-6">
          <LoanList title="自分宛の相対申請（承認待ち含む）" rows={toMe} unread={unread} open={open} setOpen={setOpen} account={account} onChanged={refresh} />
        </div>
      )}
      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>
    </>
  );
}

function LoanList({
  title,
  rows,
  unread,
  open,
  setOpen,
  account,
  onChanged,
}: {
  title: string;
  rows: LoanRow[];
  unread: Record<number, number>;
  open: number | null;
  setOpen: (n: number | null) => void;
  account: CurrentAccount;
  onChanged: () => void;
}) {
  return (
    <>
      <div className="mb-2 text-sm font-semibold text-ink">{title}（{rows.length}件）</div>
      <div className="space-y-2">
        {rows.length === 0 && <div className="rounded-card border border-dashed border-surface-border p-4 text-center text-xs text-ink-faint">申請はありません</div>}
        {rows.map((l) => (
          <div key={l.id}>
            <button
              onClick={() => setOpen(open === l.id ? null : l.id)}
              className="flex w-full items-center gap-2 rounded-card border border-surface-border bg-white px-4 py-2.5 text-left text-sm shadow-card"
            >
              <span className="font-medium text-ink">借入 #{l.id}</span>
              <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] text-ink-muted">
                {l.lender === COMPANY_LENDER ? "会社" : "相対"}
              </span>
              <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${statusStyle(l.status)}`}>{l.status}</span>
              <span className="tabular text-ink-muted">{man(l.principal)}</span>
              <span className="ml-auto flex items-center gap-2">
                {unread[l.id] ? (
                  <span className="inline-flex min-w-[18px] items-center justify-center rounded-pill bg-semantic-danger px-1.5 text-[11px] font-bold text-white">
                    {unread[l.id]}
                  </span>
                ) : null}
                <span className="text-xs text-brand-primary">{open === l.id ? "閉じる" : "開く"}</span>
              </span>
            </button>
            {open === l.id && (
              <div className="mt-2">
                <LoanThread loanId={l.id} account={account} onChanged={onChanged} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function AttachAdder({ onAdd }: { onAdd: (a: Att) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        className="inp max-w-xs"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ファイル名（例: 事業計画_2026.pdf）"
      />
      <button
        onClick={() => {
          if (name.trim()) {
            onAdd({ fileName: name, category: "事業計画", note: null });
            setName("");
          }
        }}
        className="rounded-card border border-brand-primary px-3 py-1 text-xs font-semibold text-brand-primary"
      >
        添付を追加
      </button>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
