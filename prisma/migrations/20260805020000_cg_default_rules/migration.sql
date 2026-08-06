-- カスタマーグロースの獲得ルールを初期登録（確定値）。
-- 新しい enum 値は直前のマイグレーションで追加済み。PostgreSQL は
-- ALTER TYPE ADD VALUE と同じトランザクション内でその値を使えないため、
-- INSERT はこのファイル（＝別トランザクション）に分けている。
--
-- 事業部名が異なる場合は「Dig獲得ルール」タブから事業部を編集する。
INSERT INTO "CalcRule"
  ("id", "division", "name", "ruleType", "modelKeyFilter",
   "unitLine", "unitCall", "ratioPercent", "fixedDig",
   "marginRatePct", "salesSharePct", "active", "createdAt", "updatedAt")
VALUES
  ('R-CG-UPSELL', 'カスタマーグロース事業部', 'アップセル（追加回線・コール）',
   'アップセル粗利', NULL, 0, 0, 0, 0, 50, 30, true, NOW(), NOW()),
  ('R-CG-RENEWAL', 'カスタマーグロース事業部', '更新（2年目以降）',
   '更新粗利', NULL, 0, 0, 0, 0, 50, 20, true, NOW(), NOW()),
  ('R-CG-CHURN', 'カスタマーグロース事業部', '途中解約（チャーン損失）',
   'チャーン損失', NULL, 0, 0, 0, 0, 50, 50, true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
