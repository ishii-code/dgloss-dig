import type { NextRequest } from "next/server";
import { z } from "zod";
import { error, handle, ok } from "@/server/http";
import { syncFromJinjer } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// jinjer（勤怠）から従業員マスタを自動同期（CRM事業部・管理本部は除外）
const Body = z.object({ actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    try {
      return ok(await syncFromJinjer(b.actor));
    } catch (e) {
      // jinjer連携の原因が分かるよう、エラー本文を返す（管理者操作・SUPER_ADMIN限定）
      return error(400, (e as Error).message);
    }
  });
