"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";
const LEVELS = ["事業部", "グループ", "チーム"] as const;

export interface OrgUnit {
  id: number;
  name: string;
  level: string;
  parentId: number | null;
  leaderId: string | null;
  leaderName: string | null;
  isTarget: boolean;
  active: boolean;
  /** 「事業部 > グループ > チーム」の表示用パス */
  path: string;
  division: string | null;
  /** 自分または祖先が対象に指定されているか */
  inTargetScope: boolean;
  directMembers: number;
  totalMembers: number;
}

interface PickerMember {
  personId: string;
  name: string;
}

/**
 * 組織設定。事業部の配下にグループ、その配下にチームを作る。
 * ここで作った組織を全従業員一覧で選択して所属を決める。
 * 「評価対象」に指定した組織とその配下が Dig評価の対象になる。
 * 「長」を設定すると、その組織の配下メンバーの予算Digが長に合算される。
 */
export function OrgSettings({ members }: { members: PickerMember[] }) {
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("事業部");
  const [parentId, setParentId] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setUnits(await apiGet<OrgUnit[]>("/api/org-units"));
    } catch (e) {
      setMsg(`組織の取得に失敗しました: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 親に選べるのは1つ上の階層だけ（事業部→グループ→チーム）。
  const parentCandidates = units.filter((u) =>
    level === "グループ" ? u.level === "事業部" : level === "チーム" ? u.level === "グループ" : false,
  );

  async function add() {
    if (!name.trim()) {
      setMsg("組織名を入力してください");
      return;
    }
    if (level !== "事業部" && !parentId) {
      setMsg("親組織を選択してください");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/org-units", "POST", {
        name: name.trim(),
        level,
        parentId: level === "事業部" ? null : Number(parentId),
        actor: ACTOR,
      });
      setMsg(`${level}「${name.trim()}」を追加しました`);
      setName("");
      await load();
    } catch (e) {
      setMsg(`追加できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function patch(u: OrgUnit, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await apiSend(`/api/org-units/${u.id}`, "PATCH", { ...body, actor: ACTOR });
      await load();
    } catch (e) {
      setMsg(`更新できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: OrgUnit) {
    if (!confirm(`${u.path} を削除しますか？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/org-units/${u.id}?actor=${ACTOR}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "削除に失敗しました");
      setMsg(`${u.path} を削除しました`);
      await load();
    } catch (e) {
      setMsg(`削除できませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // 階層順（事業部 → その配下）に並べる。
  const ordered: OrgUnit[] = [];
  const push = (parent: number | null, depth: number) => {
    for (const u of units.filter((x) => x.parentId === parent)) {
      ordered.push({ ...u, level: u.level, name: `${"　".repeat(depth)}${u.name}` });
      push(u.id, depth + 1);
    }
  };
  push(null, 0);

  return (
    <>
      <SectionHeader
        title="組織設定"
        note="事業部 ＞ グループ ＞ チーム。ここで作った組織を全従業員一覧で選択します"
        accent="accent"
      />

      {msg && (
        <div className="mb-3 whitespace-pre-wrap rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">
          {msg}
        </div>
      )}

      {/* 追加フォーム */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-card border border-surface-border bg-white p-3 shadow-card">
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-muted">階層</span>
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as (typeof LEVELS)[number]);
              setParentId("");
            }}
            className="rounded-card border border-surface-border px-2 py-1.5 text-sm"
          >
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        {level !== "事業部" && (
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-muted">
              親組織（{level === "グループ" ? "事業部" : "グループ"}）
            </span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="rounded-card border border-surface-border px-2 py-1.5 text-sm"
            >
              <option value="">選択してください</option>
              {parentCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-muted">名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={level === "事業部" ? "AIテレアポ事業部" : "セールスG"}
            className="w-56 rounded-card border border-surface-border px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => void add()}
          disabled={busy}
          className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          追加
        </button>
      </div>

      <div className="overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">組織</th>
              <th className="px-3 py-2 font-semibold">階層</th>
              <th className="px-3 py-2 text-right font-semibold">所属（配下含む）</th>
              <th className="px-3 py-2 font-semibold">長（予算を合算）</th>
              <th className="px-3 py-2 text-center font-semibold">Dig評価の対象</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-ink-muted">
                  組織が未登録です。まず事業部を追加してください。
                </td>
              </tr>
            ) : (
              ordered.map((u) => (
                <tr key={u.id} className="border-b border-surface-border last:border-0">
                  <td className="px-3 py-2 font-medium text-ink">{u.name}</td>
                  <td className="px-3 py-2 text-ink-muted">{u.level}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">
                    {u.directMembers}（{u.totalMembers}）
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.leaderId ?? ""}
                      onChange={(e) => void patch(u, { leaderId: e.target.value || null })}
                      disabled={busy}
                      className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                    >
                      <option value="">なし</option>
                      {members.map((m) => (
                        <option key={m.personId} value={m.personId}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={u.isTarget}
                      disabled={busy}
                      onChange={(e) => void patch(u, { isTarget: e.target.checked })}
                    />
                    {!u.isTarget && u.inTargetScope && (
                      <span className="ml-1 text-[10px] text-ink-faint">（上位で対象）</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => void remove(u)}
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
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※「Dig評価の対象」に指定した組織とその配下のメンバーが評価台帳の対象になります（どの階層でも指定できます）。
          「長」を設定すると、その組織の配下メンバーの予算Dig・実績Digが長に合算されます。
          組織名を変更すると、配下メンバーの事業部表記も自動で追随します。
        </div>
      </div>
    </>
  );
}
