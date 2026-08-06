/**
 * Dig制度 計算エンジン（純関数）
 * 現行 Excel `dig_v5.xlsx` の数式（要件定義 §7）を移植。UI/DB非依存・高速テスト対象。
 * v1.1 反映: 累計予算Dig係数 四半期×3 / 半期×6（Q2）。
 */
import type {
  CalcRule,
  Contract,
  ContractAssignment,
  ContractDigResult,
  EmploymentType,
  EvaluationCycle,
  EvaluationLeg,
  Loan,
  LoanScheduleRow,
  MonthlyEvaluationResult,
  PromotionStep,
  QuarterBalanceResult,
  Rank,
  Setting,
} from "@dig/contracts";
import { COMPANY_LENDER, INCENTIVE_RATE, SALARY_ROW_ORDER, SALARY_TABLE } from "@dig/contracts";

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

// ── 借入 / Digloss Bank・ディグロス金融（要件 F-5, §7-11,12） ──
/** 年利(%) → 月利（例: 12% → 0.01）。ディグロス金融の金利変更に追従。 */
export function monthlyRateFromAnnual(annualRatePct: number): number {
  return annualRatePct / 100 / 12;
}

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

/**
 * 入社時の必須初回借入を生成（要件 F-5・v1.2）。
 * 会社（ディグロス金融）からの借入で、初回は自動承認（承認不要）。
 * 金利は設定の年利から算出（＝借入時点のレートを固定保持）。
 */
export function buildInitialLoan(args: {
  id: string;
  yearMonth: string;
  borrowerId: string;
  joinedOn: string;
  setting: Setting;
}): Loan {
  return {
    id: args.id,
    yearMonth: args.yearMonth,
    borrowerId: args.borrowerId,
    lender: COMPANY_LENDER,
    loanType: "初回",
    status: "承認済",
    principal: args.setting.initialLoanDefault,
    monthlyRate: monthlyRateFromAnnual(args.setting.annualRatePct),
    termMonths: args.setting.loanTermMonthsDefault,
    appliedOn: args.joinedOn,
    approvedBy: COMPANY_LENDER, // 自動承認
    approvedOn: args.joinedOn,
    note: "入社時 必須初回借入（自動承認）",
  };
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

/**
 * インセンティブの原資 = max(獲得粗利 − 営業目標, 0)。
 * 残高と違い **ボーナスDig は含めない**（行動指標に還元金は付けない）。
 */
export function incentiveBase(gross: number, target: number): number {
  return Math.max(gross - target, 0);
}

/**
 * インセンティブ = 原資（上振れ分）× 還元率。
 * 既定は 20%（営業）。カスタマーグロースなど組織ごとに率が異なる場合は rate を渡す。
 */
export function incentiveAmount(base: number, rate = INCENTIVE_RATE): number {
  return base * rate;
}

/** 四半期/半期の残高・インセンティブ・ランクを集約（要件 F-8） */
export function computeQuarterBalance(args: {
  personId: string;
  gross: number;
  target: number;
  bonus: number;
  /** インセンティブの還元率（既定 20%。カスタマーグロースは 5%） */
  incentiveRate?: number;
}): QuarterBalanceResult {
  const rate = achievementRate(args.gross, args.target);
  const balance = quarterBalance(args.gross, args.target, args.bonus);
  return {
    personId: args.personId,
    target: args.target,
    gross: args.gross,
    achievementRate: rate,
    balance,
    // 還元原資は上振れ分のみ。ボーナスDigは残高には積むが、インセンには算入しない。
    incentive: incentiveAmount(
      incentiveBase(args.gross, args.target),
      args.incentiveRate ?? INCENTIVE_RATE,
    ),
    rank: evaluationRank(rate),
  };
}

// ── Dig獲得ルール適用（要件 F-3・keiyaku連携） ──
/** コール単価の基準数量。「1万コールあたり◯Dig」で単価を持つ。 */
export const CALL_UNIT = 10_000;

/** 千円単位切り捨て */
function floorThousand(v: number): number {
  return Math.floor(v / 1000) * 1000;
}

/** 1契約にルールを適用して付与Digを算出（要件 F-3）。 */
export function computeContractDig(contract: Contract, rule: CalcRule): number {
  if (!rule.active) return 0;
  if (rule.modelKeyFilter && rule.modelKeyFilter !== contract.modelKey) return 0;
  // キャンセル・停止は対象外
  if (contract.status === "canceled" || contract.status === "paused") return 0;

  switch (rule.ruleType) {
    case "回線コール単価": {
      const line = contract.lineItems
        .filter((li) => li.key === "line")
        .reduce((s, li) => s + li.qty, 0);
      const call = contract.lineItems
        .filter((li) => li.key === "call")
        .reduce((s, li) => s + li.qty, 0);
      // 単価は「1回線あたり」「1万コールあたり」の月額。契約期間を掛けて総額にする。
      // コールは万コール未満も按分する（35,000コール → 3.5万コール分）。
      const monthly = line * rule.unitLine + (call / CALL_UNIT) * rule.unitCall;
      const months = Math.max(0, contract.termMonths);
      // 初期費用は 1円 = 1Dig（千円未満切捨）で加算する。
      return Math.round(monthly * months) + floorThousand(contract.initialFee);
    }
    case "初回発注1to1":
      return floorThousand(contract.initialFee);
    case "月額基本料金割合":
      return Math.round((contract.baseAmount * rule.ratioPercent) / 100);
    case "固定Dig":
      return rule.fixedDig;
    default:
      return 0;
  }
}

/** 合計Digを帰属(share%)で按分（折半対応・要件 F-3）。端数は先頭者へ寄せる。 */
export function splitDig(
  total: number,
  assignment: ContractAssignment,
): { personId: string; dig: number }[] {
  const sumShare = assignment.shares.reduce((s, a) => s + a.sharePercent, 0);
  if (sumShare <= 0) return [];
  const raw = assignment.shares.map((a) => ({
    personId: a.personId,
    dig: Math.floor((total * a.sharePercent) / sumShare),
  }));
  const distributed = raw.reduce((s, r) => s + r.dig, 0);
  if (raw.length > 0) raw[0]!.dig += total - distributed; // 端数調整
  return raw;
}

/** 契約Dig計算＋帰属を1件分まとめる。 */
export function resolveContractDig(
  contract: Contract,
  rule: CalcRule,
  assignment: ContractAssignment,
): ContractDigResult {
  const totalDig = computeContractDig(contract, rule);
  return { contractId: contract.id, totalDig, perPerson: splitDig(totalDig, assignment) };
}

/** 複数契約から従業員別の成果Dig合計を集計（Dig反映用）。 */
export function aggregateSeikaDig(results: ContractDigResult[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    for (const p of r.perPerson) {
      map.set(p.personId, (map.get(p.personId) ?? 0) + p.dig);
    }
  }
  return map;
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

/**
 * 昇級用の達成率（借入抜き・Q1案1）。
 * 借入は「降級回避」のみに効かせ、昇級は成果＋ボーナスで判定する。
 * - 降級/評価ランク: 実績Dig（借入込み）で判定（従来どおり achievementRate）
 * - 昇級: この rate（借入抜き）で判定
 */
export function promotionRate(seika: number, bonus: number, budget: number): number {
  return achievementRate(seika + bonus, budget);
}

/**
 * 2系統の昇降級段数（Q1案1）。
 * 昇級は借入抜きレート、降級は借入込みレートで判定し、両者を合成する。
 */
export function promotionStepDual(args: {
  actualRate: number; // 借入込み（降級・評価用）
  promoRate: number; // 借入抜き（昇級用）
  setting: Setting;
}): PromotionStep {
  const p = args.setting.promotion;
  // 昇級は借入抜きで
  if (args.promoRate >= p.upTwo) return 2;
  if (args.promoRate >= p.upOne) return 1;
  // 降級は借入込みで（借入で降級回避）
  if (args.actualRate < p.downTwo) return -2;
  if (args.actualRate < p.downOne) return -1;
  return 0;
}


// ── バーター契約（相互発注）の獲得Dig ──
/** 同額バーターの固定Dig（運用値）。 */
export const BARTER_EQUAL_DIG = 200_000;

/**
 * バーター契約の獲得Dig。
 * - 同額発注 … 固定 BARTER_EQUAL_DIG
 * - 当方の発注額（支出）が先方からの発注額（売上）より大きい … 付与なし
 * - 当方の発注額のほうが小さい … 差額（千円切捨）の半額
 *
 * @param ourOrder 当方が先方へ発注した額（支出）
 * @param theirOrder 先方が当方へ発注した額（売上）
 */
export function barterDig(ourOrder: number, theirOrder: number, equalDig = BARTER_EQUAL_DIG): number {
  const ours = Math.max(0, Math.floor(ourOrder));
  const theirs = Math.max(0, Math.floor(theirOrder));
  if (ours === theirs) return ours === 0 ? 0 : equalDig;
  if (ours > theirs) return 0; // 当方の持ち出しが多いケースは付与しない
  return Math.floor(floorThousand(theirs - ours) / 2);
}

// ── 期途中入社の累計（Q7・入社月除外・翌月〜評価時点） ──
/** 2つの YYYY-MM の月差（b - a）。 */
export function monthDiff(aYm: string, bYm: string): number {
  const [ya, ma] = aYm.split("-").map(Number);
  const [yb, mb] = bYm.split("-").map(Number);
  if (!ya || !ma || !yb || !mb) throw new Error("invalid yearMonth");
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * 累計対象月数（Q7）。入社月は除外し、翌月から対象年月（評価時点）まで。
 * サイクル月数（四半期3/半期6）で上限クランプ。
 */
export function cumulativeMonths(joinedYm: string, targetYm: string, cycleMonths: number): number {
  const elapsed = monthDiff(joinedYm, targetYm); // 入社月→対象月 = 翌月から数えた月数
  return Math.max(0, Math.min(cycleMonths, elapsed));
}

/** 累計予算Dig（Q7）= 単月予算Dig × 累計対象月数。 */
export function cumulativeBudgetElapsed(monthlyBudget: number, months: number): number {
  return monthlyBudget * months;
}

// ── 管理職インセンのブレンド（Q9・個人+グループ） ──
/** 個人インセン × w + グループインセン ×(1-w)。既定 個人70%/グループ30%。 */
export function blendedIncentive(
  personalIncentive: number,
  groupIncentive: number,
  personalWeight = 0.7,
): number {
  const w = Math.min(Math.max(personalWeight, 0), 1);
  return personalIncentive * w + groupIncentive * (1 - w);
}

// ── クローバック（Q11・早期解約は期間比例で巻き戻し） ──
/**
 * 早期解約時に巻き戻す成果Dig（Q11案2）。
 * 巻き戻し = 計上Dig × 残存期間/契約期間。monthsFulfilled は充足済み月数。
 */
export function clawback(totalDig: number, termMonths: number, monthsFulfilled: number): number {
  if (termMonths <= 0) return 0;
  const remaining = Math.max(0, termMonths - Math.max(0, monthsFulfilled));
  return Math.round((totalDig * remaining) / termMonths);
}

// ── 超過分の持ち越し/インセン選択（Q3） ──
export type SurplusChoice = "incentive" | "carryover";

/**
 * 超過分（surplus = max(成果−目標,0)）の配分（Q3）。
 * incentive: 超過分 × 還元率（既定20%・カスタマーグロースは5%）を現金インセンに。
 * carryover: 超過分を翌期へ持ち越し（インセンは出さない）。
 */
export function surplusAllocation(
  surplus: number,
  choice: SurplusChoice,
  rate = INCENTIVE_RATE,
): { incentive: number; carryover: number } {
  const s = Math.max(0, surplus);
  if (choice === "carryover") return { incentive: 0, carryover: s };
  return { incentive: s * rate, carryover: 0 };
}

/** マイナス着地（成果<0）＝減給査定（Q3）。減給段数を返す（既存降級ロジックに準拠）。 */
export function demotionOnNegative(seika: number, setting: Setting): PromotionStep {
  if (seika >= 0) return 0;
  // マイナスは強制的に最大降級（下げピッチ2段）
  return promotionStep(-1, setting); // rate<0 → -2
}

// ── 安全弁（Q15・行動指標=ボーナスを評価に重み小で算入） ──
/**
 * 評価用の達成率（Q15案2）。ボーナスDig（行動指標）は重み behaviorWeight で算入。
 * 借入は降級回避のため全額算入（Q1）。
 */
export function evaluationRateWithBehavior(args: {
  seika: number;
  bonus: number;
  loan: number;
  budget: number;
  behaviorWeight?: number; // 既定 0.5（重み小）
}): number {
  const w = args.behaviorWeight ?? 0.5;
  const actual = args.seika + args.bonus * w + args.loan;
  return achievementRate(actual, args.budget);
}

// ── 相対貸借のゼロサム（Q12） ──
/**
 * 相対貸借のゼロサム調整（Q12案1）。承認時、貸し手Dig減算/借り手加算。
 * 返り値は各人のDig増減。利息は当事者間で任意（ここでは元本のみ）。
 */
export function zeroSumTransfer(
  lenderId: string,
  borrowerId: string,
  principal: number,
): { personId: string; delta: number }[] {
  return [
    { personId: lenderId, delta: -principal },
    { personId: borrowerId, delta: principal },
  ];
}

// ── 全社統一給与テーブル（Q6・16期人事制度） ──
/**
 * 昇降級段数に応じてラダー上を移動し、移動後の行と月額総支給を返す。
 * step>0=昇級（上へ・上げピッチ）、step<0=降級（下へ・下げピッチ）。範囲外はクランプ。
 */
export function salaryGradeMove(
  grade: string,
  currentRow: number,
  step: number,
): { row: number; amount: number } {
  const table = SALARY_TABLE[grade];
  if (!table) throw new Error(`unknown grade: ${grade}`);
  const order = SALARY_ROW_ORDER;
  const idx = order.indexOf(currentRow);
  if (idx < 0) throw new Error(`invalid row: ${currentRow}`);
  // step>0（昇級）は order 上で index を減らす（上＝高給）
  const newIdx = Math.min(Math.max(idx - step, 0), order.length - 1);
  const row = order[newIdx]!;
  return { row, amount: table[row]! };
}

// ── カスタマーグロース（更新・アップセル・チャーン）の獲得Dig ──
/** 粗利率の既定値（運用確定値: 50%）。 */
export const CG_MARGIN_RATE = 0.5;

/** 分配率の既定値（CG:営業）。アップセルは 70:30、更新は 80:20。 */
export const CG_SPLIT_UPSELL_SALES_PCT = 30;
export const CG_SPLIT_RENEWAL_SALES_PCT = 20;
/** チャーン（途中解約）のマイナスは CG と営業で折半する。 */
export const CG_SPLIT_CHURN_SALES_PCT = 50;

/**
 * 新たに生まれた粗利から獲得Digを出す（Dig転換率100%＝粗利1円=1Dig・千円切捨）。
 * @param monthlyAmount 対象の月額（アップセルなら増分、更新なら契約月額）
 * @param months 対象期間の月数（アップセルなら残契約月数、更新なら更新期間）
 * @param marginRate 粗利率（既定 0.5）
 */
export function cgGrossDig(monthlyAmount: number, months: number, marginRate = CG_MARGIN_RATE): number {
  if (monthlyAmount <= 0 || months <= 0) return 0;
  return floorThousand(Math.round(monthlyAmount * marginRate * months));
}

/** アップセルの獲得Dig（増分月額 × 粗利率 × 残契約月数）。 */
export function cgUpsellDig(
  addedMonthlyAmount: number,
  remainingMonths: number,
  marginRate = CG_MARGIN_RATE,
): number {
  return cgGrossDig(addedMonthlyAmount, remainingMonths, marginRate);
}

/** 更新の獲得Dig（月額 × 粗利率 × 更新期間）。 */
export function cgRenewalDig(
  monthlyAmount: number,
  renewalMonths: number,
  marginRate = CG_MARGIN_RATE,
): number {
  return cgGrossDig(monthlyAmount, renewalMonths, marginRate);
}

/**
 * チャーン（解約）のDig。
 * - **更新月での解約（契約期間の満了）はマイナスなし**（0）
 * - **途中解約は残存期間の粗利をマイナス計上**
 *
 * @param monthlyAmount 契約月額
 * @param remainingMonths 解約時点の残契約月数（満了なら0）
 * @param atRenewal 更新月での解約（契約満了に伴う終了）か
 */
export function cgChurnDig(
  monthlyAmount: number,
  remainingMonths: number,
  atRenewal: boolean,
  marginRate = CG_MARGIN_RATE,
): number {
  if (atRenewal) return 0; // 満了に伴う終了はマイナスにしない
  const gross = cgGrossDig(monthlyAmount, remainingMonths, marginRate);
  return gross === 0 ? 0 : -gross; // -0 を返さない

}

/**
 * 原資を CG と初回担当営業へ分ける。原資は増やさず、同じ額を割る。
 * チャーン（マイナス）も同じ式で折半できるよう、正負どちらでも扱える。
 * 端数は必ず CG 側に寄せる（cg + sales === totalDig を保つ）。
 * @param totalDig 分配前の獲得Dig（マイナス可）
 * @param salesPercent 営業の取り分（%）
 */
export function cgSplit(totalDig: number, salesPercent: number): { cg: number; sales: number } {
  if (totalDig === 0) return { cg: 0, sales: 0 };
  const pct = Math.min(100, Math.max(0, salesPercent));
  // trunc は 0 方向へ丸めるため、マイナスでも営業の負担が過大にならない。
  const raw = Math.trunc((totalDig * pct) / 100);
  const sales = raw === 0 ? 0 : raw; // -0 を返さない
  return { cg: totalDig - sales, sales };
}

/**
 * 登録した獲得ルールを使って、CG の獲得Digと分配を求める。
 * 契約管理DBに更新・アップセルの履歴が入るまでは Dig申請フォームからの手入力を想定し、
 * 金額と月数を引数で受ける（ルールからは粗利率と分配率だけを使う）。
 *
 * @param rule ruleType が アップセル粗利 / 更新粗利 / チャーン損失 のルール
 * @param monthlyAmount 対象の月額（アップセルなら増分、更新・チャーンなら契約月額）
 * @param months 対象期間の月数（アップセルとチャーンは残契約月数、更新は更新期間）
 * @param atRenewal チャーン損失のときだけ意味を持つ。更新月での解約（満了）なら true
 */
export function cgRuleDig(
  rule: Pick<CalcRule, "ruleType" | "marginRatePct" | "salesSharePct" | "active">,
  monthlyAmount: number,
  months: number,
  atRenewal = false,
): { total: number; cg: number; sales: number } {
  const none = { total: 0, cg: 0, sales: 0 };
  if (!rule.active) return none;
  const marginRate = rule.marginRatePct / 100;

  switch (rule.ruleType) {
    case "アップセル粗利":
    case "更新粗利": {
      const total = cgGrossDig(monthlyAmount, months, marginRate);
      const split = cgSplit(total, rule.salesSharePct);
      return { total, cg: split.cg, sales: split.sales };
    }
    case "チャーン損失": {
      // マイナスも CG と初回営業で分担する（既定は折半）。
      const total = cgChurnDig(monthlyAmount, months, atRenewal, marginRate);
      const split = cgSplit(total, rule.salesSharePct);
      return { total, cg: split.cg, sales: split.sales };
    }
    default:
      return none;
  }
}

// ── 事業部別の Dig予算設定（組織ツリーで継承） ──
/**
 * 組織ごとに上書きできる Dig予算設定。null は「上位組織を継承」を意味する。
 * 事業部に設定するのが基本だが、グループ／チームでも上書きできる。
 */
export interface OrgSettingOverride {
  budgetCoefficient: number | null;
  insuranceCoefficient: number | null;
  commonCostFulltime: number | null;
  commonCostParttime: number | null;
  promotionUpTwo: number | null;
  promotionUpOne: number | null;
  promotionDownOne: number | null;
  promotionDownTwo: number | null;
}

export const ORG_SETTING_KEYS = [
  "budgetCoefficient",
  "insuranceCoefficient",
  "commonCostFulltime",
  "commonCostParttime",
  "promotionUpTwo",
  "promotionUpOne",
  "promotionDownOne",
  "promotionDownTwo",
] as const satisfies readonly (keyof OrgSettingOverride)[];

/** 上書きなし（全項目が上位継承）。 */
export const EMPTY_ORG_OVERRIDE: OrgSettingOverride = {
  budgetCoefficient: null,
  insuranceCoefficient: null,
  commonCostFulltime: null,
  commonCostParttime: null,
  promotionUpTwo: null,
  promotionUpOne: null,
  promotionDownOne: null,
  promotionDownTwo: null,
};

/** 組織ツリーのノード（継承をたどるのに必要な最小限）。 */
export interface OrgSettingNode extends OrgSettingOverride {
  id: number;
  parentId: number | null;
}

/**
 * 自分 → 祖先 の順にたどり、項目ごとに最初に見つかった値を採用して1つの上書きにまとめる。
 * 循環参照があっても止まる（訪問済みは打ち切り）。
 */
export function inheritedOverride(
  id: number | null,
  byId: Map<number, OrgSettingNode>,
): OrgSettingOverride {
  const out = { ...EMPTY_ORG_OVERRIDE };
  let cur = id === null ? undefined : byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    for (const k of ORG_SETTING_KEYS) {
      if (out[k] === null && cur[k] !== null) out[k] = cur[k];
    }
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return out;
}

/** 全社設定に事業部別の上書きを重ねた Setting を返す（未設定の項目は全社設定のまま）。 */
export function mergeSetting(base: Setting, ov: OrgSettingOverride): Setting {
  return {
    ...base,
    budgetCoefficient: ov.budgetCoefficient ?? base.budgetCoefficient,
    insuranceCoefficient: ov.insuranceCoefficient ?? base.insuranceCoefficient,
    commonCostFulltime: ov.commonCostFulltime ?? base.commonCostFulltime,
    commonCostParttime: ov.commonCostParttime ?? base.commonCostParttime,
    promotion: {
      upTwo: ov.promotionUpTwo ?? base.promotion.upTwo,
      upOne: ov.promotionUpOne ?? base.promotion.upOne,
      downOne: ov.promotionDownOne ?? base.promotion.downOne,
      downTwo: ov.promotionDownTwo ?? base.promotion.downTwo,
    },
  };
}
