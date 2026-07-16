/**
 * Digloss Bank / ディグロス金融 デモ用モック（要件 F-5・v1.2）。
 * 入社時=必須初回借入(自動承認) / 追加借入=申請中(金融承認待ち)。
 * ※ 永続化は P4（Supabase）。ここではUI検証用の初期データ。
 */
import { DEFAULT_SETTING, type Loan } from "@dig/contracts";
import { buildInitialLoan, loanSchedule, monthlyRateFromAnnual } from "@dig/core";
import { MEMBERS, YEAR_MONTH } from "./mock";

/** 入社時の必須初回借入（全メンバー・自動承認） */
const initialLoans: Loan[] = MEMBERS.map((m, i) =>
  buildInitialLoan({
    id: `L-INIT-${i + 1}`,
    yearMonth: YEAR_MONTH,
    borrowerId: m.personId,
    joinedOn: `${YEAR_MONTH}-01`,
    setting: DEFAULT_SETTING,
  }),
);

/** 追加借入の申請（ディグロス金融の承認待ち・デモ2件） */
const additionalLoans: Loan[] = [
  {
    id: "L-ADD-1",
    yearMonth: YEAR_MONTH,
    borrowerId: "B0000097",
    lender: "ディグロス金融",
    loanType: "追加",
    status: "申請中",
    principal: 1_000_000,
    monthlyRate: monthlyRateFromAnnual(DEFAULT_SETTING.annualRatePct),
    termMonths: 12,
    appliedOn: `${YEAR_MONTH}-12`,
    approvedBy: null,
    approvedOn: null,
    note: null,
    reason: "OJT延長に伴う運転資金",
  } as Loan & { reason: string },
  {
    id: "L-ADD-2",
    yearMonth: YEAR_MONTH,
    borrowerId: "B0000078",
    lender: "ディグロス金融",
    loanType: "追加",
    status: "申請中",
    principal: 500_000,
    monthlyRate: monthlyRateFromAnnual(DEFAULT_SETTING.annualRatePct),
    termMonths: 6,
    appliedOn: `${YEAR_MONTH}-20`,
    approvedBy: null,
    approvedOn: null,
    note: null,
    reason: "資格取得費用の立替",
  } as Loan & { reason: string },
];

export interface LoanView extends Loan {
  reason?: string;
  borrowerName: string;
  /** 現在残高（当月返済1回後） */
  currentBalance: number;
  /** 当月返済 */
  monthlyRepayment: number;
}

function nameOf(personId: string): string {
  return MEMBERS.find((m) => m.personId === personId)?.name ?? personId;
}

function toView(loan: Loan & { reason?: string }): LoanView {
  const sched = loanSchedule(loan.principal, loan.monthlyRate, loan.termMonths);
  const first = sched[0];
  return {
    ...loan,
    borrowerName: nameOf(loan.borrowerId),
    currentBalance: loan.status === "承認済" ? (first?.closingBalance ?? loan.principal) : loan.principal,
    monthlyRepayment: first?.repayment ?? 0,
  };
}

export const ALL_LOANS: LoanView[] = [...initialLoans, ...additionalLoans].map(toView);

/** 返済スケジュール（表示用）。 */
export function scheduleOf(loan: LoanView) {
  return loanSchedule(loan.principal, loan.monthlyRate, loan.termMonths);
}
