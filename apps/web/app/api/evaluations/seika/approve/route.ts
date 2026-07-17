import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { approveSeika } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Q13: 手入力成果Digの承認（最終承認=スーパーADMIN）
const Body = z.object({
  yearMonth: YearMonth,
  personId: z.string().min(1).max(32),
  approver: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return ok(await approveSeika(b.yearMonth, b.personId, b.approver));
  });
