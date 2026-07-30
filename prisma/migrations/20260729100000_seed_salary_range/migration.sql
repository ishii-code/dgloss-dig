-- 給与レンジ表（役職 × A/B/C → 金額）。役職ベースの参照元（要件 F-1）。
INSERT INTO "SalaryRange" ("position", "grade", "amount") VALUES
  ('メンバー'::"Position",     'A',  183000),
  ('メンバー'::"Position",     'B',  255000),
  ('メンバー'::"Position",     'C',  345000),
  ('リーダー'::"Position",     'A',  280000),
  ('リーダー'::"Position",     'B',  370000),
  ('リーダー'::"Position",     'C',  460000),
  ('マネージャー'::"Position", 'A',  405000),
  ('マネージャー'::"Position", 'B',  540000),
  ('マネージャー'::"Position", 'C',  720000),
  ('部長'::"Position",         'A',  555000),
  ('部長'::"Position",         'B',  780000),
  ('部長'::"Position",         'C', 1095000)
ON CONFLICT ("position", "grade") DO UPDATE SET "amount" = EXCLUDED."amount";
