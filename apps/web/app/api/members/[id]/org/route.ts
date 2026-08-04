import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { setMemberOrgUnit } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  /** 所属させる組織。null で未所属に戻す */
  orgUnitId: z.number().int().positive().nullable(),
  actor: z.string().min(1).max(64),
});

// 全従業員一覧から組織を割り当てる。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const b = Body.parse(await req.json());
    return ok(await setMemberOrgUnit(decodeURIComponent(id), b.orgUnitId, b.actor));
  });
