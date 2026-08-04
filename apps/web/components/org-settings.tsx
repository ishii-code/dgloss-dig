"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
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
  /** この組織に設定した還元率(%)。未設定は null */
  incentiveRatePct: number | null;
  /** 実際に適用される還元率(%)（未設定なら祖先→既定20） */
  effectiveIncentiveRatePct: number;
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
  /** 所属組織。人数のドリルダウンで使う */
  orgUnitId?: number | null;
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
  // 所属人数をクリックしたときに、その組織の在籍者名を出す。
  const [openMembers, setOpenMembers] = useState<number | null>(null);

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

  /** 指定した組織とその配下すべての組織ID。 */
  const descendantsOf = (rootId: number): Set<number> => {
    const ids = new Set<number>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of units) {
        if (u.parentId !== null && ids.has(u.parentId) && !ids.has(u.id)) {
          ids.add(u.id);
          grew = true;
        }
      }
    }
    return ids;
  };

  /** 直属と、配下（子孫）だけに居るメンバーを分けて返す。 */
  const membersOf = (unitId: number) => {
    const ids = descendantsOf(unitId);
    const direct = members.filter((m) => m.orgUnitId === unitId);
    const below = members.filter((m) => m.orgUnitId != null && m.orgUnitId !== unitId && ids.has(m.orgUnitId));
    return { direct, below };
  };

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
              <th className="px-3 py-2 text-center font-semibold">インセン還元率</th>
              <th className="px-3 py-2 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-ink-muted">
                  組織が未登録です。まず事業部を追加してください。
                </td>
              </tr>
            ) : (
              ordered.map((u) => (
                <Fragment key={u.id}>
                <tr className="border-b border-surface-border last:border-0">
                  <td className="px-3 py-2 font-medium text-ink">{u.name}</td>
                  <td className="px-3 py-2 text-ink-muted">{u.level}</td>
                  {/* 人数をクリックすると在籍者名を下に開く。 */}
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setOpenMembers(openMembers === u.id ? null : u.id)}
                      disabled={u.totalMembers === 0}
                      title={u.totalMembers === 0 ? "所属者がいません" : "クリックで氏名を表示"}
                      className="text-ink-muted underline decoration-dotted underline-offset-2 disabled:cursor-default disabled:no-underline disabled:opacity-60"
                    >
                      {u.directMembers}（{u.totalMembers}）
                    </button>
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
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={u.incentiveRatePct ?? ""}
                      placeholder={String(u.effectiveIncentiveRatePct)}
                      disabled={busy}
                      title="未入力なら上位組織の設定、無ければ既定20%が適用されます"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === "" ? null : Number(raw);
                        if (next !== (u.incentiveRatePct ?? null)) void patch(u, { incentiveRatePct: next });
                      }}
                      className="tabular w-16 rounded-card border border-surface-border px-2 py-1 text-right text-xs"
                    />
                    <span className="ml-1 text-[10px] text-ink-faint">%</span>
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
                {openMembers === u.id && (
                  <tr className="border-b border-surface-border bg-surface-panel">
                    <td colSpan={7} className="px-3 py-2 text-xs">
                      {(() => {
                        const { direct, below } = membersOf(u.id);
                        if (direct.length === 0 && below.length === 0)
                          return <span className="text-ink-faint">所属者がいません</span>;
                        return (
                          <div className="space-y-1">
                            {direct.length > 0 && (
                              <div>
                                <span className="mr-2 font-semibold text-ink">直属 {direct.length}名</span>
                                <span className="text-ink-muted">{direct.map((m) => m.name).join("・")}</span>
                              </div>
                            )}
                            {below.length > 0 && (
                              <div>
                                <span className="mr-2 font-semibold text-ink">配下 {below.length}名</span>
                                <span className="text-ink-muted">{below.map((m) => m.name).join("・")}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※「Dig評価の対象」に指定した組織とその配下のメンバーが評価台帳の対象になります（どの階層でも指定できます）。
          「長」を設定すると、その組織の配下メンバーの予算Dig・実績Digが長に合算されます。
          組織名を変更すると、配下メンバーの事業部表記も自動で追随します。
          「インセン還元率」は未入力なら上位組織の設定を引き継ぎ、どこにも無ければ既定20%です
          （カスタマーグロースは5%を設定してください）。
        </div>
      </div>
    </>
  );
}
