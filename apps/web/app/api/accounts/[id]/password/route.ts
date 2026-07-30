import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { issueTemporaryPassword } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ actor: z.string().min(1).max(64) });

// 仮パスワードの再発行（ADMIN以上）。平文はこの応答でのみ返す（DBはハッシュのみ）。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const { actor } = Body.parse(await req.json());
    return ok(await issueTemporaryPassword(decodeURIComponent(id), actor));
  });
