import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { deleteOrgUnit, updateOrgUnit } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(100).optional(),
  /** 組織の長（配下の予算Digを合算する対象）。空文字で解除 */
  leaderId: z.string().max(32).nullable().optional(),
  /** Dig評価の対象にするか（配下は自動的に対象） */
  isTarget: z.boolean().optional(),
  active: z.boolean().optional(),
  /** インセンティブ還元率(%)。null で解除（上位組織→既定20%に従う） */
  incentiveRatePct: z.number().int().min(0).max(100).nullable().optional(),
  // 事業部別の Dig予算設定。いずれも null を渡すと「上位を継承」に戻る。
  /** 予算係数（予算Dig = 総コスト × 係数） */
  budgetCoefficient: z.number().min(0).max(100).nullable().optional(),
  /** 社会保険係数 */
  insuranceCoefficient: z.number().min(0).max(10).nullable().optional(),
  /** 座席代（正社員・月額） */
  commonCostFulltime: z.number().min(0).max(100_000_000).nullable().optional(),
  /** 座席代（アルバイト・月額） */
  commonCostParttime: z.number().min(0).max(100_000_000).nullable().optional(),
  /** 昇降級しきい値（達成率）。1.2 = 120% */
  promotionUpTwo: z.number().min(0).max(100).nullable().optional(),
  promotionUpOne: z.number().min(0).max(100).nullable().optional(),
  promotionDownOne: z.number().min(0).max(100).nullable().optional(),
  promotionDownTwo: z.number().min(0).max(100).nullable().optional(),
  actor: z.string().min(1).max(64),
});

export const PATCH = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const unitId = z.coerce.number().int().positive().parse(id);
    const { actor, ...patch } = Body.parse(await req.json());
    return ok(await updateOrgUnit(unitId, patch, actor));
  });

export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const unitId = z.coerce.number().int().positive().parse(id);
    const actor = req.nextUrl.searchParams.get("actor") ?? "system";
    return ok(await deleteOrgUnit(unitId, actor));
  });
