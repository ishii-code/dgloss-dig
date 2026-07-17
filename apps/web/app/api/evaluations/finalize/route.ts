import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { finalizeMonth } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 期末確定（Q8）: 評価を凍結しインセン・昇降級を確定
const Body = z.object({ yearMonth: YearMonth, actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await finalizeMonth(b.yearMonth, b.actor));
  });
