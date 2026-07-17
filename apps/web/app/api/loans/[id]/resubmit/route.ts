import type { NextRequest } from "next/server";
import { LoanMessageInput } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { resubmitLoan } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 差し戻し後の再申請
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const loanId = z.coerce.number().int().positive().parse(id);
    const b = LoanMessageInput.parse(await req.json());
    return ok(await resubmitLoan(loanId, b.authorAccountId, b.authorName, b.body));
  });
