import type { NextRequest } from "next/server";
import { LoanDecisionSchema } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { decideLoanApplication } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 承認/否決/差し戻し（コメント付き）
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const loanId = z.coerce.number().int().positive().parse(id);
    const d = LoanDecisionSchema.parse(await req.json());
    return ok(await decideLoanApplication(loanId, d));
  });
