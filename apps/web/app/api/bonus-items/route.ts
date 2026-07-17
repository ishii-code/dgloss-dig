import type { NextRequest } from "next/server";
import { BonusDigItemSchema } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listBonusItems, upsertBonusItem } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listBonusItems()));

const Body = BonusDigItemSchema.extend({ actor: z.string().min(1).max(32) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const { actor, ...item } = Body.parse(await req.json());
    return created(await upsertBonusItem({ ...item, actor }));
  });
