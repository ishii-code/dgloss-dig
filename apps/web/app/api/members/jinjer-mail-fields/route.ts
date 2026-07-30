import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { probeMailFields } from "@/server/jinjer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// jinjer 従業員APIにメール項目があるかの診断（アカウント発行の宛先に使えるか確認する）。
// 個人情報のため値は返さず、項目名・充足数・ドメインのみ返す。
export const POST = () =>
  handle(async () => {
    await requireSuperAdmin();
    return ok(await probeMailFields());
  });
