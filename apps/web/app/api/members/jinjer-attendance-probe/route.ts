import { z } from "zod";
import { YearMonth } from "@dig/contracts";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { probeAttendance } from "@/server/jinjer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ yearMonth: YearMonth });

// 打刻実績のエンドポイント探索（どのパス・項目名で労働時間が取れるかの確認）。
export const POST = (req: Request) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    return ok(await probeAttendance(b.yearMonth));
  });
