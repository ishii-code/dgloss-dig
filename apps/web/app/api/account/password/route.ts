import { z } from "zod";
import { handle, ok } from "@/server/http";
import { ForbiddenError, viewer } from "@/server/guard";
import { changeOwnPassword } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

// 本人のパスワード変更。現在のパスワードの入力を必須にする（乗っ取り防止）。
export const POST = (req: Request) =>
  handle(async () => {
    const v = await viewer();
    if (!v) throw new ForbiddenError("ログインが必要です");
    const body = Body.parse(await req.json());
    return ok(await changeOwnPassword(v.email, body.currentPassword, body.newPassword));
  });
