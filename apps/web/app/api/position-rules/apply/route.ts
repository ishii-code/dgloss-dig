import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { applyPositionRules } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ actor: z.string().min(1).max(64) });

// 紐付けを全在籍メンバーへ適用（手入力した人は上書きしない）。
export const POST = (req: Request) =>
  handle(async () => {
    await requireSuperAdmin();
    const { actor } = Body.parse(await req.json());
    return ok(await applyPositionRules(actor));
  });
