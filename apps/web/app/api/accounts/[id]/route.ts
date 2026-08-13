import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { assertCanManageAccount, requireAdmin } from "@/server/guard";
import { accountRole, deleteAccount } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// アカウントの削除（ADMIN以上）。ADMIN はスーパーADMIN を削除できない。
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const viewer = await requireAdmin();
    const { id } = await ctx.params;
    const accountId = decodeURIComponent(id);
    assertCanManageAccount(viewer, await accountRole(accountId));
    const actor = z.string().min(1).parse(req.nextUrl.searchParams.get("actor") ?? "system");
    return ok(await deleteAccount(accountId, actor));
  });
