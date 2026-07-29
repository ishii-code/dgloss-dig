"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";

interface Rule {
  id: number;
  pattern: string;
  division: string;
}

interface TeamRow {
  team: string; // jinjer の末端所属名
  division: string; // 現在の dgloss 事業部
  count: number;
}

/**
 * 部署の紐づけ（jinjer 所属名 → dgloss 事業部）。
 * jinjer の所属は末端チーム単位のため、事業部への対応をここで管理する。
 * 例: 「ダイレクトセールス部セールスG」「デリバリーISG」「カスタマーグロース部」→「AIテレアポ事業部」
 */
export function DivisionMapping() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newDivision, setNewDivision] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ rules: Rule[]; teams: TeamRow[] }>("/api/division-rules");
      setRules(d.rules ?? []);
      setTeams(d.teams ?? []);
    } catch (e) {
      setMsg(`読み込み失敗: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 既存の事業部候補（入力補助）。
  const divisions = [...new Set([...rules.map((r) => r.division), ...teams.map((t) => t.division)])]
    .filter(Boolean)
    .sort();

  async function saveRule(pattern: string, division: string) {
    if (!pattern.trim() || !division.trim()) {
      setMsg("所属名と事業部の両方を入力してください");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/division-rules", "POST", { pattern, division, actor: ACTOR });
      setMsg(`紐づけを保存しました: ${pattern} → ${division}`);
      setNewPattern("");
      setNewDivision("");
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: number) {
    if (!confirm("この紐づけを削除しますか？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/division-rules/${id}?actor=${ACTOR}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      setMsg("紐づけを削除しました");
    } catch (e) {
      setMsg(`削除失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function reapply() {
    setBusy(true);
    setMsg("⏳ 紐づけを全メンバーへ反映中…");
    try {
      const r = await apiSend<{ updated: number; total: number; rules: number }>(
        "/api/division-rules/apply",
        "POST",
        { actor: ACTOR },
      );
      setMsg(`反映完了: ${r.updated}名の事業部を更新（対象${r.total}名 / ルール${r.rules}件）`);
      await load();
    } catch (e) {
      setMsg(`反映失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        title="部署の紐づけ"
        note="jinjer の所属（末端チーム）→ dgloss の事業部。前方一致で判定します。"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="jinjer 所属名（例: ダイレクトセールス部セールスG）"
          className="min-w-[280px] flex-1 rounded-card border border-surface-border px-3 py-1.5 text-sm"
        />
        <span className="text-ink-muted">→</span>
        <input
          value={newDivision}
          onChange={(e) => setNewDivision(e.target.value)}
          placeholder="事業部（例: AIテレアポ事業部）"
          list="division-candidates"
          className="min-w-[200px] rounded-card border border-surface-border px-3 py-1.5 text-sm"
        />
        <datalist id="division-candidates">
          {divisions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <button
          onClick={() => void saveRule(newPattern, newDivision)}
          disabled={busy}
          className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60"
        >
          紐づけを追加
        </button>
        <button
          onClick={() => void reapply()}
          disabled={busy}
          className="rounded-card bg-brand-accent px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60"
        >
          全メンバーへ反映
        </button>
      </div>

      {msg && (
        <div className="mb-3 whitespace-pre-wrap rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">
          {msg}
        </div>
      )}

      {/* 登録済みルール */}
      <div className="mb-5 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">jinjer 所属名（前方一致）</th>
              <th className="px-3 py-2 font-semibold">→ 事業部</th>
              <th className="px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-ink-muted">
                  紐づけルールはまだありません
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} className="border-b border-surface-border last:border-0">
                  <td className="px-3 py-2">{r.pattern}</td>
                  <td className="px-3 py-2 font-semibold text-ink">{r.division}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => void removeRule(r.id)} className="text-semantic-danger">
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* jinjer 所属別の在籍人数（未紐づけの発見用） */}
      <SectionHeader title="jinjer 所属別の在籍人数" note="未紐づけの所属をここから割り当てます" />
      <div className="overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">jinjer 所属</th>
              <th className="px-3 py-2 text-right font-semibold">人数</th>
              <th className="px-3 py-2 font-semibold">現在の事業部</th>
              <th className="px-3 py-2 font-semibold">この所属を紐づける</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.team} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2">{t.team}</td>
                <td className="px-3 py-2 text-right tabular">{t.count}</td>
                <td className="px-3 py-2 text-ink-muted">{t.division || "—"}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => {
                      setNewPattern(t.team);
                      setNewDivision(t.division || "");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="text-brand-primary"
                  >
                    上の入力欄へ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
