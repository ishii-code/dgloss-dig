/**
 * 途中解約（チャーン）アラート。
 * GET  /api/contracts/churn            … 未処理のみ（既定）
 * GET  /api/contracts/churn?all=1      … 確定済みも含めて全件
 *
 * 途中解約フラグは契約管理DBを正とし、日次同期（/api/contracts/sync）で取り込む。
 * 管理者がマイナスDigを確定するまで、未処理として出し続ける。
 */
import type { NextRequest } from "next/server";
import { handle, ok } from "@/server/http";
import { requireSignedIn } from "@/server/guard";
import { listChurnAlerts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  handle(async () => {
    await requireSignedIn();
    const all = req.nextUrl.searchParams.get("all") === "1";
    return ok(await listChurnAlerts(!all));
  });
