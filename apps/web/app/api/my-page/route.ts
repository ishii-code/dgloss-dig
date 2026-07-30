import type { NextRequest } from "next/server";
import { error, handle, ok } from "@/server/http";
import { getMyPageData } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// マイページ: 本人（または ADMIN 以上が選択したメンバー）の実績・借入・ボーナス。
// months は四半期の各月をカンマ区切りで受け取る（例: 2026-06,2026-07,2026-08）。
export const GET = (req: NextRequest) =>
  handle(async () => {
    const sp = req.nextUrl.searchParams;
    const personId = sp.get("personId") ?? "";
    const months = (sp.get("months") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter((m) => /^\d{4}-\d{2}$/.test(m));
    if (!personId) return error(400, "personId が必要です");
    if (months.length === 0) return error(400, "months が必要です");
    return ok(await getMyPageData(personId, months));
  });
