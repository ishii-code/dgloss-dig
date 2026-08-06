-- 途中解約（チャーン損失）のマイナスDigは CG と初回営業で折半する。
-- 既定を 0%（CGが全額負担）→ 50%（折半）へ変更する。
-- 運用で意図的に別の値へ変えている場合は触らない。
UPDATE "CalcRule" SET "salesSharePct" = 50
WHERE "ruleType" = 'チャーン損失' AND "salesSharePct" = 0;
