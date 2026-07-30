import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { issueTemporaryPasswords } from "@/server/repo";

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
export const POST = (req: Request) =>
  handle(async () => {
    await requireAdmin();
    const body = Body.parse(await req.json());
    return ok(await issueTemporaryPasswords(body.ids, body.actor, body.resetExisting));
  });
