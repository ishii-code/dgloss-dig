"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";

/** 全社設定に事業部別の上書きを重ねた実効値。 */
interface EffectiveSetting {
  budgetCoefficient: number;
  insuranceCoefficient: number;
  commonCostFulltime: number;
  commonCostParttime: number;
  promotion: { upTwo: number; upOne: number; downOne: number; downTwo: number };
}

/** この組織に直接入っている上書き。null は「上位を継承」。 */
interface OverrideSetting {
  budgetCoefficient: number | null;
  insuranceCoefficient: number | null;
  commonCostFulltime: number | null;
  commonCostParttime: number | null;
  promotionUpTwo: number | null;
  promotionUpOne: number | null;
  promotionDownOne: number | null;
  promotionDownTwo: number | null;
}

interface Unit {
  id: number;
  name: string;
  level: string;
  parentId: number | null;
  path: string;
  incentiveRatePct: number | null;
  effectiveIncentiveRatePct: number;
  setting: OverrideSetting;
  effectiveSetting: EffectiveSetting;
}

type OverrideKey = keyof OverrideSetting;

/** 列の定義。effective で実効値（＝未入力時のプレースホルダ）を引く。 */
const COLUMNS: {
  key: OverrideKey;
  label: string;
  step: number;
  effective: (s: EffectiveSetting) => number;
}[] = [
  { key: "budgetCoefficient", label: "予算係数", step: 0.1, effective: (s) => s.budgetCoefficient },
  { key: "insuranceCoefficient", label: "保険係数", step: 0.1, effective: (s) => s.insuranceCoefficient },
  { key: "commonCostFulltime", label: "座席代 正社員", step: 10000, effective: (s) => s.commonCostFulltime },
  { key: "commonCostParttime", label: "座席代 アルバイト", step: 10000, effective: (s) => s.commonCostParttime },
  { key: "promotionUpTwo", label: "昇2段", step: 0.05, effective: (s) => s.promotion.upTwo },
  { key: "promotionUpOne", label: "昇1段", step: 0.05, effective: (s) => s.promotion.upOne },
  { key: "promotionDownOne", label: "降1段", step: 0.05, effective: (s) => s.promotion.downOne },
  { key: "promotionDownTwo", label: "降2段", step: 0.05, effective: (s) => s.promotion.downTwo },
];

/**
 * 事業部別の Dig予算設定。旧「設定タブ」の全社一律の指標をここへ集約した。
 * 空欄は上位組織を継承し、どこにも無ければ全社既定が使われる。
 */
export function DivisionSettings({ divisionFilter = "" }: { divisionFilter?: string }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUnits(await apiGet<Unit[]>("/api/org-units"));
    } catch (e) {
      setMsg(`組織の取得に失敗しました: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function patch(u: Unit, body: Record<string, unknown>) {
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

  // 階層順（事業部 → 配下）に並べる。事業部で絞る場合はその事業部の枝だけ。
  const ordered: { unit: Unit; depth: number }[] = [];
  const push = (parent: number | null, depth: number) => {
    for (const u of units.filter((x) => x.parentId === parent)) {
      if (depth === 0 && divisionFilter && u.name !== divisionFilter) continue;
      ordered.push({ unit: u, depth });
      push(u.id, depth + 1);
    }
  };
  push(null, 0);

  return (
    <>
      <SectionHeader
        title="事業部別 Dig予算設定"
        note="予算Dig =（役職ベース × 保険係数 × 按分 ＋ 座席代）× 予算係数。空欄は上位組織を継承"
        accent="accent"
      />

      {msg && (
        <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>
      )}

      <div className="mb-8 overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-semibold">組織</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-center font-semibold">
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold">インセン還元率</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-3 py-3 text-ink-muted">
                  {divisionFilter
                    ? `「${divisionFilter}」に対応する組織が登録されていません（組織設定で同じ名前の事業部を作ってください）`
                    : "組織が未登録です。従業員マスタの「組織設定」でまず事業部を追加してください。"}
                </td>
              </tr>
            ) : (
              ordered.map(({ unit: u, depth }) => (
                <tr key={u.id} className="border-b border-surface-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                    {"　".repeat(depth)}
                    {u.name}
                    <span className="ml-1 text-[10px] text-ink-faint">{u.level}</span>
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-center">
                      <input
                        type="number"
                        step={c.step}
                        min={0}
                        disabled={busy}
                        defaultValue={u.setting[c.key] ?? ""}
                        placeholder={String(c.effective(u.effectiveSetting))}
                        title="未入力なら上位組織の設定、無ければ全社既定が適用されます"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === "" ? null : Number(raw);
                          if (next !== (u.setting[c.key] ?? null)) void patch(u, { [c.key]: next });
                        }}
                        className="tabular w-24 rounded-card border border-surface-border px-2 py-1 text-right text-xs"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={busy}
                      defaultValue={u.incentiveRatePct ?? ""}
                      placeholder={String(u.effectiveIncentiveRatePct)}
                      title="未入力なら上位組織の設定、無ければ既定20%が適用されます"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === "" ? null : Number(raw);
                        if (next !== (u.incentiveRatePct ?? null))
                          void patch(u, { incentiveRatePct: next });
                      }}
                      className="tabular w-16 rounded-card border border-surface-border px-2 py-1 text-right text-xs"
                    />
                    <span className="ml-1 text-[10px] text-ink-faint">%</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※ 昇降級しきい値は達成率（1.2 = 120%）。既定は 120%↑昇2 / 100%↑昇1 / 80%↓降1 / 60%↓降2。
          薄いグレーの数字は上位組織から継承している実効値です。
          借入の金利・初回借入額・返済期間は全社共通のため「金融管理」タブにあります。
        </div>
      </div>
    </>
  );
}
