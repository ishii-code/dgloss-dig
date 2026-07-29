import type { NextRequest } from "next/server";
import { error, handle, ok } from "@/server/http";
import { deleteDivisionRule } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = async (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) =>
  handle(async () => {
    const { id } = await ctx.params;
    const ruleId = Number(id);
    if (!Number.isFinite(ruleId)) return error(400, "invalid id");
    const actor = req.nextUrl.searchParams.get("actor") ?? "system";
    return ok(await deleteDivisionRule(ruleId, actor));
  });
