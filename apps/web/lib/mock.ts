/**
 * デモ用モックデータ。dig_v5.xlsx のメンバー一部を @dig/core で評価。
 * ※ P1 は成果Dig(獲得粗利)を手入力運用（v1.1 Q3）。ここでは手入力値をハードコード。
 */
import {
  DEFAULT_SETTING,
  type EmploymentType,
  type EvaluationCycle,
  type MonthlyEvaluationResult,
} from "@dig/contracts";
import { computeQuarterBalance, evaluateMonthly } from "@dig/core";

export const YEAR_MONTH = "2026-01";
export const QUARTER = "2025-3Q";

interface Seed {
  personId: string;
  name: string;
  division: string;
  employmentType: EmploymentType;
  positionBase: number;
  joinedOn: string;
  cycle: EvaluationCycle;
  /** 成果Dig(獲得粗利・手入力) */
  seikaDig: number;
  bonusDig: number;
  loanDig: number;
}

const SEEDS: Seed[] = [
  { personId: "B0000064", name: "掛端光", division: "AIテレアポ事業部", employmentType: "正社員", positionBase: 780_000, joinedOn: "2024-08-01", cycle: "半期", seikaDig: 8_910_000, bonusDig: 0, loanDig: 0 },
  { personId: "B0000068", name: "土屋知己", division: "AIテレアポ事業部", employmentType: "正社員", positionBase: 720_000, joinedOn: "2024-06-01", cycle: "半期", seikaDig: 3_435_000, bonusDig: 0, loanDig: 0 },
  { personId: "B0000098", name: "近藤浩人", division: "AIテレアポ事業部", employmentType: "正社員", positionBase: 540_000, joinedOn: "2025-11-01", cycle: "半期", seikaDig: 6_105_000, bonusDig: 50_000, loanDig: 0 },
  { personId: "B0000099", name: "福島伊吹", division: "AIテレアポ事業部", employmentType: "正社員", positionBase: 540_000, joinedOn: "2025-12-01", cycle: "半期", seikaDig: 4_291_250, bonusDig: 0, loanDig: 0 },
  { personId: "B0000097", name: "堀川璃歩", division: "AIテレアポ事業部", employmentType: "正社員", positionBase: 345_000, joinedOn: "2025-11-04", cycle: "四半期", seikaDig: 2_600_000, bonusDig: 10_000, loanDig: 0 },
  { personId: "B0000105", name: "色川巧美", division: "AIテレアポ事業部", employmentType: "正社員", positionBase: 345_000, joinedOn: "2026-01-05", cycle: "四半期", seikaDig: 1_200_000, bonusDig: 0, loanDig: 2_000_000 },
  { personId: "B0000069", name: "駒田真一郎", division: "SP事業部", employmentType: "正社員", positionBase: 555_000, joinedOn: "2024-09-09", cycle: "半期", seikaDig: 3_800_000, bonusDig: 0, loanDig: 0 },
  { personId: "B0000078", name: "櫛谷千春", division: "SP事業部", employmentType: "正社員", positionBase: 183_000, joinedOn: "2025-03-21", cycle: "四半期", seikaDig: 980_000, bonusDig: 1_000, loanDig: 0 },
  { personId: "B0000085", name: "本間駿", division: "CRM事業部", employmentType: "正社員", positionBase: 720_000, joinedOn: "2025-05-01", cycle: "半期", seikaDig: 5_400_000, bonusDig: 0, loanDig: 0 },
  { personId: "B0000087", name: "青木未来", division: "CRM事業部", employmentType: "正社員", positionBase: 255_000, joinedOn: "2025-06-01", cycle: "四半期", seikaDig: 1_650_000, bonusDig: 0, loanDig: 0 },
];

export interface MemberRow {
  personId: string;
  name: string;
  division: string;
  cycle: EvaluationCycle;
  eval: MonthlyEvaluationResult;
  incentive: number;
}

export const MEMBERS: MemberRow[] = SEEDS.map((s) => {
  const ev = evaluateMonthly({
    yearMonth: YEAR_MONTH,
    personId: s.personId,
    employmentType: s.employmentType,
    positionBase: s.positionBase,
    joinedOn: s.joinedOn,
    leftOn: null,
    evaluationCycle: s.cycle,
    seikaDig: s.seikaDig,
    bonusDig: s.bonusDig,
    loanDig: s.loanDig,
    setting: DEFAULT_SETTING,
  });
  // インセン原資=成果Digのみ（Q2/Q5案2: 残高=max(成果−目標,0)+ボーナス、借入は除外）
  const qb = computeQuarterBalance({
    personId: s.personId,
    gross: ev.seikaDig,
    target: ev.monthlyBudgetDig,
    bonus: s.bonusDig,
  });
  return {
    personId: s.personId,
    name: s.name,
    division: s.division,
    cycle: s.cycle,
    eval: ev,
    incentive: qb.incentive,
  };
});

export type Leg = "monthly" | "cumulative";

export interface Totals {
  budget: number;
  actual: number;
  rate: number;
  incentive: number;
}

export function totals(leg: Leg): Totals {
  let budget = 0;
  let actual = 0;
  let incentive = 0;
  for (const m of MEMBERS) {
    budget += leg === "monthly" ? m.eval.monthlyBudgetDig : m.eval.cumulativeBudgetDig;
    actual += m.eval[leg].actualDig;
    incentive += m.incentive;
  }
  return { budget, actual, rate: budget === 0 ? 0 : actual / budget, incentive };
}

export interface DivisionRow extends Totals {
  division: string;
  count: number;
}

export function byDivision(leg: Leg): DivisionRow[] {
  const map = new Map<string, DivisionRow>();
  for (const m of MEMBERS) {
    const cur =
      map.get(m.division) ??
      { division: m.division, budget: 0, actual: 0, rate: 0, incentive: 0, count: 0 };
    cur.budget += leg === "monthly" ? m.eval.monthlyBudgetDig : m.eval.cumulativeBudgetDig;
    cur.actual += m.eval[leg].actualDig;
    cur.incentive += m.incentive;
    cur.count += 1;
    map.set(m.division, cur);
  }
  const rows = [...map.values()];
  for (const r of rows) r.rate = r.budget === 0 ? 0 : r.actual / r.budget;
  return rows.sort((a, b) => b.actual - a.actual);
}
