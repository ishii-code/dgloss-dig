import type { NextRequest } from "next/server";
import { AssignmentShare } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { updateAssignment } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  shares: z.array(AssignmentShare).min(1),
  actor: z.string().min(1).max(32),
});

export const PATCH = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const b = Body.parse(await req.json());
    return ok(await updateAssignment(id, b.shares, b.actor));
  });
