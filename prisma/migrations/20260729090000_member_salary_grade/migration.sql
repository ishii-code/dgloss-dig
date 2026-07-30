-- AlterTable: 給与テーブル上の位置（等級A〜G × 行）。役職ベースの算定元。
ALTER TABLE "Member" ADD COLUMN     "salaryGrade" TEXT;
ALTER TABLE "Member" ADD COLUMN     "salaryRow" INTEGER;
