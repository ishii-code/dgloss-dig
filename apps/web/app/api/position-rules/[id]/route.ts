import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { deletePositionRule } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const ruleId = z.coerce.number().int().positive().parse(id);
    const actor = req.nextUrl.searchParams.get("actor") ?? "system";
    return ok(await deletePositionRule(ruleId, actor));
  });
