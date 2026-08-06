"use client";

import { yen } from "@/lib/format";

export interface SchemeRule {
  ruleType: string;
  name: string;
  marginRatePct: number;
  salesSharePct: number;
  active: boolean;
  /** 一覧と同じパラメータ表記（RULE_SPEC 由来） */
  params: { label: string; value: string }[];
}

interface SchemeSetting {
  budgetCoefficient: number;
  insuranceCoefficient: number;
  commonCostFulltime: number;
  commonCostParttime: number;
  promotion: { upTwo: number; upOne: number; downOne: number; downTwo: number };
}

export interface DivisionScheme {
  division: string;
  setting: SchemeSetting | null;
  incentiveRatePct: number | null;
  rules: SchemeRule[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * 事業部の制度サマリ。予算Digの作り方・成果Digの作り方・インセンを1枚で見せる。
 * 数値は事業部別設定と登録済みの獲得ルールから引くので、設定を変えればここも変わる。
 */
export function DivisionSchemeCard({ scheme }: { scheme: DivisionScheme }) {
  const s = scheme.setting;
  const active = scheme.rules.filter((r) => r.active);
  const margin = active.filter((r) =>
    ["アップセル粗利", "更新粗利", "チャーン損失"].includes(r.ruleType),
  );

  return (
    <div className="mb-4 rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="mb-3 text-sm font-bold text-ink">{scheme.division} の制度</div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold text-ink-muted">予算Dig（コスト×係数）</div>
          {s ? (
            <>
              <div className="tabular text-sm text-ink">
                （役職ベース × {s.insuranceCoefficient} × 按分 ＋ 座席代）× {s.budgetCoefficient}
              </div>
              <div className="mt-1 text-[11px] text-ink-faint">
                座席代 正社員 {yen(s.commonCostFulltime)}円 / アルバイト {yen(s.commonCostParttime)}円（月額）
              </div>
            </>
          ) : (
            <div className="text-xs text-ink-faint">組織が未登録のため全社既定です</div>
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold text-ink-muted">成果Dig（獲得ルール）</div>
          {active.length === 0 ? (
            <div className="text-xs text-ink-faint">有効なルールがありません</div>
          ) : (
            <ul className="space-y-1 text-xs text-ink">
              {active.map((r) => (
                <li key={r.name}>
                  <div className="font-medium">{r.ruleType}</div>
                  <div className="flex flex-wrap gap-x-3">
                    {r.params.map((p) => (
                      <span key={p.label} className="whitespace-nowrap">
                        <span className="text-ink-faint">{p.label}</span>{" "}
                        <span className="text-ink-muted">{p.value}</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {margin.length > 0 && (
            <div className="mt-1 text-[11px] text-ink-faint">
              原資は「新たに生まれた粗利」。初回契約期間の粗利は営業に配分済みのため対象外です。
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold text-ink-muted">インセンティブ・昇降級</div>
          <div className="tabular text-sm text-ink">
            上振れ分 × {scheme.incentiveRatePct ?? 20}%
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">
            原資は予算超過分のみ（ボーナスDig・借入Digは含めない）
          </div>
          {s && (
            <div className="mt-1 text-[11px] text-ink-faint">
              昇降級 {pct(s.promotion.upTwo)}↑昇2 / {pct(s.promotion.upOne)}↑昇1 /{" "}
              {pct(s.promotion.downOne)}↓降1 / {pct(s.promotion.downTwo)}↓降2
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
