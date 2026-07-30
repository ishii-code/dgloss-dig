import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { restoreManualFields } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ actor: z.string().min(1).max(64) });

// 直近のスナップショット（jinjer同期の直前に自動保存）から手入力項目を復元する。
// 事業部・役職・レンジ・役職ベース・評価サイクル・グループ長 を巻き戻す。
export const POST = (req: NextRequest) =>
  handle(async () => {
    await requireAdmin();
    const { actor } = Body.parse(await req.json());
    return ok(await restoreManualFields(actor));
  });
