"use client";

import { ROLE_LABEL, type Role } from "@dig/contracts";
import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "USER"];

interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  personId: string | null;
  active: boolean;
}

const empty: Account = { id: "", email: "", name: "", role: "USER", personId: null, active: true };

function roleStyle(role: Role): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "bg-violet-100 text-brand-accent";
    case "ADMIN":
      return "bg-blue-100 text-brand-primary";
    default:
      return "bg-slate-100 text-ink-muted";
  }
}

export function AccountsAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<Account>(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  async function load() {
    try {
      setAccounts(await apiGet<Account[]>("/api/accounts"));
      setSource("db");
    } catch {
      setSource("mock");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form.id || !form.email || !form.name) {
      setMsg("ID・メール・氏名 は必須です");
      return;
    }
    try {
      await apiSend("/api/accounts", "POST", { ...form, actor: ACTOR });
      setMsg(`アカウント ${form.name} を保存しました`);
      setForm(empty);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${(e as Error).message}`);
    }
  }
  async function del(id: string) {
    if (!confirm(`${id} を削除しますか？`)) return;
    const res = await fetch(`/api/accounts/${encodeURIComponent(id)}?actor=${ACTOR}`, { method: "DELETE" });
    if (res.ok) {
      setMsg(`${id} を削除しました`);
      await load();
    }
  }

  return (
    <>
      <SectionHeader
        title="アカウント管理"
        note="スーパーADMINのみアクセス可。権限（スーパーADMIN／ADMIN／ユーザー）を付与。"
        accent="accent"
      />

      {/* 権限の凡例 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <RoleCard role="SUPER_ADMIN" desc="全機能＋金融承認・従業員マスタ・アカウント管理" />
        <RoleCard role="ADMIN" desc="運用＋Dig獲得ルール・設定編集（金融承認/従業員マスタ 不可）" />
        <RoleCard role="USER" desc="閲覧のみ（予実・評価・ボーナス・取引・リリース）" />
      </div>

      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      <div className="mb-4 overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-4 py-2.5 font-semibold">氏名</th>
              <th className="px-4 py-2.5 font-semibold">メール</th>
              <th className="px-4 py-2.5 font-semibold">権限</th>
              <th className="px-4 py-2.5 font-semibold">従業員ID</th>
              <th className="px-4 py-2.5 text-center font-semibold">状態</th>
              <th className="px-4 py-2.5 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                <td className="px-4 py-2.5 text-ink-muted">{a.email}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${roleStyle(a.role)}`}>
                    {ROLE_LABEL[a.role]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{a.personId ?? "—"}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs ${a.active ? "text-semantic-success" : "text-ink-faint"}`}>
                    {a.active ? "有効" : "無効"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => setForm(a)} className="mr-2 text-xs font-semibold text-brand-primary">編集</button>
                  <button onClick={() => del(a.id)} className="text-xs text-semantic-danger">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">アカウント 登録 / 更新</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Fld label="ID(メール)"><input className="inp" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value, email: form.email || e.target.value })} /></Fld>
          <Fld label="メール"><input className="inp" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Fld>
          <Fld label="氏名"><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="権限">
            <select className="inp" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Fld>
          <Fld label="従業員ID(任意)"><input className="inp" value={form.personId ?? ""} onChange={(e) => setForm({ ...form, personId: e.target.value || null })} /></Fld>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white">保存</button>
          <button onClick={() => setForm(empty)} className="rounded-card border border-surface-border px-4 py-1.5 text-sm text-ink-muted">クリア</button>
        </div>
      </div>
      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>
    </>
  );
}

function RoleCard({ role, desc }: { role: Role; desc: string }) {
  return (
    <div className="rounded-card border border-surface-border bg-white p-3 shadow-card">
      <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${roleStyle(role)}`}>{ROLE_LABEL[role]}</span>
      <div className="mt-2 text-xs text-ink-muted">{desc}</div>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
