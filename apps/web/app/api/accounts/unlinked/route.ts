import { handle, ok } from "@/server/http";
import { listUnlinkedAccounts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 従業員マスタと紐付いていないアカウント（サインインしたが自動突合できなかった人）。
export const GET = () => handle(async () => ok(await listUnlinkedAccounts()));
