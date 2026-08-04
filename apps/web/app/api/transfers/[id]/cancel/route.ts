import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { ForbiddenError, isAdmin, viewer } from "@/server/guard";
import { cancelDigTransfer, listDigTransfers } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ actor: z.string().min(1).max(64) });

// 申請の取り消し。譲り手本人（または ADMIN 以上）のみ。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const txnId = z.coerce.number().int().positive().parse(id);
    const b = Body.parse(await req.json());

    const v = await viewer();
    if (v && !isAdmin(v)) {
      const mine = await listDigTransfers(v.personId ?? "");
      const target = mine.find((t) => t.id === txnId);
      if (!target || target.payerId !== v.personId) {
        throw new ForbiddenError("譲る本人だけが取り消せます");
      }
    }
    return ok(await cancelDigTransfer(txnId, b.actor));
  });
