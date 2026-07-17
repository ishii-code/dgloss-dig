import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { decideLoan } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  approve: z.boolean(),
  actor: z.string().min(1).max(32),
});

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const loanId = z.coerce.number().int().positive().parse(id);
    const body = Body.parse(await req.json());
    return ok(await decideLoan(loanId, body.approve, body.actor));
  });
