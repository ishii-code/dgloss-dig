import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { bulkUpdatePositionBase, listDivisions, listMembersByDivision } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 役職ベース入力画面用: 事業部で絞った在籍メンバーと事業部一覧。
export const GET = (req: NextRequest) =>
  handle(async () => {
    const division = req.nextUrl.searchParams.get("division") ?? undefined;
    const [members, divisions] = await Promise.all([
      listMembersByDivision(division || undefined),
      listDivisions(),
    ]);
    return ok({ members, divisions });
  });

// 役職・役職ベース・評価サイクルの一括保存。
const Body = z.object({
  actor: z.string().min(1).max(64),
  rows: z
    .array(
      z.object({
        personId: z.string().min(1).max(32),
        position: z.enum(["部長", "マネージャー", "リーダー", "メンバー"]).optional(),
        positionBase: z.number().min(0).max(100_000_000).optional(),
        evaluationCycle: z.enum(["四半期", "半期"]).optional(),
        salaryGrade: z.enum(["A", "B", "C", "D", "E", "F", "G"]).optional(),
        salaryRow: z.number().int().min(0).max(18).optional(),
      }),
    )
    .max(500),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await bulkUpdatePositionBase(b.rows, b.actor));
  });
