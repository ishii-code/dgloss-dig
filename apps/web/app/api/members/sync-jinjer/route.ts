import type { NextRequest } from "next/server";
import { z } from "zod";
import { error, handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { syncFromJinjer } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 従業員＋所属＋給与を各全ページ取得するため実行時間を延長。
export const maxDuration = 120;

// jinjer（勤怠）から従業員マスタを自動同期（CRM事業部・管理本部は除外）
const Body = z.object({ actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    try {
      return ok(await syncFromJinjer(b.actor));
    } catch (e) {
      // jinjer連携の原因が分かるよう、エラー本文を返す（管理者操作・SUPER_ADMIN限定）
      return error(400, (e as Error).message);
    }
  });
