import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { decideDigApplication } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  approve: z.boolean(),
  actor: z.string().min(1).max(64),
  rejectReason: z.string().max(1000).nullable().default(null),
});

// Dig申請の承認／却下（ADMIN以上）。承認時は契約日の年月へ成果Digを加算する。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const appId = z.coerce.number().int().positive().parse(id);
    const body = Body.parse(await req.json());
    return ok(
      await decideDigApplication(appId, body.approve, body.actor, body.rejectReason ?? undefined),
    );
  });
