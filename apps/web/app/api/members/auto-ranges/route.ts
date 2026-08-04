import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { autoAssignSalaryRanges } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  /** 指定なしなら全在籍メンバー */
  division: z.string().max(100).optional(),
  actor: z.string().min(1).max(64),
});

// 給与に最も近いレンジ(A/B/C)を自動判定し、役職ベースを設定する。
// 一覧で金額を手入力した人は対象外（上書きしない）。
export const POST = (req: Request) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    return ok(await autoAssignSalaryRanges(b.division, b.actor));
  });
