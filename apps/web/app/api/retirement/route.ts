import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listRetirementCandidates, settleRetirement } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Q14: 退社者と借入残高
export const GET = () => handle(async () => ok(await listRetirementCandidates()));

// Q14: グループ負担割合を登録（相殺）
const Body = z.object({
  personId: z.string().min(1).max(32),
  yearMonth: YearMonth,
  loanBalance: z.number().min(0),
  shares: z.array(z.object({ personId: z.string().min(1).max(32), amount: z.number().min(0) })).min(1),
  note: z.string().max(500).nullable().default(null),
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return created(await settleRetirement(b));
  });
