"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { yen } from "@/lib/format";
import { SectionHeader } from "./ui";
import { OrgSettings, type OrgUnit } from "./org-settings";
import { PositionMapping } from "./position-mapping";

const ACTOR = "B0000071";
const YM = "2026-01";
/** 実労働時間の取込で既定表示する対象月（当月）。 */
const ymNow = () => new Date().toISOString().slice(0, 7);
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
  /** jinjer 上の所属名（紐付けの原本） */
  jinjerTeam?: string | null;
  /** 所属する組織（事業部/グループ/チーム） */
  orgUnitId?: number | null;
  /** jinjer 上の役職名 */
  jinjerPosition?: string | null;
  /** 給与レンジ A/B/C */
  salaryGrade?: string | null;
  /** 役職ベースを手入力したか（レンジ自動判定で上書きしない） */
  positionBaseManual?: boolean;
  /** 配下の合算方法（組織の長のとき）: なし / 予算のみ / 予算と実績 */
  aggregateMode?: string;
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
  // 一覧の「編集」で開くモーダル（表が長く、下の入力欄では変化が見えないため）。
  const [editing, setEditing] = useState<Member | null>(null);
  // 組織（全従業員一覧の「組織」プルダウン）と給与レンジ表。
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [ranges, setRanges] = useState<Record<string, Record<string, number>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // 一覧の絞り込み（氏名・Person ID）。300名規模なのでクライアント側で十分。
  const [query, setQuery] = useState("");

  async function load() {
    try {
      const m = await apiGet<Member[]>("/api/members");
      setMembers(m.map((x) => ({ ...x, joinedOn: (x.joinedOn ?? "").slice(0, 10) })));
      setSource("db");
    } catch {
      setSource("mock");
    }
    try {
      const [units, base] = await Promise.all([
        apiGet<OrgUnit[]>("/api/org-units"),
        apiGet<{ ranges: Record<string, Record<string, number>> }>("/api/members/position-base"),
      ]);
      setOrgUnits(units);
      setRanges(base.ranges ?? {});
    } catch {
      /* 組織・レンジの取得失敗は一覧表示に影響させない */
    }
  }

  /** 行の1項目を保存する（役職・レンジ・役職ベース・サイクル）。 */
  async function saveRow(personId: string, patch: Record<string, unknown>) {
    setSavingId(personId);
    try {
      await apiSend("/api/members/position-base", "POST", {
        actor: ACTOR,
        rows: [{ personId, ...patch }],
      });
      await load();
    } catch (e) {
      setMsg(`保存できませんでした: ${(e as Error).message}`);
    } finally {
      setSavingId(null);
    }
  }

  /** 所属組織を保存する（事業部名も組織から自動で追随する）。 */
  async function saveOrg(personId: string, orgUnitId: number | null) {
    setSavingId(personId);
    try {
      await apiSend(`/api/members/${encodeURIComponent(personId)}/org`, "POST", {
        orgUnitId,
        actor: ACTOR,
      });
      await load();
    } catch (e) {
      setMsg(`組織を設定できませんでした: ${(e as Error).message}`);
    } finally {
      setSavingId(null);
    }
  }

  /** 対象月の実労働時間を jinjer の打刻実績から取り込む（アルバイトの予算Dig算定用）。 */
  async function syncHours() {
    const ym = prompt("実労働時間を取り込む対象月を入力してください（YYYY-MM）", ymNow());
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return;
    setSyncing(true);
    setMsg(`⏳ ${ym} の実労働時間を取込中…`);
    try {
      const r = await apiSend<{ fetched: number; updated: number; note: string | null }>(
        "/api/members/work-hours",
        "POST",
        { yearMonth: ym, actor: ACTOR },
      );
      if (r.note) {
        // どのエンドポイントで取れるか分からない場合は診断結果を見せる。
        const p = await apiSend<{
          connected: boolean;
          endpoints: Array<{ path: string; status: number; rows: number; keys: string[]; workFields: Array<{ key: string; sample: string }> }>;
        }>("/api/members/jinjer-attendance-probe", "POST", { yearMonth: ym });
        const lines = p.endpoints.map(
          (e) =>
            `・${e.path} → HTTP ${e.status} / ${e.rows}件` +
            (e.workFields.length > 0 ? `\n　　労働時間らしい項目: ${e.workFields.map((w) => `${w.key}=${w.sample}`).join(", ")}` : "") +
            (e.rows > 0 && e.workFields.length === 0 ? `\n　　項目名: ${e.keys.slice(0, 15).join(", ")}` : ""),
        );
        setMsg(
          `${ym} の実労働時間は取得できませんでした。\n【勤怠エンドポイントの探索結果】\n` +
            (lines.length > 0 ? lines.join("\n") : "応答したエンドポイントがありません") +
            `\n※ この結果を共有いただければ、正しい項目名で取り込めるようにします。`,
        );
        return;
      }
      setMsg(
        `${ym} の実労働時間を取り込みました: ${r.updated}名（取得${r.fetched}件）\n` +
          `アルバイトの予算Digに反映するには「評価台帳を再計算」を実行してください。`,
      );
      await load();
    } catch (e) {
      setMsg(`実労働時間の取込に失敗しました: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  /** 給与に最も近いレンジを全員に自動判定する（手入力した人は対象外）。 */
  async function autoRanges() {
    setSyncing(true);
    setMsg("⏳ レンジを自動判定中…");
    try {
      const r = await apiSend<{ updated: number; skipped: number; total: number }>(
        "/api/members/auto-ranges",
        "POST",
        { actor: ACTOR },
      );
      setMsg(
        `レンジ(A/B/C)を自動判定しました: ${r.updated}名を更新 / ${r.skipped}名は判定できず（給与未取得またはレンジ表未整備）\n` +
          `役職ベースも同時に設定されています。予算Digへ反映するには「評価台帳を再計算」を実行してください。`,
      );
      await load();
    } catch (e) {
      setMsg(`自動判定に失敗しました: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
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

  // jinjer にメール項目があるかの診断（アカウント発行の宛先に使えるか確認）。
  async function probeMailFields() {
    setMsg("⏳ メール項目を確認中…");
    try {
      const r = await apiSend<{
        connected: boolean;
        scanned: number;
        withMail: number;
        withCompanyMail: number;
        usedKeys: string[];
        fields: Array<{
          path: string;
          filled: number;
          invalid: number;
          total: number;
          sampleDomain: string;
          personalDomain: boolean;
          adopted: boolean;
        }>;
        unknownFields: string[];
      }>("/api/members/jinjer-mail-fields", "POST", {});
      if (!r.connected) {
        setMsg("メール項目の確認: jinjer のキーが未設定のため確認できません（JINJER_API_KEY / シークレット）。");
        return;
      }
      if (r.fields.length === 0) {
        setMsg(
          `【jinjer メール項目】${r.scanned}名を確認 → メールらしい項目は見つかりませんでした。\n` +
            `jinjer 側にメールが登録されていない可能性があります。アカウント発行は仮メール（従業員ID@ドメイン）になります。`,
        );
        return;
      }
      const lines = r.fields.map((f) => {
        const note = f.personalDomain
          ? " ← 私用メール（アカウントには使いません）"
          : f.adopted
            ? " ← 採用"
            : r.unknownFields.includes(f.path)
              ? " ← 未対応（取り込めていません）"
              : "";
        return (
          `・${f.path}: メール形式 ${f.filled}名` +
          `${f.invalid > 0 ? ` / 形式外 ${f.invalid}名` : ""}` +
          `${f.sampleDomain ? `（例 ${f.sampleDomain}）` : ""}` +
          note
        );
      });
      let msg =
        `【jinjer メール項目】${r.scanned}名を確認 → メールを持つ人 ${r.withMail}名` +
        `／うち会社メールで発行できる人 ${r.withCompanyMail}名\n` +
        lines.join("\n");
      msg += `\n取り込み候補キー: ${r.usedKeys.join(", ")}（personal 配下は私用メールのため見ません）`;
      if (r.unknownFields.length > 0) {
        msg += `\n※「未対応」の項目名を教えてください。候補キーに追加すれば実メールで発行できます。`;
      }
      if (r.withCompanyMail < r.scanned) {
        msg += `\n※ 会社メールが無い ${r.scanned - r.withCompanyMail}名は仮メール（従業員ID@ドメイン）で発行され、アカウント管理画面に「要修正」で表示されます。`;
      }
      setMsg(msg);
    } catch (e) {
      setMsg(`メール項目の確認失敗: ${(e as Error).message}`);
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

  // 「山田 太郎」と「山田太郎」のどちらでも引けるよう、空白を除いて比較する。
  const normalize = (v: string) => v.replace(/[\s　]/g, "").toLowerCase();
  const q = normalize(query);
  const visibleMembers = q
    ? members.filter((m) => normalize(m.name).includes(q) || normalize(m.personId).includes(q))
    : members;

  return (
    <>
      <SectionHeader
        title="全従業員一覧"
        note="jinjer の所属・役職と、この画面上の組織・役職をここで紐付けます"
      />
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
        <button onClick={probeMailFields} disabled={syncing} className="rounded-card border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-muted disabled:opacity-60">
          メール項目を確認
        </button>
        <button onClick={syncHours} disabled={syncing} className="rounded-card border border-brand-accent px-3 py-1.5 text-sm font-semibold text-brand-accent disabled:opacity-60">
          実労働時間を取込（アルバイトの予算Dig）
        </button>
        <button onClick={autoRanges} disabled={syncing} className="rounded-card border border-brand-accent px-3 py-1.5 text-sm font-semibold text-brand-accent disabled:opacity-60">
          レンジを自動判定（役職ベース設定）
        </button>
        <button onClick={restoreManual} disabled={syncing} className="rounded-card border border-semantic-warn px-3 py-1.5 text-sm font-semibold text-semantic-warn disabled:opacity-60">
          手入力項目を復元（同期前に戻す）
        </button>
      </div>
      <div className="mb-3 text-[11px] text-ink-faint">
        ① は jinjer が正の項目（氏名・雇用区分・入社日・会社メール・基本給・jinjerの所属名/役職名）だけを更新します。
        <b>この画面上の組織・役職・レンジ・役職ベース・評価サイクルは上書きしません</b>
        （同期の直前に自動退避するため、万一ズレた場合は「手入力項目を復元」で直前の状態に戻せます）。
      </div>
      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && <div className="mb-3 whitespace-pre-wrap break-all rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      {/* 氏名検索。300名を1画面に出しているため、目的の人へすぐ辿り着けるようにする。 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="氏名またはPerson IDで検索"
          className="w-64 rounded-card border border-surface-border px-3 py-1.5 text-sm"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="rounded-card border border-surface-border px-3 py-1.5 text-xs text-ink-muted"
          >
            クリア
          </button>
        )}
        <span className="text-xs text-ink-muted">
          {query ? `${visibleMembers.length} / ${members.length}名` : `${members.length}名`}
        </span>
      </div>

      <div className="mb-4 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Person ID</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">氏名</th>
              <th className="px-3 py-2 font-semibold">jinjer所属</th>
              <th className="px-3 py-2 font-semibold">組織（この画面上）</th>
              <th className="px-3 py-2 font-semibold">jinjer役職</th>
              <th className="px-3 py-2 font-semibold">役職</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">雇用</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">入社日</th>
              <th className="px-3 py-2 text-right font-semibold">基本給</th>
              <th className="px-3 py-2 font-semibold">レンジ</th>
              <th className="px-3 py-2 text-right font-semibold">役職ベース</th>
              <th className="px-3 py-2 font-semibold">サイクル</th>
              <th className="px-3 py-2 font-semibold">配下の合算</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {visibleMembers.map((m) => {
              const rangeRow = ranges[m.position] ?? {};
              return (
                <tr key={m.personId} className="border-b border-surface-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{m.personId}</td>
                  {/* 氏名は折り返さない（姓と名で2行になるのを防ぐ） */}
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{m.name}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {m.jinjerTeam || <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.orgUnitId ?? ""}
                      disabled={savingId === m.personId}
                      onChange={(e) => void saveOrg(m.personId, e.target.value ? Number(e.target.value) : null)}
                      className="w-52 rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                    >
                      <option value="">未所属</option>
                      {orgUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.path}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {m.jinjerPosition || <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.position}
                      disabled={savingId === m.personId}
                      onChange={(e) => void saveRow(m.personId, { position: e.target.value })}
                      className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                    >
                      {POSITIONS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-muted">{m.employmentType}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-muted">
                    {m.joinedOn || <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {m.basePay > 0 ? (
                      yen(m.basePay)
                    ) : m.hourlyWage && m.hourlyWage > 0 ? (
                      <span title="時給">
                        {yen(m.hourlyWage)}
                        <span className="ml-0.5 text-[10px] text-ink-muted">/時</span>
                      </span>
                    ) : (
                      <span className="text-ink-faint">未取得</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.salaryGrade ?? ""}
                      disabled={savingId === m.personId}
                      onChange={(e) => void saveRow(m.personId, { salaryGrade: e.target.value })}
                      className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {(["A", "B", "C"] as const).map((g) => (
                        <option key={g} value={g}>
                          {g}
                          {rangeRow[g] ? `（${yen(rangeRow[g])}）` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      defaultValue={m.positionBase}
                      disabled={savingId === m.personId}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== m.positionBase) {
                          void saveRow(m.personId, { positionBase: v });
                        }
                      }}
                      className="w-24 rounded-card border border-surface-border px-2 py-1 text-right text-xs"
                    />
                    {m.positionBaseManual && (
                      <div className="text-[10px] text-ink-faint" title="自動判定で上書きされません">
                        手入力
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.evaluationCycle}
                      disabled={savingId === m.personId}
                      onChange={(e) => void saveRow(m.personId, { evaluationCycle: e.target.value })}
                      className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                    >
                      {CYCLES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.aggregateMode ?? "予算のみ"}
                      disabled={savingId === m.personId}
                      onChange={(e) => void saveRow(m.personId, { aggregateMode: e.target.value })}
                      title="組織設定でこの人を「長」にしたとき、配下の何を合算するか"
                      className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                    >
                      <option>なし</option>
                      <option>予算のみ</option>
                      <option>予算と実績</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => setEditing(m)} className="mr-2 text-xs font-semibold text-brand-primary">
                      編集
                    </button>
                    <button onClick={() => del(m.personId)} className="text-xs text-semantic-danger">
                      削除
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleMembers.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-4 text-center text-sm text-ink-muted">
                  {query ? `「${query}」に一致する従業員はいません` : "従業員が登録されていません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※ 組織・役職・レンジ・役職ベース・サイクルはその場で保存されます。
          レンジを選ぶと給与レンジ表の金額が役職ベースに入り、金額を直接入力すると「手入力」となり自動判定で上書きされません。
          「配下の合算」は、組織設定でその人を「長」にしたときに配下の何を合算するかの設定です（部長・グループ長・チーム長を個別に指定できます）。
          アルバイトの予算Digは「実労働時間 × 時給」で算定します（下の「実労働時間を取込」を実行した月のみ。未取得の月は役職ベースを使用）。
          変更後は予実モニターで「評価台帳を再計算」してください。
        </div>
      </div>

      <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">従業員 新規登録（既存の編集は一覧の「編集」から）</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MemberFields form={form} setForm={setForm} lockPersonId={false} />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white">保存</button>
          <button onClick={() => setForm(emptyMember)} className="rounded-card border border-surface-border px-4 py-1.5 text-sm text-ink-muted">クリア</button>
        </div>
      </div>
      {editing && (
        <MemberEditDialog
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            setMsg(`従業員 ${name} を更新しました。予算Digへ反映するには「評価台帳を再計算」を実行してください。`);
            await load();
          }}
        />
      )}

      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>

      {/* 組織設定（事業部 ＞ グループ ＞ チーム） */}
      <div className="mt-8">
        <OrgSettings members={members.map((m) => ({ personId: m.personId, name: m.name }))} />
      </div>

      {/* 役職の紐付け（jinjer の役職名 → Dig評価の役職） */}
      <div className="mt-8">
        <PositionMapping />
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

/** 登録/更新フォームの入力欄（モーダルと新規登録で共用）。 */
function MemberFields({
  form,
  setForm,
  lockPersonId,
}: {
  form: Member;
  setForm: (m: Member) => void;
  lockPersonId: boolean;
}) {
  return (
    <>
      <F label="Person ID">
        <input
          className="inp"
          value={form.personId}
          readOnly={lockPersonId}
          onChange={(e) => setForm({ ...form, personId: e.target.value })}
        />
      </F>
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
    </>
  );
}

/**
 * 一覧の「編集」で開くモーダル。表が長いため、画面下の入力欄に値を入れる方式では
 * 押しても変化が見えなかった（＝効いていないように見えた）ためダイアログにした。
 */
function MemberEditDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Member;
  onClose: () => void;
  onSaved: (name: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState<Member>({ ...member, joinedOn: (member.joinedOn ?? "").slice(0, 10) });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.name.trim()) {
      setErr("氏名は必須です");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiSend("/api/members", "POST", { ...form, actor: ACTOR });
      await onSaved(form.name);
    } catch (e) {
      setErr(`保存失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-card border border-surface-border bg-white p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="text-base font-bold text-ink">{member.name} を編集</div>
            <div className="text-xs text-ink-muted">Person ID {member.personId}</div>
          </div>
          <button onClick={onClose} className="text-sm text-ink-muted">✕ 閉じる</button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MemberFields form={form} setForm={setForm} lockPersonId />
        </div>

        <div className="mt-3 text-[11px] text-ink-faint">
          ※ 事業部を変更すると「個別指定」として保存され、jinjer同期や紐づけルールでは上書きされません。
          役職・役職ベースを変更した場合は、この画面の上部にある「評価台帳を再計算」を実行してください。
        </div>

        {err && <div className="mt-2 rounded-card bg-rose-50 px-3 py-2 text-xs text-semantic-danger">{err}</div>}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-card bg-brand-primary px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "保存中…" : "保存"}
          </button>
          <button onClick={onClose} className="rounded-card border border-surface-border px-4 py-2 text-sm text-ink-muted">
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
