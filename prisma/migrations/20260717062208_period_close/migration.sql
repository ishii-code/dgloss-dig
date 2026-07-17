-- AlterTable
ALTER TABLE "MonthlyEvaluation" ADD COLUMN     "seikaApproved" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "seikaApprovedBy" TEXT,
ADD COLUMN     "seikaInputBy" TEXT,
ADD COLUMN     "surplusChoice" TEXT NOT NULL DEFAULT 'incentive';

-- CreateTable
CREATE TABLE "RetirementSettlement" (
    "id" SERIAL NOT NULL,
    "personId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "loanBalance" DECIMAL(14,2) NOT NULL,
    "shares" JSONB NOT NULL,
    "note" TEXT,
    "settledBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetirementSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetirementSettlement_personId_idx" ON "RetirementSettlement"("personId");
