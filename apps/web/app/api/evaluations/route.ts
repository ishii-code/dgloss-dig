import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { handle, ok } from "@/server/http";
import { listEvaluations } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  handle(async () => {
    const ym = YearMonth.parse(req.nextUrl.searchParams.get("ym") ?? "2026-01");
    return ok(await listEvaluations(ym));
  });
