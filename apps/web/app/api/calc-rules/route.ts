import type { NextRequest } from "next/server";
import { CalcRuleSchema } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listCalcRules, upsertCalcRule } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listCalcRules()));

const Body = CalcRuleSchema.extend({ actor: z.string().min(1).max(32) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const { actor, ...rule } = Body.parse(await req.json());
    return created(await upsertCalcRule(rule, actor));
  });
