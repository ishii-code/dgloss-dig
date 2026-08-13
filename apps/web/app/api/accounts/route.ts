import type { NextRequest } from "next/server";
import { AccountSchema } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { assertCanManageAccount, requireAdmin } from "@/server/guard";
import { accountRole, listAccounts, upsertAccount } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listAccounts()));

const Body = AccountSchema.extend({ actor: z.string().min(1).max(64) });

// アカウントの登録・更新（ADMIN以上）。
// ADMIN はスーパーADMIN を作れず、既存のスーパーADMIN も変更できない。
export const POST = (req: NextRequest) =>
  handle(async () => {
    const viewer = await requireAdmin();
    const { actor, ...account } = Body.parse(await req.json());
    assertCanManageAccount(viewer, await accountRole(account.id), account.role);
    return created(await upsertAccount({ ...account, actor }));
  });
