import type { NextRequest } from "next/server";
import { RequestStatus } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { updateRequestStatus } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ status: RequestStatus, actor: z.string().min(1).max(64) });

export const PATCH = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const rid = z.coerce.number().int().positive().parse(id);
    const b = Body.parse(await req.json());
    return ok(await updateRequestStatus(rid, b.status, b.actor));
  });
