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
  /** 年利率(%)（既定 12・ディグロス金融管理画面から変更可） */
  annualRatePct: z.number().min(0),
  /** 初回借入（入社時・必須）の既定額 */
  initialLoanDefault: z.number().min(0),
  /** 借入の既定返済期間(ヶ月) */
  loanTermMonthsDefault: z.number().int().positive(),
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
  initialLoanDefault: 2_000_000,
  loanTermMonthsDefault: 12,
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
// 借入管理 / Digloss Bank・ディグロス金融（要件 F-5・v1.2）
// ─────────────────────────────────────────────
/** 会社（ディグロス金融）を表す貸出者の固定名 */
export const COMPANY_LENDER = "ディグロス金融";

/** 借入種別: 初回=入社時(自動承認) / 追加=承認要 */
export const LoanType = z.enum(["初回", "追加"]);
export type LoanType = z.infer<typeof LoanType>;

/** 借入ステータス */
export const LoanStatus = z.enum(["申請中", "承認済", "却下", "完済"]);
export type LoanStatus = z.infer<typeof LoanStatus>;

export const LoanSchema = z.object({
  id: z.string().min(1).max(32),
  yearMonth: YearMonth,
  borrowerId: z.string().min(1).max(32),
  /** 貸出者: 会社は COMPANY_LENDER、相対は Person ID */
  lender: z.string().min(1).max(32),
  loanType: LoanType,
  status: LoanStatus,
  principal: z.number().positive(),
  monthlyRate: z.number().min(0), // 借入時の月利（例 0.01・以後の金利変更に不影響）
  termMonths: z.number().int().positive(),
  appliedOn: z.string().date(),
  approvedBy: z.string().max(32).nullable(), // 承認者(金融)。初回は自動承認
  approvedOn: z.string().date().nullable(),
  note: z.string().max(256).nullable(),
});
export type Loan = z.infer<typeof LoanSchema>;

/** 追加借入の申請（ディグロス金融が承認/却下する対象・要件 F-5） */
export const LoanApplicationSchema = z.object({
  borrowerId: z.string().min(1).max(32),
  requestedPrincipal: z.number().positive(),
  termMonths: z.number().int().positive(),
  reason: z.string().min(1).max(256),
  appliedOn: z.string().date(),
});
export type LoanApplication = z.infer<typeof LoanApplicationSchema>;

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

// ─────────────────────────────────────────────
// Dig獲得ルール（CalcRule・要件 F-3）
// 事業部別に「契約内容 → 付与Dig」を定義する。
// ─────────────────────────────────────────────
/**
 * ルール種別:
 * - 回線コール単価: line_items の回線数×unitLine + コール数×unitCall
 * - 初回発注1to1: 初期発注額(initial_fee)を 1円=1Dig（千円切捨）
 * - 月額基本料金割合: base_amount × ratioPercent%
 * - 固定Dig: 契約1件あたり fixedDig
 */
export const CalcRuleType = z.enum([
  "回線コール単価",
  "初回発注1to1",
  "月額基本料金割合",
  "固定Dig",
]);
export type CalcRuleType = z.infer<typeof CalcRuleType>;

export const CalcRuleSchema = z.object({
  id: z.string().min(1).max(32),
  division: z.string().min(1).max(64), // 事業部
  name: z.string().min(1).max(128),
  ruleType: CalcRuleType,
  /** 適用する課金形態（keiyaku model_key）。null=全て */
  modelKeyFilter: z.string().max(64).nullable(),
  unitLine: z.number().min(0).default(0), // 回線単価(Dig)
  unitCall: z.number().min(0).default(0), // コール単価(Dig)
  ratioPercent: z.number().min(0).max(1000).default(0), // 月額割合(%)
  fixedDig: z.number().min(0).default(0), // 固定Dig
  active: z.boolean().default(true),
});
export type CalcRule = z.infer<typeof CalcRuleSchema>;

// ─────────────────────────────────────────────
// 契約（keiyaku-kanri-next 連携・要件 F-3）
// keiyaku の Contract を Dig 計算に必要な範囲でミラー。
// ─────────────────────────────────────────────
export const ContractLineItem = z.object({
  key: z.string(), // lic / num / line / call / acct ...
  qty: z.number(),
  unit: z.number(),
});
export type ContractLineItem = z.infer<typeof ContractLineItem>;

export const ContractSchema = z.object({
  id: z.string().min(1),
  contractNo: z.string().nullable(),
  customerName: z.string(),
  division: z.string(), // 事業部（Dig帰属先の判定に使用）
  modelKey: z.string(), // 課金形態
  status: z.string(), // active / applying / paused / canceled / expiring
  baseAmount: z.number().min(0), // 月額基本料金
  setupFee: z.number().min(0).default(0),
  initialFee: z.number().min(0).default(0),
  termMonths: z.number().int().min(0).default(0),
  startDate: z.string().nullable(),
  lineItems: z.array(ContractLineItem).default([]),
});
export type Contract = z.infer<typeof ContractSchema>;

// ─────────────────────────────────────────────
// 契約→従業員のDig帰属（ContractAssignment・折半対応）
// 初期値はSFAの担当者名から引く／後から修正可能／複数人で折半(share%)
// ─────────────────────────────────────────────
export const AssignmentShare = z.object({
  personId: z.string().min(1).max(32),
  /** 折半割合(%)。複数人で合計100を想定 */
  sharePercent: z.number().min(0).max(100),
});
export type AssignmentShare = z.infer<typeof AssignmentShare>;

export const ContractAssignmentSchema = z.object({
  contractId: z.string().min(1),
  /** 帰属元: sfa（担当者名から自動）/ manual（手動修正） */
  source: z.enum(["sfa", "manual"]),
  shares: z.array(AssignmentShare).min(1),
});
export type ContractAssignment = z.infer<typeof ContractAssignmentSchema>;

/** 契約Dig計算＋帰属の結果（1契約） */
export interface ContractDigResult {
  contractId: string;
  totalDig: number;
  /** 従業員別の按分Dig */
  perPerson: { personId: string; dig: number }[];
}

// ─────────────────────────────────────────────
// アカウント・権限（RBAC）
// ─────────────────────────────────────────────
/** 権限ロール。SUPER_ADMIN > ADMIN > USER */
export const Role = z.enum(["SUPER_ADMIN", "ADMIN", "USER"]);
export type Role = z.infer<typeof Role>;

/** ロールの権限レベル（数値が大きいほど強い） */
export const ROLE_LEVEL: Record<Role, number> = {
  USER: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "スーパーADMIN",
  ADMIN: "ADMIN",
  USER: "ユーザー",
};

export const AccountSchema = z.object({
  id: z.string().min(1).max(64), // メール等
  email: z.string().email(),
  name: z.string().min(1).max(64),
  role: Role,
  /** 従業員マスタとの紐付け（任意） */
  personId: z.string().max(32).nullable(),
  active: z.boolean(),
});
export type Account = z.infer<typeof AccountSchema>;

/**
 * 画面（タブ）へのアクセスに必要な最低ロールレベル。
 * finance(金融承認)/master(従業員マスタ)/accounts(アカウント管理)= SUPER_ADMIN のみ。
 */
export const TAB_MIN_LEVEL: Record<string, number> = {
  monitor: 0,
  members: 0,
  bank: 0,
  bonus: 0,
  txn: 0,
  release: 0,
  rules: 1, // ADMIN 以上
  settings: 1, // ADMIN 以上
  finance: 2, // SUPER_ADMIN のみ（ディグロス金融 承認）
  master: 2, // SUPER_ADMIN のみ（従業員マスタ）
  accounts: 2, // SUPER_ADMIN のみ（アカウント管理）
};

/** ロールが対象タブにアクセスできるか。 */
export function canAccessTab(role: Role, tabKey: string): boolean {
  const need = TAB_MIN_LEVEL[tabKey] ?? 0;
  return ROLE_LEVEL[role] >= need;
}
