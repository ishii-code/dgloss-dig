-- AlterTable: jinjer の末端所属名を保持（紐づけ再適用の原本）
ALTER TABLE "Member" ADD COLUMN     "jinjerTeam" TEXT;

-- CreateTable: jinjer 所属名 → dgloss 事業部 の紐づけルール（前方一致）
CREATE TABLE "DivisionRule" (
    "id" SERIAL NOT NULL,
    "pattern" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DivisionRule_pattern_key" ON "DivisionRule"("pattern");

-- 初期ルール: AIテレアポ事業部（運用ヒアリング結果）
INSERT INTO "DivisionRule" ("pattern", "division", "updatedAt") VALUES
  ('ダイレクトセールス部セールスG', 'AIテレアポ事業部', CURRENT_TIMESTAMP),
  ('デリバリーISG', 'AIテレアポ事業部', CURRENT_TIMESTAMP),
  ('カスタマーグロース部', 'AIテレアポ事業部', CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO NOTHING;
