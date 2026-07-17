import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listSeikaPending, submitSeika } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Q13: 未承認（手入力）成果Dig一覧
export const GET = () => handle(async () => ok(await listSeikaPending()));

// Q13: 成果Digを手入力（例外）→ 未承認に
const Body = z.object({
  yearMonth: YearMonth,
  personId: z.string().min(1).max(32),
  seika: z.number().min(0),
  inputBy: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return created(await submitSeika(b.yearMonth, b.personId, b.seika, b.inputBy));
  });
