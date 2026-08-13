import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { currentYearMonth, memberOrgMapAt } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// 指定月の personId → 所属組織。チーム構成は月ごとに変わるため、
// 画面はこれを引いて「その月の所属」を表示する。
export const GET = (req: NextRequest) =>
  handle(async () => {
    await requireAdmin();
    const ym = YearMonth.parse(req.nextUrl.searchParams.get("ym") ?? currentYearMonth());
    const map = await memberOrgMapAt(ym);
    return ok({ yearMonth: ym, orgUnitByPerson: Object.fromEntries(map) });
  });
