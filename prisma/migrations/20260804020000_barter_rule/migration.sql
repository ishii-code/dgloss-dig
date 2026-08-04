-- バーター契約（相互発注）の獲得ルールを追加
ALTER TYPE "CalcRuleType" ADD VALUE IF NOT EXISTS 'バーター契約';
