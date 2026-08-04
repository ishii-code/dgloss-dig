import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { ForbiddenError, isAdmin, viewer } from "@/server/guard";
import { decideDigTransfer, listDigTransfers } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  approve: z.boolean(),
  actor: z.string().min(1).max(64),
  rejectReason: z.string().max(1000).nullable().default(null),
});

// 譲渡の承認／却下。受け手本人（または ADMIN 以上）だけが判定できる。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const txnId = z.coerce.number().int().positive().parse(id);
    const b = Body.parse(await req.json());

    const v = await viewer();
    if (v && !isAdmin(v)) {
      // 受け手本人かを確認する（他人宛の譲渡を承認できないようにする）。
      const mine = await listDigTransfers(v.personId ?? "");
      const target = mine.find((t) => t.id === txnId);
      if (!target || target.payeeId !== v.personId) {
        throw new ForbiddenError("受け取る本人だけが承認できます");
      }
    }
    return ok(await decideDigTransfer(txnId, b.approve, b.actor, b.rejectReason ?? undefined));
  });
