-- カスタマーグロースのインセンティブ還元率は 5%（営業は20%）。
-- 組織名は「カスタマーグロース事業部」「カスタマーグロース部」など揺れがあるため、
-- 事業部階層で名前に「カスタマーグロース」を含むものを対象にする。
-- 該当する組織がまだ登録されていない場合は何も起きない（画面から 5 を入力する）。
UPDATE "OrgUnit"
SET "incentiveRatePct" = 5
WHERE "level" = '事業部'
  AND "name" LIKE '%カスタマーグロース%'
  AND ("incentiveRatePct" IS NULL OR "incentiveRatePct" <> 5);
