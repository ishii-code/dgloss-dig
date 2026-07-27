import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle } from "@/server/http";
import { generateEvaluations } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 実運用: 対象月の評価台帳を在籍メンバーから生成（未作成分のみ・既存は保持）。
const Body = z.object({
  yearMonth: YearMonth,
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return created(await generateEvaluations(b.yearMonth, b.actor));
  });
