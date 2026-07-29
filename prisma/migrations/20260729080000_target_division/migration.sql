-- CreateTable: Dig制度の対象事業部（ここに登録された事業部だけが評価対象）
CREATE TABLE "TargetDivision" (
    "division" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetDivision_pkey" PRIMARY KEY ("division")
);

-- 初期値: AIテレアポ事業部のみ
INSERT INTO "TargetDivision" ("division") VALUES ('AIテレアポ事業部')
ON CONFLICT ("division") DO NOTHING;
