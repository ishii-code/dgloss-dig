-- カスタマーグロースの獲得ルール種別（新たに生まれた粗利を原資にする）
ALTER TYPE "CalcRuleType" ADD VALUE IF NOT EXISTS 'アップセル粗利';
ALTER TYPE "CalcRuleType" ADD VALUE IF NOT EXISTS '更新粗利';
ALTER TYPE "CalcRuleType" ADD VALUE IF NOT EXISTS 'チャーン損失';

-- 粗利率と初回営業への分配率をルールのパラメータとして持つ
ALTER TABLE "CalcRule" ADD COLUMN "marginRatePct" DECIMAL(5,2) NOT NULL DEFAULT 50;
ALTER TABLE "CalcRule" ADD COLUMN "salesSharePct" DECIMAL(5,2) NOT NULL DEFAULT 0;
