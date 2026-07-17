-- AlterEnum
ALTER TYPE "LoanStatus" ADD VALUE '差し戻し';

-- CreateTable
CREATE TABLE "LoanMessage" (
    "id" SERIAL NOT NULL,
    "loanId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAttachment" (
    "id" SERIAL NOT NULL,
    "loanId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '事業計画',
    "note" TEXT,
    "url" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRead" (
    "loanId" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRead_pkey" PRIMARY KEY ("loanId","accountId")
);

-- CreateIndex
CREATE INDEX "LoanMessage_loanId_idx" ON "LoanMessage"("loanId");

-- CreateIndex
CREATE INDEX "LoanAttachment_loanId_idx" ON "LoanAttachment"("loanId");

-- AddForeignKey
ALTER TABLE "LoanMessage" ADD CONSTRAINT "LoanMessage_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAttachment" ADD CONSTRAINT "LoanAttachment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRead" ADD CONSTRAINT "LoanRead_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
