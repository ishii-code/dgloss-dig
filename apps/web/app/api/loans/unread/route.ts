import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { unreadCounts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  handle(async () => {
    const accountId = z.string().min(1).parse(req.nextUrl.searchParams.get("accountId") ?? "");
    return ok(await unreadCounts(accountId));
  });
