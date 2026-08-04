-- Dig譲渡: 申請 → 受け手の承認 で成果Digが移動する
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT '申請中';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "requestedBy" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "decidedBy" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "decidedOn" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;
-- 既存の記録は履歴として「承認済」に寄せる（過去分のDigは動かさない）
UPDATE "Transaction" SET "status" = '承認済' WHERE "status" = '申請中' AND "createdAt" < NOW();
CREATE INDEX IF NOT EXISTS "Transaction_payeeId_status_idx" ON "Transaction"("payeeId","status");
CREATE INDEX IF NOT EXISTS "Transaction_payerId_status_idx" ON "Transaction"("payerId","status");
