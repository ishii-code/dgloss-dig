/**
 * @dig/contracts — Dig制度 共有契約（型・zodスキーマ・enum）
 * 全リポ（core/web/api）の source of truth。ここを起点に contract-first で開発する。
 * 要件定義: docs/Dig制度_システム要件定義書_v1.1.md
 */
import { z } from "zod";

// ─────────────────────────────────────────────
// enum / リテラル
// ─────────────────────────────────────────────
export const EmploymentType = z.enum(["正社員", "アルバイト"]);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const EvaluationCycle = z.enum(["四半期", "半期"]);
export type EvaluationCycle = z.infer<typeof EvaluationCycle>;

export const Position = z.enum(["部長", "マネージャー", "リーダー", "メンバー"]);
export type Position = z.infer<typeof Position>;

export const JobType = z.enum(["FS", "IS", "CS"]);
export type JobType = z.infer<typeof JobType>;

/** 評価ランク（達成率で決定） */
export const Rank = z.enum(["S", "A", "B", "C", "D"]);
export type Rank = z.infer<typeof Rank>;

export const MemberStatus = z.enum(["在籍", "退社"]);
export type MemberStatus = z.infer<typeof MemberStatus>;

/** ボーナスDig カテゴリ */
export const BonusCategory = z.enum([
  "インプット・アウトプット",
  "スキルアップ",
  "ナレッジ共有",
  "改善提案",
  "健康・勤怠",
  "組織貢献",
]);
export type BonusCategory = z.infer<typeof BonusCategory>;

// ─────────────────────────────────────────────
// 設定マスタ（要件 F-1）
// ─────────────────────────────────────────────
export const SettingSchema = z.object({
  /** 社会保険係数（既定 1.2） */
  insuranceCoefficient: z.number().positive(),
  /** 予算係数（既定 4.0） */
  budgetCoefficient: z.number().positive(),
  /** 年利率(%)（既定 12） */
  annualRatePct: z.number().min(0),
  /** 正社員 共通費（座席代・月額） */
  commonCostFulltime: z.number().min(0),
  /** アルバイト 共通費（座席代・月額） */
  commonCostParttime: z.number().min(0),
  /** 昇降級しきい値（達成率） */
  promotion: z.object({
    upTwo: z.number(), // 120% 以上 → 2段昇級
    upOne: z.number(), // 100% 以上 → 1段昇級
    downOne: z.number(), // 80% 未満 → 1段降級
    downTwo: z.number(), // 60% 未満 → 2段降級
  }),
});
export type Setting = z.infer<typeof SettingSchema>;

/** 既定設定（設定シート準拠） */
export const DEFAULT_SETTING: Setting = {
  insuranceCoefficient: 1.2,
  budgetCoefficient: 4.0,
  annualRatePct: 12,
  commonCostFulltime: 350_000,
  commonCostParttime: 150_000,
  promotion: { upTwo: 1.2, upOne: 1.0, downOne: 0.8, downTwo: 0.6 },
};

// ─────────────────────────────────────────────
// メンバーマスタ（要件 F-2）
// ─────────────────────────────────────────────
export const MemberSchema = z.object({
  /** Person ID（従業員マスタで手入力・全連携の突合キー / v1.1 Q4） */
  personId: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  division: z.string().min(1).max(64), // 事業部
  position: Position,
  jobType: JobType.nullable(),
  groupLeaderId: z.string().max(32).nullable(), // 所属1（グループ長のPerson ID）
  employmentType: EmploymentType,
  hourlyWage: z.number().min(0).nullable(), // アルバイトのみ
  basePay: z.number().min(0), // 基本給与
  positionBase: z.number().min(0), // 役職ベース（総コスト算定に使用）
  joinedOn: z.string().date(), // 入社日 YYYY-MM-DD
  leftOn: z.string().date().nullable(), // 退社日
  evaluationCycle: EvaluationCycle,
  status: MemberStatus,
});
export type Member = z.infer<typeof MemberSchema>;

// ─────────────────────────────────────────────
// 月次評価（要件 F-7）
// ─────────────────────────────────────────────
/** 対象年月 YYYY-MM */
export const YearMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "YYYY-MM 形式で指定してください");
export type YearMonth = z.infer<typeof YearMonth>;

/** 月次評価の入力（成果Dig=獲得粗利は手入力 / v1.1 Q3） */
export const MonthlyEvaluationInputSchema = z.object({
  yearMonth: YearMonth,
  personId: z.string().min(1).max(32),
  /** 成果Dig（獲得粗利・手入力） */
  seikaDig: z.number().min(0),
  /** 借入Dig（当月借入・借入管理から） */
  loanDig: z.number().min(0).default(0),
});
export type MonthlyEvaluationInput = z.infer<typeof MonthlyEvaluationInputSchema>;

/** 月次評価の計算結果（単月/累計の2系統） */
export interface EvaluationLeg {
  /** 実績Dig = 成果 + ボーナス + 借入 */
  actualDig: number;
  /** 達成率 = 実績Dig / 予算Dig */
  achievementRate: number;
  rank: Rank;
}

export interface MonthlyEvaluationResult {
  yearMonth: YearMonth;
  personId: string;
  residencyDays: number;
  prorationCoefficient: number;
  seatCost: number;
  totalCost: number;
  monthlyBudgetDig: number;
  cumulativeBudgetDig: number;
  seikaDig: number;
  bonusDig: number;
  loanDig: number;
  /** 単月評価 */
  monthly: EvaluationLeg;
  /** 累計評価 */
  cumulative: EvaluationLeg;
}

// ─────────────────────────────────────────────
// ボーナスDig（要件 F-4）
// ─────────────────────────────────────────────
export const BonusDigItemSchema = z.object({
  itemId: z.string().min(1).max(16),
  category: BonusCategory,
  name: z.string().min(1).max(128),
  grantDig: z.number().min(0),
  monthlyCapDig: z.number().min(0),
  description: z.string().max(256).nullable(),
  enabled: z.boolean(),
});
export type BonusDigItem = z.infer<typeof BonusDigItemSchema>;

export const BonusDigRecordSchema = z.object({
  yearMonth: YearMonth,
  recordedOn: z.string().date(),
  personId: z.string().min(1).max(32),
  itemId: z.string().min(1).max(16),
  grantedDig: z.number().min(0),
  note: z.string().max(256).nullable(),
});
export type BonusDigRecord = z.infer<typeof BonusDigRecordSchema>;

// ─────────────────────────────────────────────
// 借入管理 / Digloss Bank（要件 F-5）
// ─────────────────────────────────────────────
export const LoanSchema = z.object({
  yearMonth: YearMonth,
  borrowerId: z.string().min(1).max(32),
  /** 貸出者: 会社は "ディグロス"、相対は Person ID */
  lender: z.string().min(1).max(32),
  principal: z.number().positive(),
  monthlyRate: z.number().min(0), // 月利（例 0.01）
  termMonths: z.number().int().positive(),
  note: z.string().max(256).nullable(),
});
export type Loan = z.infer<typeof LoanSchema>;

export interface LoanScheduleRow {
  /** 借入残高（月初） */
  openingBalance: number;
  interest: number;
  /** 元利合計 */
  principalPlusInterest: number;
  /** 当月返済 */
  repayment: number;
  /** 返済後残高（翌月へ繰越） */
  closingBalance: number;
}

// ─────────────────────────────────────────────
// 取引記録 / メンバー間送金（要件 F-6）
// ─────────────────────────────────────────────
export const TransactionSchema = z
  .object({
    yearMonth: YearMonth,
    tradedOn: z.string().date(),
    payerId: z.string().min(1).max(32),
    payeeId: z.string().min(1).max(32),
    amount: z.number().positive(),
    description: z.string().min(1).max(128),
    note: z.string().max(256).nullable(),
  })
  .refine((v) => v.payerId !== v.payeeId, {
    message: "自己送金はできません",
    path: ["payeeId"],
  });
export type Transaction = z.infer<typeof TransactionSchema>;

// ─────────────────────────────────────────────
// 残高計算 / インセンティブ（要件 F-8）
// ─────────────────────────────────────────────
export interface QuarterBalanceResult {
  personId: string;
  /** 営業目標（予算Dig） */
  target: number;
  /** 獲得粗利（成果Dig合計） */
  gross: number;
  achievementRate: number;
  /** 残高 = max(gross - target, 0) + bonus */
  balance: number;
  /** インセンティブ = 残高 × 20% */
  incentive: number;
  rank: Rank;
}

/** インセンティブ率（超過分の20%） */
export const INCENTIVE_RATE = 0.2;

/** 昇降級判定結果（+2/+1/0/-1/-2 段） */
export type PromotionStep = 2 | 1 | 0 | -1 | -2;
