"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";
const POSITIONS = ["部長", "マネージャー", "リーダー", "メンバー"] as const;

interface Rule {
  id: number;
  pattern: string;
  position: string;
}

interface JinjerPosition {
  name: string;
  count: number;
}

/**
 * 役職の紐付け（jinjer の役職名 → Dig評価の役職）。所属の紐付けと同じ考え方。
 * jinjer 側に役職が入っていない場合は、全従業員一覧で個別に設定する。
 */
export function PositionMapping() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [jinjerPositions, setJinjerPositions] = useState<JinjerPosition[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState("");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("メンバー");

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ rules: Rule[]; jinjerPositions: JinjerPosition[] }>("/api/position-rules");
      setRules(d.rules ?? []);
      setJinjerPositions(d.jinjerPositions ?? []);
    } catch (e) {
      setMsg(`取得に失敗しました: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(p: string, pos: string) {
    if (!p.trim()) {
      setMsg("jinjer の役職名を入力してください");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/position-rules", "POST", { pattern: p.trim(), position: pos, actor: ACTOR });
      const r = await apiSend<{ updated: number }>("/api/position-rules/apply", "POST", { actor: ACTOR });
      setMsg(`紐付けを保存しました: ${p.trim()} → ${pos}（${r.updated}名の役職を更新）`);
      setPattern("");
      await load();
    } catch (e) {
      setMsg(`保存できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await fetch(`/api/position-rules/${id}?actor=${ACTOR}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  // jinjer 側の役職名を確認する診断。
  async function probe() {
    setMsg("⏳ jinjer の役職項目を確認中…");
    try {
      const r = await apiSend<{
        connected: boolean;
        scanned: number;
        withPosition: number;
        fields: Array<{ path: string; filled: number; samples: string[] }>;
      }>("/api/members/jinjer-position-fields", "POST", {});
      if (!r.connected) {
        setMsg("jinjer のキーが未設定のため確認できません。");
        return;
      }
      if (r.fields.length === 0) {
        setMsg(
          `【jinjer 役職項目】${r.scanned}名を確認 → 役職らしい項目は見つかりませんでした。\n` +
            `jinjer 側に役職が登録されていないため、役職は全従業員一覧で個別に設定してください。`,
        );
        return;
      }
      setMsg(
        `【jinjer 役職項目】${r.scanned}名を確認 → 役職を持つ人 ${r.withPosition}名\n` +
          r.fields
            .map((f) => `・${f.path}: ${f.filled}名（例 ${f.samples.slice(0, 5).join("、")}）`)
            .join("\n") +
          `\n※ ここに出た値を下の表で Dig評価の役職に紐付けてください。`,
      );
    } catch (e) {
      setMsg(`確認できませんでした: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <SectionHeader
        title="役職の紐付け（jinjer の役職名 → Dig評価の役職）"
        note="所属の紐付けと同じ考え方。一覧で手入力した人は上書きしません"
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-muted">jinjer の役職名</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            list="jinjer-positions"
            placeholder="例: 部長 / マネージャー"
            className="w-56 rounded-card border border-surface-border px-2 py-1.5 text-sm"
          />
          <datalist id="jinjer-positions">
            {jinjerPositions.map((p) => (
              <option key={p.name} value={p.name}>
                {p.count}名
              </option>
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-muted">Dig評価の役職</span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as (typeof POSITIONS)[number])}
            className="rounded-card border border-surface-border px-2 py-1.5 text-sm"
          >
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void save(pattern, position)}
          disabled={busy}
          className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          紐付けて反映
        </button>
        <button
          onClick={() => void probe()}
          disabled={busy}
          className="rounded-card border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-muted disabled:opacity-50"
        >
          jinjer の役職項目を確認
        </button>
      </div>

      {msg && (
        <div className="mb-3 whitespace-pre-wrap rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">
          {msg}
        </div>
      )}

      {jinjerPositions.length > 0 && (
        <div className="mb-3 text-xs text-ink-muted">
          jinjer から取得できている役職名:{" "}
          {jinjerPositions.map((p) => `${p.name}（${p.count}名）`).join(" / ")}
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">jinjer の役職名</th>
              <th className="px-3 py-2 font-semibold">Dig評価の役職</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-ink-muted">
                  紐付けは未登録です（役職は全従業員一覧で個別に設定できます）
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} className="border-b border-surface-border last:border-0">
                  <td className="px-3 py-2">{r.pattern}</td>
                  <td className="px-3 py-2 font-medium text-ink">{r.position}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => void remove(r.id)}
                      disabled={busy}
                      className="text-xs text-semantic-danger disabled:opacity-50"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
