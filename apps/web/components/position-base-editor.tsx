"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { yen } from "@/lib/format";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";
const POSITIONS = ["部長", "マネージャー", "リーダー", "メンバー"] as const;
const CYCLES = ["四半期", "半期"] as const;
const DEFAULT_DIVISION = "AIテレアポ事業部";

interface Row {
  personId: string;
  name: string;
  division: string;
  position: string;
  employmentType: string;
  basePay: number;
  hourlyWage: number | null;
  positionBase: number;
  evaluationCycle: string;
  salaryGrade: string | null;
  joinedOn: string;
}

interface RangeRow {
  position: string;
  grade: string;
  amount: number;
}

const RANGES = ["A", "B", "C"] as const;

/**
 * 役職ベースの一括入力。予算Dig は役職ベースから計算されるが jinjer には
 * 該当項目が無いため、対象事業部のメンバーをまとめて手入力する。
 */
export function PositionBaseEditor() {
  const [division, setDivision] = useState(DEFAULT_DIVISION);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [ranges, setRanges] = useState<RangeRow[]>([]);
  const [edit, setEdit] = useState<
    Record<
      string,
      { position?: string; positionBase?: number; evaluationCycle?: string; salaryGrade?: string }
    >
  >({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Dig制度の対象事業部（ここに入っている事業部だけが評価台帳の対象）。
  const [targets, setTargets] = useState<string[]>([]);

  const loadTargets = useCallback(async () => {
    try {
      const d = await apiGet<{ targets: string[] }>("/api/target-divisions");
      setTargets(d.targets ?? []);
    } catch {
      /* 取得失敗は無視 */
    }
  }, []);
  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  async function toggleTarget(d: string) {
    const next = targets.includes(d) ? targets.filter((x) => x !== d) : [...targets, d];
    setBusy(true);
    try {
      await apiSend("/api/target-divisions", "POST", { divisions: next, actor: ACTOR });
      setTargets(next);
      setMsg(
        next.length > 0
          ? `評価対象の事業部: ${next.join("、")}（予実モニターで「再計算」すると反映されます）`
          : "評価対象が未設定です（全事業部が対象になります）",
      );
    } catch (e) {
      setMsg(`対象事業部の保存に失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ members: Row[]; divisions: string[]; ranges: RangeRow[] }>(
        `/api/members/position-base?division=${encodeURIComponent(division)}`,
      );
      setRows(d.members ?? []);
      setDivisions(d.divisions ?? []);
      setRanges(d.ranges ?? []);
      setEdit({});
    } catch (e) {
      setMsg(`読み込み失敗: ${(e as Error).message}`);
    }
  }, [division]);
  useEffect(() => {
    void load();
  }, [load]);

  /** 役職 → {A|B|C: 金額} の索引（給与レンジ表）。 */
  const rangeMap: Record<string, Record<string, number>> = {};
  for (const r of ranges) {
    rangeMap[r.position] ??= {};
    rangeMap[r.position][r.grade] = Number(r.amount);
  }

  const valueOf = (r: Row) => {
    const e = edit[r.personId];
    const position = e?.position ?? r.position;
    const grade = e?.salaryGrade ?? r.salaryGrade ?? "";
    // レンジ(A/B/C)が決まれば給与レンジ表の金額が役職ベースになる。
    const fromRange = grade ? rangeMap[position]?.[grade] : undefined;
    // 給与（月額。時給者は160h換算）に最も近いレンジ＝推奨。
    const salary = Number(r.basePay) > 0 ? Number(r.basePay) : Math.round(Number(r.hourlyWage ?? 0) * 160);
    let suggested = "";
    const cand = rangeMap[position];
    if (cand && salary > 0) {
      let best: [string, number] | null = null;
      for (const entry of Object.entries(cand)) {
        if (!best || Math.abs(entry[1] - salary) < Math.abs(best[1] - salary)) best = entry;
      }
      suggested = best ? best[0] : "";
    }
    return {
      position,
      evaluationCycle: e?.evaluationCycle ?? r.evaluationCycle,
      grade,
      salary,
      suggested,
      positionBase: fromRange ?? e?.positionBase ?? Number(r.positionBase ?? 0),
      fromRange: typeof fromRange === "number",
    };
  };

  function setField(
    personId: string,
    patch: { position?: string; positionBase?: number; evaluationCycle?: string; salaryGrade?: string },
  ) {
    setEdit((prev) => ({ ...prev, [personId]: { ...prev[personId], ...patch } }));
  }

  /** 実際の給与に最も近いレンジ(A/B/C)を自動判定して役職ベースを設定（サーバ側で実行）。 */
  async function autoAssign() {
    setBusy(true);
    setMsg("⏳ 給与からレンジを自動判定中…");
    try {
      const r = await apiSend<{ updated: number; skipped: number; total: number }>(
        "/api/members/position-base",
        "POST",
        { actor: ACTOR, mode: "auto", division },
      );
      setMsg(
        `レンジを自動判定しました: ${r.updated}名に役職ベースを設定（給与未取得などで対象外 ${r.skipped}名 / 全${r.total}名）。予実モニターで「評価台帳を再計算」してください。`,
      );
      await load();
    } catch (e) {
      setMsg(`自動判定に失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const payload = Object.entries(edit).map(([personId, v]) => ({ personId, ...v }));
    if (payload.length === 0) {
      setMsg("変更がありません");
      return;
    }
    setBusy(true);
    try {
      const r = await apiSend<{ updated: number; total: number }>("/api/members/position-base", "POST", {
        actor: ACTOR,
        rows: payload,
      });
      setMsg(`保存しました: ${r.updated}名を更新`);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const changed = Object.keys(edit).length;

  return (
    <>
      <SectionHeader
        title="役職ベースの入力"
        note="予算Dig の計算元。jinjer に該当項目が無いためここで設定します。"
      />

      {/* Dig制度の対象事業部（チェックした事業部だけが評価台帳の対象になる） */}
      <div className="mb-3 rounded-card border border-surface-border bg-white px-3 py-2">
        <div className="mb-1 text-xs font-semibold text-ink-muted">
          Dig評価の対象事業部（チェックした事業部のメンバーだけ評価台帳を作ります）
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {[DEFAULT_DIVISION, ...divisions.filter((d) => d !== DEFAULT_DIVISION)].map((d) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={targets.includes(d)}
                onChange={() => void toggleTarget(d)}
                disabled={busy}
              />
              <span>{d}</span>
            </label>
          ))}
        </div>
        {targets.length === 0 && (
          <div className="mt-1 text-[11px] text-semantic-warn">
            未選択のため全事業部が対象です（役職ベース未入力の方は予算Digが不正確になります）
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">事業部</span>
        <select
          value={division}
          onChange={(e) => setDivision(e.target.value)}
          className="rounded-card border border-surface-border px-3 py-1.5 font-semibold"
        >
          {[DEFAULT_DIVISION, ...divisions.filter((d) => d !== DEFAULT_DIVISION)].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">{rows.length}名</span>
        <button
          onClick={() => void autoAssign()}
          disabled={busy || rows.length === 0}
          className="ml-auto rounded-card border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-muted disabled:opacity-50"
        >
          給与からレンジを自動判定
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || changed === 0}
          className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "保存中…" : `保存${changed > 0 ? `（${changed}件）` : ""}`}
        </button>
      </div>

      {msg && (
        <div className="mb-3 whitespace-pre-wrap rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>
      )}

      <div className="overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">氏名</th>
              <th className="px-3 py-2 font-semibold">雇用</th>
              <th className="px-3 py-2 font-semibold">入社日</th>
              <th className="px-3 py-2 text-right font-semibold">基本給（参考）</th>
              <th className="px-3 py-2 font-semibold">役職</th>
              <th className="px-3 py-2 font-semibold">レンジ（A/B/C）</th>
              <th className="px-3 py-2 font-semibold">評価サイクル</th>
              <th className="px-3 py-2 text-right font-semibold">役職ベース</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-ink-muted">
                  この事業部の在籍メンバーがいません
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const v = valueOf(r);
                const dirty = !!edit[r.personId];
                return (
                  <tr key={r.personId} className={`border-b border-surface-border last:border-0 ${dirty ? "bg-amber-50" : ""}`}>
                    <td className="px-3 py-2">
                      {r.name}
                      <span className="ml-1 text-[11px] text-ink-faint">{r.personId}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.employmentType}</td>
                    <td className="px-3 py-2 text-ink-muted">{(r.joinedOn ?? "").slice(0, 10) || "—"}</td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {Number(r.basePay) > 0
                        ? yen(Number(r.basePay))
                        : Number(r.hourlyWage ?? 0) > 0
                          ? `${yen(Number(r.hourlyWage))}/時`
                          : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={v.position}
                        onChange={(e) => setField(r.personId, { position: e.target.value })}
                        className="rounded-card border border-surface-border px-2 py-1 text-sm"
                      >
                        {POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={v.grade}
                        onChange={(e) => setField(r.personId, { salaryGrade: e.target.value })}
                        className="rounded-card border border-surface-border px-2 py-1 text-sm"
                      >
                        <option value="">未設定</option>
                        {RANGES.map((g) => {
                          const amount = rangeMap[v.position]?.[g];
                          return (
                            <option key={g} value={g}>
                              {g}
                              {amount ? `（${amount.toLocaleString()}円）` : ""}
                            </option>
                          );
                        })}
                      </select>
                      {v.suggested && v.suggested !== v.grade && (
                        <button
                          onClick={() => setField(r.personId, { salaryGrade: v.suggested })}
                          className="ml-1 text-[11px] text-brand-primary underline"
                          title={`給与 ${v.salary.toLocaleString()}円 に最も近いレンジ`}
                        >
                          推奨{v.suggested}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={v.evaluationCycle}
                        onChange={(e) => setField(r.personId, { evaluationCycle: e.target.value })}
                        className="rounded-card border border-surface-border px-2 py-1 text-sm"
                      >
                        {CYCLES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {v.fromRange ? (
                        // レンジ(A/B/C)から自動算出（給与レンジ表を参照）
                        <span className="font-semibold text-ink" title="給与レンジ表から自動算出">
                          {yen(v.positionBase)}
                        </span>
                      ) : (
                        <input
                          type="number"
                          value={v.positionBase}
                          onChange={(e) => setField(r.personId, { positionBase: Number(e.target.value) })}
                          className="w-32 rounded-card border border-surface-border px-2 py-1 text-right text-sm"
                        />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-ink-faint">
        ※ レンジ(A/B/C)を選ぶと給与レンジ表（役職×A/B/C）の金額が役職ベースになります。保存後、予実モニターで「評価台帳を再計算」してください。
      </div>
    </>
  );
}
