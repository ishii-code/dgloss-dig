import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import {
  autoAssignSalaryRanges,
  bulkUpdatePositionBase,
  listDivisions,
  listMembersByDivision,
  listSalaryRanges,
} from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 役職ベース入力画面用: 対象メンバー・事業部一覧・給与レンジ表（役職×A/B/C）。
export const GET = (req: NextRequest) =>
  handle(async () => {
    const division = req.nextUrl.searchParams.get("division") ?? undefined;
    const [members, divisions, ranges] = await Promise.all([
      listMembersByDivision(division || undefined),
      listDivisions(),
      listSalaryRanges(),
    ]);
    return ok({ members, divisions, ranges });
  });

// 役職・レンジ(A/B/C)・評価サイクルの一括保存、または給与からのレンジ自動判定。
const Body = z.union([
  z.object({
    actor: z.string().min(1).max(64),
    mode: z.literal("auto"),
    division: z.string().max(100).optional(),
  }),
  z.object({
    actor: z.string().min(1).max(64),
    mode: z.literal("save").optional(),
    rows: z
      .array(
        z.object({
          personId: z.string().min(1).max(32),
          position: z.enum(["部長", "マネージャー", "リーダー", "メンバー"]).optional(),
          positionBase: z.number().min(0).max(100_000_000).optional(),
          evaluationCycle: z.enum(["四半期", "半期"]).optional(),
          salaryGrade: z.enum(["A", "B", "C"]).optional(),
          /** 配下の合算方法（組織の長のとき） */
          aggregateMode: z.enum(["なし", "予算のみ", "予算と実績"]).optional(),
        }),
      )
      .max(500),
  }),
]);

export const POST = (req: NextRequest) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    if ("mode" in b && b.mode === "auto") {
      return ok(await autoAssignSalaryRanges(b.division, b.actor));
    }
    return ok(await bulkUpdatePositionBase(b.rows, b.actor));
  });
