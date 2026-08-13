-- 所属組織（チーム）の履歴。月ごとにチーム構成が変わるため、
-- 「いつからそこにいるか」を持ち、月を指定して当時の所属を引けるようにする。
--
-- 既存データには行を作らない。履歴が無い人は Member."orgUnitId"（現在の所属）に
-- フォールバックするため、この移行だけでは既存の見え方は変わらない。
CREATE TABLE "MemberOrgHistory" (
    "personId" TEXT NOT NULL,
    "fromYearMonth" TEXT NOT NULL,
    "orgUnitId" INTEGER,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberOrgHistory_pkey" PRIMARY KEY ("personId","fromYearMonth")
);

CREATE INDEX "MemberOrgHistory_fromYearMonth_idx" ON "MemberOrgHistory"("fromYearMonth");
CREATE INDEX "MemberOrgHistory_orgUnitId_idx" ON "MemberOrgHistory"("orgUnitId");

ALTER TABLE "MemberOrgHistory" ADD CONSTRAINT "MemberOrgHistory_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Member"("personId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberOrgHistory" ADD CONSTRAINT "MemberOrgHistory_orgUnitId_fkey"
  FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
