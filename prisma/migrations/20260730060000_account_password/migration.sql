-- パスワードログイン（メールアドレス＋仮パスワード）用の項目を追加
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
