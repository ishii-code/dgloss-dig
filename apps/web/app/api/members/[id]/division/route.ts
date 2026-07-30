import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { setMemberDivision } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// メンバー個別の事業部指定（同期・ルール適用より優先）。空文字で解除。
const Body = z.object({
  division: z.string().max(100),
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const b = Body.parse(await req.json());
    return ok(await setMemberDivision(id, b.division, b.actor));
  });
