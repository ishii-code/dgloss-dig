"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { yen } from "@/lib/format";
import { SectionHeader } from "./ui";

const ACTOR = "B0000071";
const YM = "2026-01";
const POSITIONS = ["部長", "マネージャー", "リーダー", "メンバー"];
const JOBS = ["FS", "IS", "CS"];
const EMP = ["正社員", "アルバイト"];
const CYCLES = ["四半期", "半期"];

interface Member {
  personId: string;
  name: string;
  division: string;
  position: string;
  jobType: string | null;
  employmentType: string;
  basePay: number;
  positionBase: number;
  joinedOn: string;
  evaluationCycle: string;
  status: string;
}

const emptyMember: Member = {
  personId: "",
  name: "",
  division: "AIテレアポ事業部",
  position: "メンバー",
  jobType: "IS",
  employmentType: "正社員",
  basePay: 300000,
  positionBase: 345000,
  joinedOn: "2026-01-01",
  evaluationCycle: "四半期",
  status: "在籍",
};

// ── 従業員マスタ編集（要件 F-2）──
export function MemberMaster() {
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState<Member>(emptyMember);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  async function load() {
    try {
      const m = await apiGet<Member[]>("/api/members");
      setMembers(
        m.map((x) => ({ ...x, joinedOn: (x.joinedOn ?? "").slice(0, 10) })),
      );
      setSource("db");
    } catch {
      setSource("mock");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form.personId || !form.name) {
      setMsg("Person ID と 氏名 は必須です");
      return;
    }
    try {
      await apiSend("/api/members", "POST", { ...form, actor: ACTOR });
      setMsg(`従業員 ${form.name}（${form.personId}）を保存しました`);
      setForm(emptyMember);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${(e as Error).message}`);
    }
  }
  async function del(personId: string) {
    if (!confirm(`${personId} を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/members/${personId}?actor=${ACTOR}`, { method: "DELETE" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "削除失敗");
      setMsg(`${personId} を削除しました`);
      await load();
    } catch (e) {
      setMsg(`削除失敗: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <SectionHeader title="従業員マスタ" note="Person ID は手入力（v1.1 Q4）。全連携の突合キー。" />
      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      <div className="mb-4 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">Person ID</th>
              <th className="px-3 py-2 font-semibold">氏名</th>
              <th className="px-3 py-2 font-semibold">事業部</th>
              <th className="px-3 py-2 font-semibold">役職/職種</th>
              <th className="px-3 py-2 font-semibold">雇用</th>
              <th className="px-3 py-2 text-right font-semibold">役職ベース</th>
              <th className="px-3 py-2 font-semibold">サイクル</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {members.map((m) => (
              <tr key={m.personId} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2 text-ink-muted">{m.personId}</td>
                <td className="px-3 py-2 font-medium text-ink">{m.name}</td>
                <td className="px-3 py-2 text-ink-muted">{m.division}</td>
                <td className="px-3 py-2 text-ink-muted">{m.position}/{m.jobType ?? "—"}</td>
                <td className="px-3 py-2 text-ink-muted">{m.employmentType}</td>
                <td className="px-3 py-2 text-right">{yen(m.positionBase)}</td>
                <td className="px-3 py-2 text-ink-muted">{m.evaluationCycle}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => setForm(m)} className="mr-2 text-xs font-semibold text-brand-primary">編集</button>
                  <button onClick={() => del(m.personId)} className="text-xs text-semantic-danger">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">従業員 登録 / 更新</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <F label="Person ID"><input className="inp" value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })} /></F>
          <F label="氏名"><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
          <F label="事業部"><input className="inp" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} /></F>
          <F label="役職"><select className="inp" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select></F>
          <F label="職種"><select className="inp" value={form.jobType ?? ""} onChange={(e) => setForm({ ...form, jobType: e.target.value || null })}><option value="">—</option>{JOBS.map((j) => <option key={j}>{j}</option>)}</select></F>
          <F label="雇用形態"><select className="inp" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>{EMP.map((x) => <option key={x}>{x}</option>)}</select></F>
          <F label="基本給与"><input type="number" className="inp" value={form.basePay} onChange={(e) => setForm({ ...form, basePay: Number(e.target.value) })} /></F>
          <F label="役職ベース"><input type="number" className="inp" value={form.positionBase} onChange={(e) => setForm({ ...form, positionBase: Number(e.target.value) })} /></F>
          <F label="入社日"><input type="date" className="inp" value={form.joinedOn} onChange={(e) => setForm({ ...form, joinedOn: e.target.value })} /></F>
          <F label="評価サイクル"><select className="inp" value={form.evaluationCycle} onChange={(e) => setForm({ ...form, evaluationCycle: e.target.value })}>{CYCLES.map((c) => <option key={c}>{c}</option>)}</select></F>
          <F label="ステータス"><select className="inp" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>在籍</option><option>退社</option></select></F>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white">保存</button>
          <button onClick={() => setForm(emptyMember)} className="rounded-card border border-surface-border px-4 py-1.5 text-sm text-ink-muted">クリア</button>
        </div>
      </div>
      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>
    </>
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
