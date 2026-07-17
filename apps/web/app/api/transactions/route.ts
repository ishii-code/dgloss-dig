import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { createTransaction, listTransactions } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  handle(async () => {
    const ym = YearMonth.parse(req.nextUrl.searchParams.get("ym") ?? "2026-01");
    return ok(await listTransactions(ym));
  });

const Body = z
  .object({
    yearMonth: YearMonth,
    tradedOn: z.string().date(),
    payerId: z.string().min(1).max(32),
    payeeId: z.string().min(1).max(32),
    amount: z.number().positive(),
    description: z.string().min(1).max(128),
    note: z.string().max(256).nullable().default(null),
    actor: z.string().min(1).max(32),
  })
  .refine((v) => v.payerId !== v.payeeId, {
    message: "自己送金はできません",
    path: ["payeeId"],
  });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return created(await createTransaction(b));
  });
