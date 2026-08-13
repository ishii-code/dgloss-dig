import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { assertCanManageAccount, requireAdmin } from "@/server/guard";
import { accountRole, issueTemporaryPassword } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ actor: z.string().min(1).max(64) });

// 仮パスワードの再発行（ADMIN以上）。平文はこの応答でのみ返す（DBはハッシュのみ）。
// ADMIN はスーパーADMIN の仮パスワードを発行できない
// （発行できるとその人としてログインでき、権限の格上げになるため）。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const viewer = await requireAdmin();
    const { id } = await ctx.params;
    const accountId = decodeURIComponent(id);
    assertCanManageAccount(viewer, await accountRole(accountId));
    const { actor } = Body.parse(await req.json());
    return ok(await issueTemporaryPassword(accountId, actor));
  });
