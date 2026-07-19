import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { syncFromJinjer } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// jinjer（勤怠）から従業員マスタを自動同期（CRM事業部・管理本部は除外）
const Body = z.object({ actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await syncFromJinjer(b.actor));
  });
