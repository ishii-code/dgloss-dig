-- CreateTable: 予算Digの月別上書き（計算値より優先）
CREATE TABLE "BudgetOverride" (
    "yearMonth" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "monthlyBudgetDig" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetOverride_pkey" PRIMARY KEY ("yearMonth","personId")
);

-- CreateIndex
CREATE INDEX "BudgetOverride_yearMonth_idx" ON "BudgetOverride"("yearMonth");

-- 2026年6月・7月の予算Dig（運用指定値）
INSERT INTO "BudgetOverride" ("yearMonth", "personId", "monthlyBudgetDig", "note", "updatedAt")
SELECT months.ym, m."personId", v.amount, '運用指定（6月・7月）', CURRENT_TIMESTAMP
FROM (VALUES ('2026-06'), ('2026-07')) AS months(ym)
CROSS JOIN (VALUES
    ('近藤', 3200000),
    ('福島', 3200000),
    ('掛端', 4300000),
    ('長澤', 2300000),
    ('保坂', 2300000)
  ) AS v(nm, amount)
JOIN "Member" m ON m."name" LIKE v.nm || '%' AND m."status" = '在籍'
ON CONFLICT ("yearMonth", "personId")
DO UPDATE SET "monthlyBudgetDig" = EXCLUDED."monthlyBudgetDig", "updatedAt" = CURRENT_TIMESTAMP;

-- グループ設定: 長澤・保坂 を 近藤 の配下にする
UPDATE "Member"
SET "groupLeaderId" = (SELECT "personId" FROM "Member" WHERE "name" LIKE '近藤%' AND "status" = '在籍' LIMIT 1)
WHERE ("name" LIKE '長澤%' OR "name" LIKE '保坂%') AND "status" = '在籍';
