-- 事業部別の Dig予算設定（未設定なら祖先 → 全社既定 を継承）
ALTER TABLE "OrgUnit" ADD COLUMN "budgetCoefficient" DECIMAL(6,3);
ALTER TABLE "OrgUnit" ADD COLUMN "insuranceCoefficient" DECIMAL(6,3);
ALTER TABLE "OrgUnit" ADD COLUMN "commonCostFulltime" DECIMAL(12,2);
ALTER TABLE "OrgUnit" ADD COLUMN "commonCostParttime" DECIMAL(12,2);
ALTER TABLE "OrgUnit" ADD COLUMN "promotionUpTwo" DECIMAL(5,3);
ALTER TABLE "OrgUnit" ADD COLUMN "promotionUpOne" DECIMAL(5,3);
ALTER TABLE "OrgUnit" ADD COLUMN "promotionDownOne" DECIMAL(5,3);
ALTER TABLE "OrgUnit" ADD COLUMN "promotionDownTwo" DECIMAL(5,3);

-- 途中解約フラグ（契約管理DBから日次同期）とマイナスDigの確定
ALTER TABLE "Contract" ADD COLUMN "earlyCancel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contract" ADD COLUMN "canceledOn" DATE;
ALTER TABLE "Contract" ADD COLUMN "churnDig" DECIMAL(14,2);
ALTER TABLE "Contract" ADD COLUMN "churnDecidedBy" TEXT;
ALTER TABLE "Contract" ADD COLUMN "churnDecidedOn" TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN "churnNote" TEXT;

CREATE INDEX "Contract_earlyCancel_idx" ON "Contract"("earlyCancel");
