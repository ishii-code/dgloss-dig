-- Member に会社メールを追加（jinjer 由来・アカウント発行の宛先に使用）
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "email" TEXT;
