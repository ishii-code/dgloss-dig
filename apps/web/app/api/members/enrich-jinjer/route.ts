import type { NextRequest } from "next/server";
import { z } from "zod";
import { error, handle, ok } from "@/server/http";
import { enrichMembersFromJinjer } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 所属＋給与を取得して既存メンバーに反映するため実行時間を延長。
export const maxDuration = 120;

// jinjer の所属(部署)・基本給を既存の在籍メンバーに反映（基本同期とは分離）。
const Body = z.object({ actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    try {
      return ok(await enrichMembersFromJinjer(b.actor));
    } catch (e) {
      return error(400, (e as Error).message);
    }
  });
