-- CreateTable: Dig申請（成果Digの申請・承認）
CREATE TABLE "DigApplication" (
    "id" SERIAL NOT NULL,
    "applicantId" TEXT NOT NULL,
    "companyId" TEXT,
    "companyName" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "contractSummary" TEXT,
    "contractId" TEXT,
    "grantedDig" DECIMAL(14,2) NOT NULL,
    "splitDig" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "splitPartnerId" TEXT,
    "contractDate" DATE NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT '申請中',
    "reviewedBy" TEXT,
    "reviewedOn" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DigApplication_applicantId_idx" ON "DigApplication"("applicantId");
CREATE INDEX "DigApplication_status_idx" ON "DigApplication"("status");
