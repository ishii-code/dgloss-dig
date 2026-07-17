import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { createBonusRecord, listBonusItems, listBonusRecords } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  handle(async () => {
    const ym = YearMonth.parse(req.nextUrl.searchParams.get("ym") ?? "2026-01");
    const [items, records] = await Promise.all([listBonusItems(), listBonusRecords(ym)]);
    return ok({ items, records });
  });

const Body = z.object({
  yearMonth: YearMonth,
  recordedOn: z.string().date(),
  personId: z.string().min(1).max(32),
  itemId: z.string().min(1).max(16),
  grantedDig: z.number().min(0),
  note: z.string().max(256).nullable().default(null),
  actor: z.string().min(1).max(32),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return created(await createBonusRecord(b));
  });
