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

interface Unlinked {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface PickerMember {
  personId: string;
  name: string;
  division: string;
}

interface ProvisionResult {
  scope: string;
  divisions: string[] | null;
  targets: number;
  created: number;
  updated: number;
  skipped: { personId: string; name: string; reason: string }[];
  placeholders: { personId: string; name: string; email: string }[];
  credentials: { personId: string; name: string; email: string; temporaryPassword: string }[];
}

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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  // サインインしたが従業員マスタと自動突合できなかったアカウント（管理者が紐付ける）。
  const [unlinked, setUnlinked] = useState<Unlinked[]>([]);
  const [pickerMembers, setPickerMembers] = useState<PickerMember[]>([]);
  const [linkInput, setLinkInput] = useState<Record<string, string>>({});

  async function load() {
    try {
      setAccounts(await apiGet<Account[]>("/api/accounts"));
      setSource("db");
    } catch {
      setSource("mock");
    }
    try {
      const [u, m] = await Promise.all([
        apiGet<Unlinked[]>("/api/accounts/unlinked"),
        apiGet<PickerMember[]>("/api/my-page/members"),
      ]);
      setUnlinked(u);
      setPickerMembers(m);
    } catch {
      /* 紐付け待ちの取得失敗は一覧表示に影響させない */
    }
  }

  // 紐付け待ちアカウントへ従業員IDを設定する（権限は変更しない）。
  async function link(a: Unlinked, personId: string) {
    if (!personId) return;
    setBusy(true);
    try {
      await apiSend("/api/accounts", "POST", {
        id: a.id,
        email: a.email,
        name: pickerMembers.find((m) => m.personId === personId)?.name ?? a.name,
        role: a.role,
        personId,
        active: true,
        actor: ACTOR,
      });
      setMsg(`${a.email} を従業員 ${personId} に紐付けました`);
      setLinkInput((prev) => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
      await load();
    } catch (e) {
      setMsg(`紐付け失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  // 在籍メンバーへユーザー権限のアカウントを一括発行（既存アカウントの権限は変更しない）。
  async function provision(scope: "target" | "all", reset = false) {
    const label = scope === "target" ? "評価対象事業部" : "全在籍メンバー";
    const note = reset
      ? "\n※ 既にパスワードを設定済みの人も仮パスワードにリセットされます。"
      : "\n※ 既にパスワードがある人は変更しません。";
    if (!confirm(`${label}の在籍メンバーへ「ユーザー」権限のアカウントと仮パスワードを発行します。${note}\nよろしいですか？`)) return;
    setBusy(true);
    setMsg(`${label}のアカウントを発行中…`);
    try {
      const res = await apiSend<ProvisionResult>("/api/accounts/provision", "POST", {
        actor: ACTOR,
        scope,
        role: "USER",
        // 各自の仮パスワードを同時に生成する（平文は応答でのみ受け取る）。
        issuePasswords: true,
        resetExisting: reset,
      });
      setResult(res);
      const parts = [`対象${res.targets}名`, `新規${res.created}件`, `既存${res.updated}件（権限は変更なし）`];
      parts.push(`仮パスワード発行${res.credentials.length}件`);
      if (res.placeholders.length > 0) parts.push(`仮メール${res.placeholders.length}件（要修正）`);
      if (res.skipped.length > 0) parts.push(`スキップ${res.skipped.length}件`);
      setMsg(`アカウント発行完了: ${parts.join(" / ")}`);
      await load();
    } catch (e) {
      setMsg(`発行失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // 1名の仮パスワードを再発行する（平文は画面に一度だけ表示される）。
  async function reissue(id: string, name: string) {
    if (!confirm(`${name} の仮パスワードを再発行します。現在のパスワードは使えなくなります。よろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await apiSend<{ email: string; name: string; temporaryPassword: string }>(
        `/api/accounts/${encodeURIComponent(id)}/password`,
        "POST",
        { actor: ACTOR },
      );
      setResult({
        scope: "single",
        divisions: null,
        targets: 1,
        created: 0,
        updated: 1,
        skipped: [],
        placeholders: [],
        credentials: [{ personId: "", name: r.name, email: r.email, temporaryPassword: r.temporaryPassword }],
      });
      setMsg(`${r.name} の仮パスワードを再発行しました。下の一覧から控えて本人へ渡してください。`);
      await load();
    } catch (e) {
      setMsg(`再発行失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

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

      {/* 一括発行（従業員マスタ → ユーザー権限アカウント） */}
      <div className="mb-4 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-2 text-sm font-semibold text-ink">従業員マスタから一括発行（ユーザー権限）</div>
        <div className="mb-3 text-xs text-ink-muted">
          在籍メンバー全員へ「ユーザー」権限のアカウントを作成します。メールは jinjer の会社メールを使用し、
          取得できない人は <span className="tabular">従業員ID@{"dgloss.co.jp"}</span> の仮メールで発行します（下に一覧表示・要修正）。
          既にアカウントがある人は氏名と従業員IDの紐付けだけ更新し、<b>権限は変更しません</b>。
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void provision("target")}
            disabled={busy}
            className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
          >
            評価対象事業部のメンバーに発行
          </button>
          <button
            onClick={() => void provision("all")}
            disabled={busy}
            className="rounded-card border border-brand-primary px-4 py-1.5 text-sm font-bold text-brand-primary disabled:opacity-50"
          >
            全在籍メンバーに発行
          </button>
          <button
            onClick={() => void provision("all", true)}
            disabled={busy}
            className="rounded-card border border-semantic-warn px-4 py-1.5 text-sm font-bold text-semantic-warn disabled:opacity-50"
          >
            全員の仮パスワードを再発行
          </button>
        </div>

        {result && result.credentials.length > 0 && (
          <div className="mt-4 rounded-card border border-brand-primary bg-blue-50 p-3">
            <div className="mb-1 text-sm font-semibold text-brand-primary">
              発行した仮パスワード {result.credentials.length}件
            </div>
            <div className="mb-2 text-xs text-ink-muted">
              パスワードはハッシュ化して保存されるため、<b>この画面を閉じると二度と表示できません</b>。
              コピーまたはCSVで控えて各自へ配布してください。本人は初回ログイン後にパスワード変更を求められます。
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                onClick={() => copyCredentials(result.credentials)}
                className="rounded-card bg-brand-primary px-3 py-1 text-xs font-semibold text-white"
              >
                一覧をコピー
              </button>
              <button
                onClick={() => downloadCredentials(result.credentials)}
                className="rounded-card border border-brand-primary px-3 py-1 text-xs font-semibold text-brand-primary"
              >
                CSVをダウンロード
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-card bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-panel text-left text-ink-muted">
                    <th className="px-2 py-1.5 font-semibold">氏名</th>
                    <th className="px-2 py-1.5 font-semibold">ログインID（メール）</th>
                    <th className="px-2 py-1.5 font-semibold">仮パスワード</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {result.credentials.map((c) => (
                    <tr key={c.email} className="border-b border-surface-border last:border-0">
                      <td className="px-2 py-1.5">{c.name}</td>
                      <td className="px-2 py-1.5 text-ink-muted">{c.email}</td>
                      <td className="px-2 py-1.5 font-mono font-semibold text-ink">{c.temporaryPassword}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (result.placeholders.length > 0 || result.skipped.length > 0) && (
          <div className="mt-3 space-y-2 text-xs">
            {result.placeholders.length > 0 && (
              <details className="rounded-card bg-amber-50 px-3 py-2 text-semantic-warn">
                <summary className="cursor-pointer font-semibold">
                  仮メールで発行した {result.placeholders.length}名（実メールへ修正してください）
                </summary>
                <div className="mt-2 space-y-0.5 text-ink-muted">
                  {result.placeholders.map((p) => (
                    <div key={p.personId} className="tabular">
                      {p.personId} {p.name} → {p.email}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {result.skipped.length > 0 && (
              <details className="rounded-card bg-rose-50 px-3 py-2 text-semantic-danger">
                <summary className="cursor-pointer font-semibold">発行できなかった {result.skipped.length}名</summary>
                <div className="mt-2 space-y-0.5 text-ink-muted">
                  {result.skipped.map((p) => (
                    <div key={p.personId} className="tabular">
                      {p.personId} {p.name}（{p.reason}）
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* 紐付け待ち（サインイン済みだが従業員マスタと突合できなかった人） */}
      {unlinked.length > 0 && (
        <div className="mb-4 rounded-card border border-semantic-warn bg-amber-50 p-4">
          <div className="mb-2 text-sm font-semibold text-semantic-warn">
            従業員マスタと紐付いていないアカウント {unlinked.length}件
          </div>
          <div className="mb-3 text-xs text-ink-muted">
            サインインはできていますが、会社メール・氏名のどちらでも従業員を特定できませんでした。
            紐付けるとマイページ（本人の実績・借入・Dig申請）が表示されます。
          </div>
          <div className="space-y-2">
            {unlinked.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">{a.name}</span>
                <span className="text-ink-muted">{a.email}</span>
                <select
                  value={linkInput[a.id] ?? ""}
                  onChange={(e) => setLinkInput({ ...linkInput, [a.id]: e.target.value })}
                  className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                >
                  <option value="">従業員を選択</option>
                  {pickerMembers.map((m) => (
                    <option key={m.personId} value={m.personId}>
                      {m.name}（{m.personId}／{m.division}）
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void link(a, linkInput[a.id] ?? "")}
                  disabled={busy || !linkInput[a.id]}
                  className="rounded-card bg-brand-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  紐付け
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <button onClick={() => void reissue(a.id, a.name)} className="mr-2 text-xs font-semibold text-semantic-warn">仮PW発行</button>
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

type Credential = { personId: string; name: string; email: string; temporaryPassword: string };

/** 仮パスワード一覧をタブ区切りでクリップボードへ（チャット等へ貼りやすい形）。 */
function copyCredentials(rows: Credential[]) {
  const text = ["氏名\tログインID\t仮パスワード", ...rows.map((c) => `${c.name}\t${c.email}\t${c.temporaryPassword}`)].join("\n");
  void navigator.clipboard.writeText(text);
}

/** 仮パスワード一覧をCSVでダウンロード（Excelで開けるよう BOM 付き）。 */
function downloadCredentials(rows: Credential[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = ["氏名,ログインID,仮パスワード", ...rows.map((c) => [c.name, c.email, c.temporaryPassword].map(esc).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dig-temporary-passwords.csv";
  a.click();
  URL.revokeObjectURL(url);
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
