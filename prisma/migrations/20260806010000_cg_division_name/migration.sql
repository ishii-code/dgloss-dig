-- 事業部名を「カスタマーグロース部」に統一する（こちらが正）。
-- 獲得ルールは事業部名の文字列で紐づくため、揃えないと予算設定と噛み合わない。
UPDATE "CalcRule" SET "division" = 'カスタマーグロース部' WHERE "division" = 'カスタマーグロース事業部';
UPDATE "Contract" SET "division" = 'カスタマーグロース部' WHERE "division" = 'カスタマーグロース事業部';
UPDATE "Member"   SET "division" = 'カスタマーグロース部' WHERE "division" = 'カスタマーグロース事業部';
UPDATE "MonthlyEvaluation" SET "division" = 'カスタマーグロース部' WHERE "division" = 'カスタマーグロース事業部';
-- TargetDivision は division が主キー。既に新名があるなら旧名の行を消すだけにする。
DELETE FROM "TargetDivision" WHERE "division" = 'カスタマーグロース事業部'
  AND EXISTS (SELECT 1 FROM "TargetDivision" t WHERE t."division" = 'カスタマーグロース部');
UPDATE "TargetDivision" SET "division" = 'カスタマーグロース部' WHERE "division" = 'カスタマーグロース事業部';
-- jinjer所属→事業部の紐づけルールも合わせる。
UPDATE "DivisionRule" SET "division" = 'カスタマーグロース部' WHERE "division" = 'カスタマーグロース事業部';
-- 個別指定の事業部（Member.divisionOverride）も揃える。
UPDATE "Member" SET "divisionOverride" = 'カスタマーグロース部' WHERE "divisionOverride" = 'カスタマーグロース事業部';

-- 旧名の組織が残っていれば削除する。ただし配下の組織や所属メンバーが居る場合は
-- 消すと参照が壊れるため残す（画面の警告に出るので、手動で移してから削除する）。
DELETE FROM "OrgUnit" o
WHERE o."level" = '事業部'
  AND o."name" = 'カスタマーグロース事業部'
  AND NOT EXISTS (SELECT 1 FROM "OrgUnit" c WHERE c."parentId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "Member" m WHERE m."orgUnitId" = o."id");
