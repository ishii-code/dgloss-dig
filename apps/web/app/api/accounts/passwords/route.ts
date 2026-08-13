import { z } from "zod";
import { handle, ok } from "@/server/http";
import { assertCanManageAccount, isSuperAdmin, requireAdmin } from "@/server/guard";
import { accountRoles, issueTemporaryPasswords } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 1リクエストの上限。パスワードのハッシュ化は意図的に重い処理のため、
// 画面側で分割して呼び出す（全件を一度に処理すると実行時間制限に当たる）。
const MAX_PER_REQUEST = 25;

const Body = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_PER_REQUEST),
  actor: z.string().min(1).max(64),
  /** true なら既にパスワードがある人も再発行する */
  resetExisting: z.boolean().default(false),
});

// 指定したアカウントへ仮パスワードを発行（ADMIN以上）。平文はこの応答でのみ返す。
// ADMIN が実行した場合、対象にスーパーADMIN が含まれていると 403 で止める
// （画面は表示中の全員を一括で送るため、混ざっていたら全体を弾いて気付かせる）。
export const POST = (req: Request) =>
  handle(async () => {
    const viewer = await requireAdmin();
    const body = Body.parse(await req.json());
    if (!isSuperAdmin(viewer) && viewer !== null) {
      const roles = await accountRoles(body.ids);
      for (const id of body.ids) assertCanManageAccount(viewer, roles.get(id) ?? null);
    }
    return ok(await issueTemporaryPasswords(body.ids, body.actor, body.resetExisting));
  });
