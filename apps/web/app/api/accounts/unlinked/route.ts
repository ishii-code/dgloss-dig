import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { listUnlinkedAccounts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 従業員マスタと紐付いていないアカウント（サインインしたが自動突合できなかった人）。
export const GET = () =>
  handle(async () => {
    await requireAdmin();
    return ok(await listUnlinkedAccounts());
  });
