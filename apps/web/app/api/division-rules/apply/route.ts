import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { reapplyDivisionRules } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 保存済みルールを全在籍メンバーへ再適用（jinjer へは問い合わせないので高速）。
const Body = z.object({ actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    await requireAdmin();
    const b = Body.parse(await req.json());
    return ok(await reapplyDivisionRules(b.actor));
  });
