import type { NextRequest } from "next/server";
import { z } from "zod";
import { error, handle, ok } from "@/server/http";
import { enrichMembersPage, getDepartmentCounts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 1ページ分のみ処理するため短時間で完了するが、jinの遅延に備えて余裕を持たせる。
export const maxDuration = 60;

// jinjer の所属(部署)・基本給を 1ページずつ在籍メンバーへ反映する。
// クライアントが page を進めながら繰り返し呼ぶことでタイムアウトを回避する。
const Body = z.object({
  actor: z.string().min(1).max(64),
  kind: z.enum(["affiliations", "salaries"]),
  page: z.number().int().min(1).max(200),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    try {
      return ok(await enrichMembersPage(b.actor, b.kind, b.page));
    } catch (e) {
      return error(400, (e as Error).message);
    }
  });

// 反映結果の確認用：在籍メンバーの部署別人数。
export const GET = () => handle(async () => ok(await getDepartmentCounts()));
