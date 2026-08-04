import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { requireAdmin, requireSelfOrAdmin } from "@/server/guard";
import { createDigTransfer, listDigTransfers } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 譲渡の一覧。personId 指定なら本人が関係する分のみ、未指定は全件（ADMIN以上）。
export const GET = (req: NextRequest) =>
  handle(async () => {
    const personId = req.nextUrl.searchParams.get("personId") ?? "";
    if (personId) await requireSelfOrAdmin(personId);
    else await requireAdmin();
    return ok(await listDigTransfers(personId || undefined));
  });

const Body = z.object({
  yearMonth: YearMonth,
  tradedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 譲り手（成果Digが減る側） */
  payerId: z.string().min(1).max(32),
  /** 受け手（成果Digが増える側） */
  payeeId: z.string().min(1).max(32),
  amount: z.number().positive().max(1_000_000_000),
  description: z.string().min(1).max(128),
  note: z.string().max(256).nullable().default(null),
  actor: z.string().min(1).max(64),
});

// 譲渡の申請。自分が譲る場合のみ（ADMIN以上は代理申請可）。
export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    await requireSelfOrAdmin(b.payerId);
    return created(await createDigTransfer(b));
  });
