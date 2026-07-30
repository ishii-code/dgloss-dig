import { handle, ok } from "@/server/http";
import { listMembersForPicker } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// マイページのメンバー選択用（ADMIN 以上が他メンバーを閲覧する際に使用）。
export const GET = () => handle(async () => ok(await listMembersForPicker()));
