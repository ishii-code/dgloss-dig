-- 組織ごとのインセンティブ還元率（未設定なら祖先→既定20%。カスタマーグロースは5%）
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "incentiveRatePct" INTEGER;
