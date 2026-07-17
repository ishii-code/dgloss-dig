import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { setSurplusChoice } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Q3: 超過分を「持ち越し/インセン」から選択
const Body = z.object({
  yearMonth: YearMonth,
  personId: z.string().min(1).max(32),
  choice: z.enum(["incentive", "carryover"]),
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await setSurplusChoice(b.yearMonth, b.personId, b.choice, b.actor));
  });
