import { z } from "zod";
import { YearMonth } from "@dig/contracts";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { syncWorkHours } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ yearMonth: YearMonth, actor: z.string().min(1).max(64) });

// 対象月の実労働時間を jinjer の打刻実績から取り込む（アルバイトの予算Dig算定に使う）。
export const POST = (req: Request) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    return ok(await syncWorkHours(b.yearMonth, b.actor));
  });
