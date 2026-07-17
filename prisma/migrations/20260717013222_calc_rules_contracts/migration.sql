-- CreateEnum
CREATE TYPE "CalcRuleType" AS ENUM ('回線コール単価', '初回発注1to1', '月額基本料金割合', '固定Dig');

-- CreateTable
CREATE TABLE "CalcRule" (
    "id" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" "CalcRuleType" NOT NULL,
    "modelKeyFilter" TEXT,
    "unitLine" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitCall" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ratioPercent" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "fixedDig" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalcRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNo" TEXT,
    "customerName" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "initialFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "termMonths" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATE,
    "lineItems" JSONB NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAssignment" (
    "contractId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "shares" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractAssignment_pkey" PRIMARY KEY ("contractId")
);

-- CreateIndex
CREATE INDEX "CalcRule_division_idx" ON "CalcRule"("division");

-- CreateIndex
CREATE INDEX "Contract_division_idx" ON "Contract"("division");

-- CreateIndex
CREATE INDEX "Contract_yearMonth_idx" ON "Contract"("yearMonth");

-- AddForeignKey
ALTER TABLE "ContractAssignment" ADD CONSTRAINT "ContractAssignment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
