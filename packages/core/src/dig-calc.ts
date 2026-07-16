/**
 * Dig制度 計算エンジン（純関数）
 * 現行 Excel `dig_v5.xlsx` の数式（要件定義 §7）を移植。UI/DB非依存・高速テスト対象。
 * v1.1 反映: 累計予算Dig係数 四半期×3 / 半期×6（Q2）。
 */
import type {
  EmploymentType,
  EvaluationCycle,
  EvaluationLeg,
  LoanScheduleRow,
  MonthlyEvaluationResult,
  PromotionStep,
  QuarterBalanceResult,
  Rank,
  Setting,
} from "@dig/contracts";
import { INCENTIVE_RATE } from "@dig/contracts";

// ── 日付ユーティリティ ─────────────────────────
const MS_PER_DAY = 86_400_000;

/** 対象月の日数（YYYY-MM）。 */
export function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) throw new Error(`invalid yearMonth: ${yearMonth}`);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function utc(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`invalid date: ${dateStr}`);
  return Date.UTC(y, m - 1, d);
}

/**
 * 在籍日数（要件 §7-1）。
 * MAX(0, MIN(退社日 or 月末, 月末) − MAX(入社日, 月初) + 1)
 */
export function residencyDays(
  yearMonth: string,
  joinedOn: string,
  leftOn: string | null,
): number {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) throw new Error(`invalid yearMonth: ${yearMonth}`);
  const monthStart = Date.UTC(y, m - 1, 1);
  const monthEnd = Date.UTC(y, m, 0);

  const effStart = Math.max(utc(joinedOn), monthStart);
  const effEnd = Math.min(leftOn ? utc(leftOn) : monthEnd, monthEnd);

  const days = Math.floor((effEnd - effStart) / MS_PER_DAY) + 1;
  return Math.max(0, days);
}

/** 日割係数 = 在籍日数 ÷ 月の日数（要件 §7-2） */
export function prorationCoefficient(
  residency: number,
  daysInMonthValue: number,
): number {
  if (daysInMonthValue <= 0) return 0;
  return residency / daysInMonthValue;
}

// ── コスト・予算 ───────────────────────────────
/** 座席代 = 雇用形態別共通費 × 日割係数（要件 §7-3） */
export function seatCost(
  employmentType: EmploymentType,
  setting: Setting,
  proration: number,
): number {
  const base =
    employmentType === "正社員"
      ? setting.commonCostFulltime
      : setting.commonCostParttime;
  return base * proration;
}

/** 総コスト = 役職ベース × 社会保険係数 × 日割係数 + 座席代（要件 §7-4） */
export function totalCost(
  positionBase: number,
  setting: Setting,
  proration: number,
  seat: number,
): number {
  return positionBase * setting.insuranceCoefficient * proration + seat;
}

/**
 * Excel MROUND 相当（0 から遠い方向へ丸め＝round half away from zero）。
 */
export function mround(value: number, multiple: number): number {
  if (multiple === 0) return 0;
  const q = value / multiple;
  const rounded = Math.sign(q) * Math.round(Math.abs(q));
  return rounded * multiple;
}

/** 単月予算Dig = MROUND(総コスト × 予算係数, 100000)（要件 §7-5） */
export function monthlyBudgetDig(total: number, setting: Setting): number {
  return mround(total * setting.budgetCoefficient, 100_000);
}

/** 累計係数（v1.1 確定: 四半期=3 / 半期=6） */
export function cumulativeCoefficient(cycle: EvaluationCycle): number {
  return cycle === "四半期" ? 3 : 6;
}

/** 累計予算Dig = 単月予算Dig × 累計係数（要件 §7-6・v1.1） */
export function cumulativeBudgetDig(
  monthlyBudget: number,
  cycle: EvaluationCycle,
): number {
  return monthlyBudget * cumulativeCoefficient(cycle);
}

// ── 実績・達成率・ランク ───────────────────────
/** 実績Dig = 成果Dig + ボーナスDig + 借入Dig（要件 §7-8） */
export function actualDig(seika: number, bonus: number, loan: number): number {
  return seika + bonus + loan;
}

/** 達成率 = 実績Dig ÷ 予算Dig（0除算は0・要件 §7-9） */
export function achievementRate(actual: number, budget: number): number {
  if (budget === 0) return 0;
  return actual / budget;
}

/** 評価ランク（要件 §7-10）: S≥1.5 / A≥1.0 / B≥0.8 / C≥0.5 / D<0.5 */
export function evaluationRank(rate: number): Rank {
  if (rate >= 1.5) return "S";
  if (rate >= 1.0) return "A";
  if (rate >= 0.8) return "B";
  if (rate >= 0.5) return "C";
  return "D";
}

function leg(actual: number, budget: number): EvaluationLeg {
  const rate = achievementRate(actual, budget);
  return { actualDig: actual, achievementRate: rate, rank: evaluationRank(rate) };
}

// ── 月次評価の集約 ─────────────────────────────
export interface EvaluateMonthlyArgs {
  yearMonth: string;
  personId: string;
  employmentType: EmploymentType;
  positionBase: number;
  joinedOn: string;
  leftOn: string | null;
  evaluationCycle: EvaluationCycle;
  seikaDig: number;
  bonusDig: number;
  loanDig: number;
  setting: Setting;
}

/** 1メンバー・1ヶ月の評価を計算（要件 F-7）。 */
export function evaluateMonthly(
  args: EvaluateMonthlyArgs,
): MonthlyEvaluationResult {
  const dim = daysInMonth(args.yearMonth);
  const residency = residencyDays(args.yearMonth, args.joinedOn, args.leftOn);
  const proration = prorationCoefficient(residency, dim);
  const seat = seatCost(args.employmentType, args.setting, proration);
  const total = totalCost(args.positionBase, args.setting, proration, seat);
  const monthlyBudget = monthlyBudgetDig(total, args.setting);
  const cumulativeBudget = cumulativeBudgetDig(
    monthlyBudget,
    args.evaluationCycle,
  );
  const actual = actualDig(args.seikaDig, args.bonusDig, args.loanDig);

  return {
    yearMonth: args.yearMonth,
    personId: args.personId,
    residencyDays: residency,
    prorationCoefficient: proration,
    seatCost: seat,
    totalCost: total,
    monthlyBudgetDig: monthlyBudget,
    cumulativeBudgetDig: cumulativeBudget,
    seikaDig: args.seikaDig,
    bonusDig: args.bonusDig,
    loanDig: args.loanDig,
    monthly: leg(actual, monthlyBudget),
    cumulative: leg(actual, cumulativeBudget),
  };
}

// ── 借入 / Digloss Bank（要件 F-5, §7-11,12） ──
/** 利息 = 借入額 × 月利 */
export function loanInterest(principal: number, monthlyRate: number): number {
  return principal * monthlyRate;
}

/**
 * 借入の返済スケジュール（元利均等・termMonths 回）。
 * 現行 Excel: 元利合計 ÷ 返済期間を毎月返済、残高を翌月へ繰越。
 */
export function loanSchedule(
  principal: number,
  monthlyRate: number,
  termMonths: number,
): LoanScheduleRow[] {
  if (termMonths <= 0) throw new Error("termMonths must be positive");
  const rows: LoanScheduleRow[] = [];
  let opening = principal;
  for (let i = 0; i < termMonths; i++) {
    const interest = loanInterest(opening, monthlyRate);
    const principalPlusInterest = opening + interest;
    const repayment = principalPlusInterest / termMonths;
    const closing = principalPlusInterest - repayment;
    rows.push({
      openingBalance: opening,
      interest,
      principalPlusInterest,
      repayment,
      closingBalance: closing,
    });
    opening = closing;
  }
  return rows;
}

// ── 残高計算 / インセンティブ（要件 F-8, §7-13,14） ──
/** 残高 = max(獲得粗利 − 営業目標, 0) + ボーナスDig */
export function quarterBalance(
  gross: number,
  target: number,
  bonus: number,
): number {
  return Math.max(gross - target, 0) + bonus;
}

/** インセンティブ = 残高 × 20% */
export function incentiveAmount(balance: number): number {
  return balance * INCENTIVE_RATE;
}

/** 四半期/半期の残高・インセンティブ・ランクを集約（要件 F-8） */
export function computeQuarterBalance(args: {
  personId: string;
  gross: number;
  target: number;
  bonus: number;
}): QuarterBalanceResult {
  const rate = achievementRate(args.gross, args.target);
  const balance = quarterBalance(args.gross, args.target, args.bonus);
  return {
    personId: args.personId,
    target: args.target,
    gross: args.gross,
    achievementRate: rate,
    balance,
    incentive: incentiveAmount(balance),
    rank: evaluationRank(rate),
  };
}

// ── 昇降級判定（要件 F-8） ──────────────────────
/** 達成率から昇降級段数を判定（+2/+1/0/-1/-2） */
export function promotionStep(rate: number, setting: Setting): PromotionStep {
  const p = setting.promotion;
  if (rate >= p.upTwo) return 2;
  if (rate >= p.upOne) return 1;
  if (rate < p.downTwo) return -2;
  if (rate < p.downOne) return -1;
  return 0;
}
