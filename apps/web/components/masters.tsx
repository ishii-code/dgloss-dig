"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { yen } from "@/lib/format";
import { SectionHeader } from "./ui";
import { DivisionMapping } from "./division-mapping";
import { PositionBaseEditor } from "./position-base-editor";

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
  /** 個別指定された事業部（同期・紐づけルールより優先） */
  divisionOverride?: string | null;
  position: string;
  jobType: string | null;
  employmentType: string;
  basePay: number;
  hourlyWage?: number | null;
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
  const [syncing, setSyncing] = useState(false);

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
  // 直前の同期前スナップショットへ手入力項目（事業部・役職・役職ベース等）を巻き戻す。
  async function restoreManual() {
    if (syncing) return;
    if (!confirm("直前の jinjer 同期前の状態へ、事業部・役職・レンジ・役職ベース・評価サイクル・グループ長を巻き戻します。よろしいですか？")) return;
    setSyncing(true);
    setMsg("⏳ 手入力項目を復元中…");
    try {
      const r = await apiSend<{ restored: number; missing: number; total: number; snapshotAt: string | null }>(
        "/api/members/restore-manual",
        "POST",
        { actor: ACTOR },
      );
      setMsg(
        `手入力項目を復元しました: ${r.restored}/${r.total}名${r.missing > 0 ? `（マスタに居ない${r.missing}名はスキップ）` : ""}` +
          `${r.snapshotAt ? `\n退避時点: ${r.snapshotAt.slice(0, 19).replace("T", " ")}` : ""}` +
          `\n評価台帳は「評価台帳を再計算」で反映してください。`,
      );
      await load();
    } catch (e) {
      setMsg(`復元失敗: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function syncJinjer() {
    if (syncing) return;
    if (!confirm("jinjer から在籍の従業員マスタを同期します（在籍者・氏名・雇用区分・入社日・基本給を取得。退職者は除外）。\n事業部の紐づけ・役職・役職ベースは上書きしません（同期前の状態を自動退避します）。\n取得件数が多いと最大1分ほどかかります。よろしいですか？")) return;
    setSyncing(true);
    setMsg("⏳ jinjer同期中…（従業員・所属・給与を取得中。最大1分ほどかかります。完了までこのままお待ちください）");
    try {
      const r = await apiSend<{ connected: boolean; fetched: number; parsed: number; activeCount?: number; retiredCount?: number; executiveCount?: number; retiredInDb?: number; departmentCounts?: Record<string, number>; created: number; updated: number; synced: number; excludedCount: number; divisionsRestored?: number; divisionsReapplied?: number; rawSampleKeys?: string[]; rawSample?: Record<string, unknown> | null }>(
        "/api/members/sync-jinjer",
        "POST",
        { actor: ACTOR },
      );
      let msg = `jinjer同期完了${r.connected ? "（API直結）" : "（サンプル：キー未設定）"}: 取得${r.fetched}件（在籍${r.activeCount ?? "-"}／退職除外${r.retiredCount ?? "-"}／役員除外${r.executiveCount ?? "-"}）→取込${r.synced}名（新規${r.created}/更新${r.updated}）`;
      if (r.retiredInDb && r.retiredInDb > 0) msg += `\n評価対象外（退職・役員）${r.retiredInDb}名を一覧から外しました。`;
      msg += `\n事業部・役職・役職ベースは上書きしていません（個別指定の復元${r.divisionsRestored ?? 0}名／紐づけルール再適用${r.divisionsReapplied ?? 0}名）。`;
      msg += `\n基本給を更新したい場合は「② 部署・給与を反映」を押してください。`;
      // 取得はあるのに取込0＝項目名のマッピング不一致。診断情報を表示。
      if (r.fetched > 0 && r.parsed === 0) {
        msg += `\n【診断】項目名: ${(r.rawSampleKeys ?? []).join(", ")}`;
        if (r.rawSample) msg += `\n先頭レコード: ${JSON.stringify(r.rawSample).slice(0, 800)}`;
      }
      setMsg(msg);
      await load();
    } catch (e) {
      setMsg(`jinjer同期失敗: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  // jinjer の所属(部署)・基本給を在籍メンバーへ反映。
  // 1リクエスト=1ページに細分化し、クライアント側でページを進めることでタイムアウトを回避する。
  async function enrichJinjer() {
    if (syncing) return;
    setSyncing(true);
    const totals = { affiliations: 0, salaries: 0 };
    const errors: string[] = [];
    try {
      for (const kind of ["affiliations", "salaries"] as const) {
        const label = kind === "affiliations" ? "部署" : "給与";
        for (let page = 1; page <= 100; page++) {
          setMsg(`⏳ ${label}を反映中… ${page}ページ目（部署${totals.affiliations}名 / 給与${totals.salaries}名 更新済）`);
          const r = await apiSend<{ fetched: number; updated: number; done: boolean; error?: string }>(
            "/api/members/enrich-jinjer",
            "POST",
            { actor: ACTOR, kind, page },
          );
          if (r.error) { errors.push(`${label} ${page}ページ目: ${r.error}`); break; }
          totals[kind] += r.updated;
          if (r.done || r.fetched === 0) break;
        }
      }
      let msg = `部署・給与の反映完了: 部署更新${totals.affiliations}名 / 基本給更新${totals.salaries}名`;
      if (errors.length > 0) {
        msg += `\n※ 途中で中断（${errors[0]}）。時間をおいて再実行すると続きから反映されます。`;
      }
      // 反映後の部署別人数を取得して表示。
      try {
        const counts = await apiGet<Record<string, number>>("/api/members/enrich-jinjer");
        const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        msg += `\n【部署別 在籍人数】\n` + rows.map(([d, n]) => `・${d}: ${n}名`).join("\n");
      } catch { /* 集計失敗は無視 */ }
      setMsg(msg);
      await load();
    } catch (e) {
      setMsg(`部署・給与の反映失敗: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  // jinjer 給与単価の項目一覧（役職ベースに使える項目の特定用）。
  async function probeSalaryLabels() {
    setMsg("⏳ 給与項目を確認中…");
    try {
      const rows = await apiSend<Array<{ label: string; nonZero: number; total: number; sampleValue: number }>>(
        "/api/members/jinjer-salary-labels",
        "POST",
        {},
      );
      const lines = rows.map(
        (r) => `・${r.label}: 設定あり${r.nonZero}/${r.total}名（例 ${r.sampleValue.toLocaleString()}円）`,
      );
      setMsg(`【jinjer 給与項目】\n役職ベースに使える項目を選んでください\n` + lines.join("\n"));
    } catch (e) {
      setMsg(`給与項目の確認失敗: ${(e as Error).message}`);
    }
  }

  // 部署ツリーの正規化プレビュー（末端所属 → 事業部 の対応確認）。
  async function probeOrg() {
    setMsg("⏳ 部署ツリーを確認中…");
    try {
      const r = await apiSend<{ treeSize: number; sample: Array<{ personId: string; team: string; division: string }> }>(
        "/api/members/jinjer-groups-probe",
        "POST",
        {},
      );
      const lines = r.sample.map((s) => `・${s.team} → ${s.division}`);
      setMsg(`【部署ツリー正規化プレビュー】部署マスタ${r.treeSize}件\n（jinjerの末端所属 → 事業部）\n` + lines.join("\n"));
    } catch (e) {
      setMsg(`部署ツリー確認失敗: ${(e as Error).message}`);
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
      <SectionHeader title="従業員マスタ" note="jinjer（勤怠）から自動連携。Person ID は社員番号で突合。" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button onClick={syncJinjer} disabled={syncing} className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60">
          {syncing ? "⏳ 処理中…" : "① jinjer（勤怠）から同期"}
        </button>
        <button onClick={enrichJinjer} disabled={syncing} className="rounded-card bg-brand-accent px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60">
          {syncing ? "⏳ 処理中…" : "② 部署・給与を反映"}
        </button>
        <button onClick={probeOrg} disabled={syncing} className="rounded-card border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-muted disabled:opacity-60">
          部署ツリー確認
        </button>
        <button onClick={probeSalaryLabels} disabled={syncing} className="rounded-card border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-muted disabled:opacity-60">
          給与項目を確認
        </button>
        <button onClick={restoreManual} disabled={syncing} className="rounded-card border border-semantic-warn px-3 py-1.5 text-sm font-semibold text-semantic-warn disabled:opacity-60">
          手入力項目を復元（同期前に戻す）
        </button>
      </div>
      <div className="mb-3 text-[11px] text-ink-faint">
        ① は jinjer が正の項目（氏名・雇用区分・入社日・会社メール・基本給）だけを更新します。
        <b>事業部の紐づけ・役職・レンジ・役職ベース・評価サイクル・グループ長は上書きしません</b>
        （同期の直前に自動退避するため、万一ズレた場合は「手入力項目を復元」で直前の状態に戻せます）。
      </div>
      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && <div className="mb-3 whitespace-pre-wrap break-all rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      <div className="mb-4 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">Person ID</th>
              <th className="px-3 py-2 font-semibold">氏名</th>
              <th className="px-3 py-2 font-semibold">事業部</th>
              <th className="px-3 py-2 font-semibold">役職/職種</th>
              <th className="px-3 py-2 font-semibold">雇用</th>
              <th className="px-3 py-2 font-semibold">入社日</th>
              <th className="px-3 py-2 text-right font-semibold">基本給</th>
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
                <td className="px-3 py-2 text-ink-muted">
                  {m.division || <span className="text-ink-faint">未設定</span>}
                  {m.divisionOverride && (
                    <span
                      title="個別指定（jinjer同期・紐づけルールでは上書きされません）"
                      className="ml-1.5 rounded-pill bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-primary"
                    >
                      個別
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-muted">{m.position}/{m.jobType ?? "—"}</td>
                <td className="px-3 py-2 text-ink-muted">{m.employmentType}</td>
                <td className="px-3 py-2 text-ink-muted">
                  {m.joinedOn || <span className="text-ink-faint">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {m.basePay > 0 ? (
                    yen(m.basePay)
                  ) : m.hourlyWage && m.hourlyWage > 0 ? (
                    <span title="時給">{yen(m.hourlyWage)}<span className="ml-0.5 text-[10px] text-ink-muted">/時</span></span>
                  ) : (
                    <span className="text-ink-faint">未取得</span>
                  )}
                </td>
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

      {/* 役職ベースの入力（予算Dig の計算元） */}
      <div className="mt-8">
        <PositionBaseEditor />
      </div>

      {/* 部署の紐づけ（jinjer 所属 → dgloss 事業部） */}
      <div className="mt-8">
        <DivisionMapping />
      </div>
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
