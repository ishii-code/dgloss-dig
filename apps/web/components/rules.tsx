"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { man, yen } from "@/lib/format";
import { SectionHeader } from "./ui";

const ACTOR = "B0000071";
const YM = "2026-01";
const RULE_TYPES = ["回線コール単価", "初回発注1to1", "月額基本料金割合", "固定Dig"] as const;

interface Rule {
  id: string;
  division: string;
  name: string;
  ruleType: string;
  modelKeyFilter: string | null;
  unitLine: number;
  unitCall: number;
  ratioPercent: number;
  fixedDig: number;
  active: boolean;
}
interface Share {
  personId: string;
  sharePercent: number;
}
interface ContractRow {
  contractId: string;
  contractNo: string | null;
  customerName: string;
  companyId: string | null;
  division: string;
  ruleName: string | null;
  source: string | null; // sfa / manual
  totalDig: number;
  shares: Share[];
  perPerson: { personId: string; dig: number }[];
}

const emptyRule: Rule = {
  id: "",
  division: "AIテレアポ事業部",
  name: "",
  ruleType: "回線コール単価",
  modelKeyFilter: "",
  unitLine: 50000,
  unitCall: 50000,
  ratioPercent: 0,
  fixedDig: 0,
  active: true,
};

export function RulesAndContracts() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [members, setMembers] = useState<{ personId: string; name: string }[]>([]);
  const [form, setForm] = useState<Rule>(emptyRule);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  async function load() {
    try {
      const [r, c, m] = await Promise.all([
        apiGet<Rule[]>("/api/calc-rules"),
        apiGet<ContractRow[]>(`/api/contracts?ym=${YM}`),
        apiGet<{ personId: string; name: string }[]>("/api/members"),
      ]);
      setRules(r);
      setContracts(c);
      setMembers(m);
      setSource("db");
    } catch {
      setSource("mock");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const nameOf = (id: string) => members.find((m) => m.personId === id)?.name ?? id;

  async function saveRule() {
    if (!form.id || !form.name) {
      setMsg("ID と 名称 は必須です");
      return;
    }
    try {
      await apiSend("/api/calc-rules", "POST", {
        ...form,
        modelKeyFilter: form.modelKeyFilter || null,
        actor: ACTOR,
      });
      setMsg(`ルール ${form.id} を保存しました`);
      setForm(emptyRule);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${(e as Error).message}`);
    }
  }

  async function saveShares(contractId: string, shares: Share[]) {
    try {
      await apiSend(`/api/contracts/${contractId}/assignment`, "PATCH", { shares, actor: ACTOR });
      setMsg(`契約 ${contractId} の帰属を更新しました`);
      await load();
    } catch (e) {
      setMsg(`帰属更新失敗: ${(e as Error).message}`);
    }
  }

  async function assignFromSfa() {
    try {
      const res = await apiSend<{ applied: number; total: number; spcrmConnected: boolean }>(
        "/api/contracts/assign-from-sfa",
        "POST",
        { yearMonth: YM, actor: ACTOR },
      );
      setMsg(
        `SP_CRMから担当者を自動設定: ${res.applied}/${res.total}件${res.spcrmConnected ? "（DB直結）" : "（サンプル）"}`,
      );
      await load();
    } catch (e) {
      setMsg(`自動設定失敗: ${(e as Error).message}`);
    }
  }

  async function reflect() {
    try {
      const res = await apiSend<{ updated: number; contracts: number }>(
        "/api/contracts/reflect",
        "POST",
        { yearMonth: YM, actor: ACTOR },
      );
      setMsg(`Dig反映: ${res.contracts}契約 → ${res.updated}名の成果Digを更新しました`);
      await load();
    } catch (e) {
      setMsg(`反映失敗: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <SectionHeader
        title="Dig獲得ルール（事業部別）"
        note="1契約でどういう契約内容だと何Dig付与するかを定義（要件 F-3）"
        accent="accent"
      />
      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">
          DB未接続のためモック表示です（`pnpm db:seed` と DATABASE_URL 設定が必要）。
        </div>
      )}
      {msg && (
        <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>
      )}

      {/* ルール一覧 */}
      <div className="mb-4 overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">ID</th>
              <th className="px-3 py-2 font-semibold">事業部</th>
              <th className="px-3 py-2 font-semibold">ルール名</th>
              <th className="px-3 py-2 font-semibold">種別</th>
              <th className="px-3 py-2 font-semibold">課金形態</th>
              <th className="px-3 py-2 text-right font-semibold">パラメータ</th>
              <th className="px-3 py-2 text-center font-semibold">有効</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2 text-ink-muted">{r.id}</td>
                <td className="px-3 py-2">{r.division}</td>
                <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                <td className="px-3 py-2 text-ink-muted">{r.ruleType}</td>
                <td className="px-3 py-2 text-ink-faint">{r.modelKeyFilter ?? "全て"}</td>
                <td className="px-3 py-2 text-right text-xs text-ink-muted">
                  {r.ruleType === "回線コール単価" && `回線${yen(r.unitLine)}/コール${yen(r.unitCall)}`}
                  {r.ruleType === "月額基本料金割合" && `${r.ratioPercent}%`}
                  {r.ruleType === "固定Dig" && `${yen(r.fixedDig)}Dig`}
                  {r.ruleType === "初回発注1to1" && "1円=1Dig"}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${r.active ? "bg-emerald-100 text-semantic-success" : "bg-slate-100 text-ink-muted"}`}>
                    {r.active ? "ON" : "OFF"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ルール登録フォーム */}
      <div className="mb-8 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">ルール登録 / 更新</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="ID"><input className="inp" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="R-XXX" /></Field>
          <Field label="事業部"><input className="inp" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} /></Field>
          <Field label="ルール名"><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="課金形態(空=全)"><input className="inp" value={form.modelKeyFilter ?? ""} onChange={(e) => setForm({ ...form, modelKeyFilter: e.target.value })} placeholder="line_call" /></Field>
          <Field label="種別">
            <select className="inp" value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value })}>
              {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="回線単価"><input type="number" className="inp" value={form.unitLine} onChange={(e) => setForm({ ...form, unitLine: Number(e.target.value) })} /></Field>
          <Field label="コール単価"><input type="number" className="inp" value={form.unitCall} onChange={(e) => setForm({ ...form, unitCall: Number(e.target.value) })} /></Field>
          <Field label="月額割合(%)"><input type="number" className="inp" value={form.ratioPercent} onChange={(e) => setForm({ ...form, ratioPercent: Number(e.target.value) })} /></Field>
          <Field label="固定Dig"><input type="number" className="inp" value={form.fixedDig} onChange={(e) => setForm({ ...form, fixedDig: Number(e.target.value) })} /></Field>
          <Field label="有効">
            <select className="inp" value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
              <option value="1">ON</option><option value="0">OFF</option>
            </select>
          </Field>
        </div>
        <button onClick={saveRule} className="mt-3 rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white">保存</button>
      </div>

      {/* 契約Dig反映 */}
      <SectionHeader
        title="契約 → Dig反映（keiyaku-kanri-next 連携）"
        note="契約内容にルールを適用し、担当者へ折半で成果Dig付与。担当者は後から修正可。"
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button onClick={assignFromSfa} className="rounded-card border border-brand-primary px-4 py-1.5 text-sm font-bold text-brand-primary">
          SP_CRMから担当者を自動設定（企業ID→担当者）
        </button>
        <button onClick={reflect} className="rounded-card bg-brand-accent px-4 py-1.5 text-sm font-bold text-white">
          この月の契約を成果Digに反映
        </button>
        <span className="text-xs text-ink-muted">{contracts.length}件の契約</span>
      </div>
      <div className="space-y-3">
        {contracts.map((c) => (
          <ContractCard key={c.contractId} row={c} nameOf={nameOf} members={members} onSave={saveShares} />
        ))}
      </div>

      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

function ContractCard({
  row,
  nameOf,
  members,
  onSave,
}: {
  row: ContractRow;
  nameOf: (id: string) => string;
  members: { personId: string; name: string }[];
  onSave: (contractId: string, shares: Share[]) => void;
}) {
  const [shares, setShares] = useState<Share[]>(row.shares);
  const sum = shares.reduce((s, x) => s + x.sharePercent, 0);

  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{row.customerName}</span>
          <span className="text-xs text-ink-faint">{row.contractNo ?? row.contractId}</span>
          <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] text-ink-muted">{row.division}</span>
          {row.companyId && (
            <span className="rounded-pill bg-blue-50 px-2 py-0.5 text-[11px] text-brand-primary">企業ID {row.companyId}</span>
          )}
          {row.source && (
            <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${row.source === "sfa" ? "bg-emerald-100 text-semantic-success" : "bg-violet-100 text-brand-accent"}`}>
              {row.source === "sfa" ? "SFA自動" : "手動修正"}
            </span>
          )}
        </div>
        <div className="tabular text-sm">
          ルール: <span className="text-ink-muted">{row.ruleName ?? "未設定"}</span>　付与:
          <span className="ml-1 font-bold text-brand-accent">{man(row.totalDig)}</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {shares.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <select
              className="rounded-card border border-surface-border px-2 py-1"
              value={s.personId}
              onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, personId: e.target.value } : x)))}
            >
              {members.map((m) => <option key={m.personId} value={m.personId}>{m.name}</option>)}
            </select>
            <input
              type="number"
              className="w-20 rounded-card border border-surface-border px-2 py-1 tabular"
              value={s.sharePercent}
              onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, sharePercent: Number(e.target.value) } : x)))}
            />
            <span className="text-xs text-ink-muted">%</span>
            <span className="text-xs text-ink-faint">
              = {man(Math.floor((row.totalDig * s.sharePercent) / (sum || 1)))}
            </span>
            <button onClick={() => setShares(shares.filter((_, j) => j !== i))} className="text-xs text-semantic-danger">削除</button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShares([...shares, { personId: members[0]?.personId ?? "", sharePercent: 0 }])}
            className="text-xs font-semibold text-brand-primary"
          >
            ＋担当者を追加（折半）
          </button>
          <span className={`text-xs ${sum === 100 ? "text-semantic-success" : "text-semantic-warn"}`}>
            合計 {sum}%
          </span>
          <button
            onClick={() => onSave(row.contractId, shares)}
            className="rounded-card border border-brand-primary px-3 py-1 text-xs font-bold text-brand-primary"
          >
            帰属を保存
          </button>
        </div>
      </div>
    </div>
  );
}
