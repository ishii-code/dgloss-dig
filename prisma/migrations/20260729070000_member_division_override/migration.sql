-- AlterTable: メンバー個別の事業部指定（同期・ルール適用より優先）
ALTER TABLE "Member" ADD COLUMN     "divisionOverride" TEXT;
