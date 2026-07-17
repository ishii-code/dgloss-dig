import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { getLoanThread, markThreadRead } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const loanId = z.coerce.number().int().positive().parse(id);
    // 開いたら既読化
    const accountId = req.nextUrl.searchParams.get("accountId");
    if (accountId) await markThreadRead(loanId, accountId);
    return ok(await getLoanThread(loanId));
  });
