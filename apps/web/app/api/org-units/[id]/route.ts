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
