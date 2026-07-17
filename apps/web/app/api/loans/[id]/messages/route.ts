import type { NextRequest } from "next/server";
import { LoanMessageInput } from "@dig/contracts";
import { z } from "zod";
import { created, handle } from "@/server/http";
import { postLoanMessage } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const loanId = z.coerce.number().int().positive().parse(id);
    const b = LoanMessageInput.parse(await req.json());
    return created(await postLoanMessage(loanId, b.body, b.authorAccountId, b.authorName));
  });
