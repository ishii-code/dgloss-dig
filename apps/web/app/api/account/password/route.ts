import { z } from "zod";
import { handle, ok } from "@/server/http";
import { ForbiddenError, viewer } from "@/server/guard";
import { changeOwnPassword } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
  /**
   * 仮メールを実メールへ直す場合の新しいログインID。
   * 会社ドメインのみ許可し、重複していれば弾く（repo 側で検証）。
   */
  newEmail: z.string().max(254).nullable().optional(),
});

// 本人のパスワード（と必要ならログインID）の変更。
// 現在のパスワードの入力を必須にする（乗っ取り防止）。
export const POST = (req: Request) =>
  handle(async () => {
    const v = await viewer();
    if (!v) throw new ForbiddenError("ログインが必要です");
    const body = Body.parse(await req.json());
    return ok(
      await changeOwnPassword(v.email, body.currentPassword, body.newPassword, body.newEmail),
    );
  });
