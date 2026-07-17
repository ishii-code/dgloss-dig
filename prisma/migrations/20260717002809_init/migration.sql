-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('正社員', 'アルバイト');

-- CreateEnum
CREATE TYPE "EvaluationCycle" AS ENUM ('四半期', '半期');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('部長', 'マネージャー', 'リーダー', 'メンバー');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FS', 'IS', 'CS');

-- CreateEnum
CREATE TYPE "Rank" AS ENUM ('S', 'A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('在籍', '退社');

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('初回', '追加');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('申請中', '承認済', '却下', '完済');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "yearMonth" TEXT NOT NULL,
    "insuranceCoefficient" DECIMAL(6,3) NOT NULL,
    "budgetCoefficient" DECIMAL(6,3) NOT NULL,
    "annualRatePct" DECIMAL(6,3) NOT NULL,
    "initialLoanDefault" DECIMAL(14,2) NOT NULL,
    "loanTermMonthsDefault" INTEGER NOT NULL DEFAULT 12,
    "commonCostFulltime" DECIMAL(12,2) NOT NULL,
    "commonCostParttime" DECIMAL(12,2) NOT NULL,
    "promotionUpTwo" DECIMAL(5,3) NOT NULL,
    "promotionUpOne" DECIMAL(5,3) NOT NULL,
    "promotionDownOne" DECIMAL(5,3) NOT NULL,
    "promotionDownTwo" DECIMAL(5,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "SalaryRange" (
    "id" SERIAL NOT NULL,
    "position" "Position" NOT NULL,
    "grade" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SalaryRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "personId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "jobType" "JobType",
    "groupLeaderId" TEXT,
    "employmentType" "EmploymentType" NOT NULL,
    "hourlyWage" DECIMAL(10,2),
    "basePay" DECIMAL(12,2) NOT NULL,
    "positionBase" DECIMAL(12,2) NOT NULL,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "evaluationCycle" "EvaluationCycle" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT '在籍',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "MonthlyEvaluation" (
    "yearMonth" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL,
    "positionBase" DECIMAL(12,2) NOT NULL,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "residencyDays" INTEGER NOT NULL,
    "prorationCoefficient" DECIMAL(6,4) NOT NULL,
    "seatCost" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "monthlyBudgetDig" DECIMAL(14,2) NOT NULL,
    "cumulativeBudgetDig" DECIMAL(16,2) NOT NULL,
    "seikaDig" DECIMAL(14,2) NOT NULL,
    "bonusDig" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "loanDig" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monthlyActualDig" DECIMAL(14,2) NOT NULL,
    "monthlyRate" DECIMAL(8,4) NOT NULL,
    "monthlyRank" "Rank" NOT NULL,
    "cumulativeActualDig" DECIMAL(14,2) NOT NULL,
    "cumulativeRate" DECIMAL(8,4) NOT NULL,
    "cumulativeRank" "Rank" NOT NULL,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyEvaluation_pkey" PRIMARY KEY ("yearMonth","personId")
);

-- CreateTable
CREATE TABLE "BonusDigItem" (
    "itemId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grantDig" DECIMAL(12,2) NOT NULL,
    "monthlyCapDig" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BonusDigItem_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "BonusDigRecord" (
    "id" SERIAL NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "recordedOn" DATE NOT NULL,
    "personId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "grantedDig" DECIMAL(12,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "BonusDigRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" SERIAL NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "loanType" "LoanType" NOT NULL DEFAULT '追加',
    "status" "LoanStatus" NOT NULL DEFAULT '申請中',
    "principal" DECIMAL(14,2) NOT NULL,
    "monthlyRate" DECIMAL(6,4) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "appliedOn" DATE NOT NULL,
    "approvedBy" TEXT,
    "approvedOn" DATE,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "tradedOn" DATE NOT NULL,
    "payerId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRange_position_grade_key" ON "SalaryRange"("position", "grade");

-- CreateIndex
CREATE INDEX "Member_division_idx" ON "Member"("division");

-- CreateIndex
CREATE INDEX "Member_groupLeaderId_idx" ON "Member"("groupLeaderId");

-- CreateIndex
CREATE INDEX "MonthlyEvaluation_yearMonth_idx" ON "MonthlyEvaluation"("yearMonth");

-- CreateIndex
CREATE INDEX "BonusDigRecord_yearMonth_personId_idx" ON "BonusDigRecord"("yearMonth", "personId");

-- CreateIndex
CREATE INDEX "Loan_borrowerId_idx" ON "Loan"("borrowerId");

-- CreateIndex
CREATE INDEX "Loan_yearMonth_idx" ON "Loan"("yearMonth");

-- CreateIndex
CREATE INDEX "Loan_status_idx" ON "Loan"("status");

-- CreateIndex
CREATE INDEX "Transaction_yearMonth_idx" ON "Transaction"("yearMonth");

-- AddForeignKey
ALTER TABLE "MonthlyEvaluation" ADD CONSTRAINT "MonthlyEvaluation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Member"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusDigRecord" ADD CONSTRAINT "BonusDigRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Member"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusDigRecord" ADD CONSTRAINT "BonusDigRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BonusDigItem"("itemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Member"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Member"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Member"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;
