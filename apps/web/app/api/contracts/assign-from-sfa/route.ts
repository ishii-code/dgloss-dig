import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { assignFromSfa } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ yearMonth: YearMonth, actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await assignFromSfa(b.yearMonth, b.actor));
  });
