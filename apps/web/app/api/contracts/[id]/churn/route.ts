/**
 * 途中解約のマイナスDigを確定 / 取り消し。
 * PATCH  /api/contracts/:id/churn  { churnDig, note?, actor }
 * DELETE /api/contracts/:id/churn?actor=…   … 確定を取り消してアラートに戻す
 *
 * 確定するまでアラートが消えない運用のため、確定は管理者のみ。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { clearChurnDig, decideChurnDig } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  /** マイナスDig。正負どちらで来てもマイナスとして保存する */
  churnDig: z.number().finite(),
  note: z.string().max(500).nullable().optional(),
  actor: z.string().min(1).max(64),
});

export const PATCH = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const { actor, ...input } = Body.parse(await req.json());
    return ok(await decideChurnDig(decodeURIComponent(id), input, actor));
  });

export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const actor = req.nextUrl.searchParams.get("actor") ?? "system";
    return ok(await clearChurnDig(decodeURIComponent(id), actor));
  });
