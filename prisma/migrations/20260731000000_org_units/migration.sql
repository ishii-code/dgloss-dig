-- 組織（事業部 > グループ > チーム）と、jinjer役職の紐付けを追加
CREATE TABLE IF NOT EXISTS "OrgUnit" (
  "id"        SERIAL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "level"     TEXT NOT NULL,
  "parentId"  INTEGER,
  "leaderId"  TEXT,
  "isTarget"  BOOLEAN NOT NULL DEFAULT false,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "OrgUnit_parentId_idx" ON "OrgUnit"("parentId");
CREATE INDEX IF NOT EXISTS "OrgUnit_level_idx" ON "OrgUnit"("level");

CREATE TABLE IF NOT EXISTS "PositionRule" (
  "id"        SERIAL PRIMARY KEY,
  "pattern"   TEXT NOT NULL,
  "position"  "Position" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PositionRule_pattern_key" ON "PositionRule"("pattern");

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "orgUnitId" INTEGER;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "jinjerPosition" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "positionManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "positionBaseManual" BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE "Member" ADD CONSTRAINT "Member_orgUnitId_fkey"
    FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
