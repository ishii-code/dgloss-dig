import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { updateAnnualRate } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  yearMonth: YearMonth,
  annualRatePct: z.number().min(0).max(100),
  actor: z.string().min(1).max(32),
});

export const PATCH = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await updateAnnualRate(b.yearMonth, b.annualRatePct, b.actor));
  });
