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
}

/**
 * 役職ベースの一括入力。予算Dig は役職ベースから計算されるが jinjer には
 * 該当項目が無いため、対象事業部のメンバーをまとめて手入力する。
 */
export function PositionBaseEditor() {
  const [division, setDivision] = useState(DEFAULT_DIVISION);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, { position?: string; positionBase?: number; evaluationCycle?: string }>>({});
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
      const d = await apiGet<{ members: Row[]; divisions: string[] }>(
        `/api/members/position-base?division=${encodeURIComponent(division)}`,
      );
      setRows(d.members ?? []);
      setDivisions(d.divisions ?? []);
      setEdit({});
    } catch (e) {
      setMsg(`読み込み失敗: ${(e as Error).message}`);
    }
  }, [division]);
  useEffect(() => {
    void load();
  }, [load]);

  const valueOf = (r: Row) => ({
    position: edit[r.personId]?.position ?? r.position,
    positionBase: edit[r.personId]?.positionBase ?? Number(r.positionBase ?? 0),
    evaluationCycle: edit[r.personId]?.evaluationCycle ?? r.evaluationCycle,
  });

  function setField(personId: string, patch: { position?: string; positionBase?: number; evaluationCycle?: string }) {
    setEdit((prev) => ({ ...prev, [personId]: { ...prev[personId], ...patch } }));
  }

  /** 入力の手間を減らす: 基本給（時給者は月換算の目安）を役職ベース欄に流し込む。 */
  function fillFromBasePay() {
    const next = { ...edit };
    for (const r of rows) {
      const monthly = Number(r.basePay ?? 0) > 0 ? Number(r.basePay) : Math.round(Number(r.hourlyWage ?? 0) * 160);
      if (monthly > 0) next[r.personId] = { ...next[r.personId], positionBase: monthly };
    }
    setEdit(next);
    setMsg("基本給から役職ベース欄に入力しました（時給者は160h換算の目安）。内容を確認して保存してください。");
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
          onClick={fillFromBasePay}
          disabled={busy || rows.length === 0}
          className="ml-auto rounded-card border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-muted disabled:opacity-50"
        >
          基本給から入力
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
              <th className="px-3 py-2 text-right font-semibold">基本給（参考）</th>
              <th className="px-3 py-2 font-semibold">役職</th>
              <th className="px-3 py-2 font-semibold">評価サイクル</th>
              <th className="px-3 py-2 text-right font-semibold">役職ベース</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-ink-muted">
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
                      <input
                        type="number"
                        value={v.positionBase}
                        onChange={(e) => setField(r.personId, { positionBase: Number(e.target.value) })}
                        className="w-32 rounded-card border border-surface-border px-2 py-1 text-right text-sm"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-ink-faint">
        ※ 保存後、予実モニターで「実データを生成」を押すと、この役職ベースから予算Digが計算されます。
      </div>
    </>
  );
}
