-- 月次の実労働時間（アルバイトの予算Dig算定）と、配下の合算方法
CREATE TABLE IF NOT EXISTS "WorkHours" (
  "yearMonth" TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "hours"     DECIMAL(8,2) NOT NULL,
  "source"    TEXT NOT NULL DEFAULT 'jinjer',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkHours_pkey" PRIMARY KEY ("yearMonth","personId")
);
CREATE INDEX IF NOT EXISTS "WorkHours_yearMonth_idx" ON "WorkHours"("yearMonth");

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "aggregateMode" TEXT NOT NULL DEFAULT '予算のみ';
