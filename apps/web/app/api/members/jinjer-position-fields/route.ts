import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { probePositionFields } from "@/server/jinjer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// jinjer 従業員APIに役職の項目があるかの診断（紐付け表を作るための材料）。
export const POST = () =>
  handle(async () => {
    await requireSuperAdmin();
    return ok(await probePositionFields());
  });
