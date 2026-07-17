"use client";

import { SALARY_GRADES, SALARY_ROW_ORDER, SALARY_TABLE } from "@dig/contracts";
import { yen } from "@/lib/format";
import { SectionHeader } from "./ui";

function tableLabel(row: number): string {
  if (row === 0) return "基準";
  return row <= 9 ? "A" : "B";
}

export function SalaryTable() {
  return (
    <>
      <SectionHeader
        title="全社統一給与テーブル"
        note="16期人事制度・給与テーブル(C)。昇降級は本テーブルの行移動で反映。全メンバー閲覧可。"
      />
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span>上＝高給（テーブルA・行1〜9）／基準（行0）／下＝低給（テーブルB・行10〜18）</span>
        <span>昇級＝行を上へ（上げピッチ）／降級＝行を下へ（下げピッチ）</span>
      </div>

      <div className="overflow-x-auto rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-xs text-ink-muted">
              <th className="px-3 py-2 text-left font-semibold">区分</th>
              <th className="px-3 py-2 text-center font-semibold">行</th>
              {SALARY_GRADES.map((g) => (
                <th key={g.grade} className="px-3 py-2 text-right font-semibold">
                  <div className="text-ink">{g.role}</div>
                  <div className="text-[10px] text-ink-faint">等級{g.grade}</div>
                </th>
              ))}
            </tr>
            <tr className="border-b border-surface-border bg-white text-[11px] text-ink-faint">
              <td className="px-3 py-1.5 text-left" colSpan={2}>上げ / 下げピッチ</td>
              {SALARY_GRADES.map((g) => (
                <td key={g.grade} className="px-3 py-1.5 text-right tabular">
                  +{yen(g.upPitch)} / -{yen(g.downPitch)}
                </td>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {SALARY_ROW_ORDER.map((row) => {
              const base = row === 0;
              return (
                <tr
                  key={row}
                  className={`border-b border-surface-border last:border-0 ${base ? "bg-emerald-50 font-bold" : ""}`}
                >
                  <td className="px-3 py-1.5 text-left text-ink-muted">
                    {base ? "基準" : `テーブル${tableLabel(row)}`}
                  </td>
                  <td className="px-3 py-1.5 text-center text-ink-muted">{row}</td>
                  {SALARY_GRADES.map((g) => (
                    <td key={g.grade} className="px-3 py-1.5 text-right text-ink">
                      {yen(SALARY_TABLE[g.grade]![row]!)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          ※ CRM事業部は本テーブル対象外で事業部設定内容に準ずる。値は月の総支給額。
        </div>
      </div>
    </>
  );
}
