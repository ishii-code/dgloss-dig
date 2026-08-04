import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { listJinjerPositions, listPositionRules, upsertPositionRule } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// jinjer の役職名 → Dig評価の役職 の紐付け。候補として jinjer 側の役職名も返す。
export const GET = () =>
  handle(async () => {
    const [rules, jinjerPositions] = await Promise.all([listPositionRules(), listJinjerPositions()]);
    return ok({ rules, jinjerPositions });
  });

const Body = z.object({
  pattern: z.string().min(1).max(100),
  position: z.enum(["部長", "マネージャー", "リーダー", "メンバー"]),
  actor: z.string().min(1).max(64),
});

export const POST = (req: Request) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    return ok(await upsertPositionRule(b.pattern, b.position, b.actor));
  });
