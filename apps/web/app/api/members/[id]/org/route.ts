import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { deleteMemberOrgHistory, listMemberOrgHistory, setMemberOrgUnit } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "2026-06" 形式の対象月。 */
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象月は YYYY-MM 形式で指定してください");

const Body = z.object({
  /** 所属させる組織。null で未所属に戻す */
  orgUnitId: z.number().int().positive().nullable(),
  /** この月から適用する。省略時は当月から */
  yearMonth: YearMonth.optional(),
  actor: z.string().min(1).max(64),
});

// 全従業員一覧から組織を割り当てる（対象月を指定するとその月からの所属になる）。
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const b = Body.parse(await req.json());
    return ok(await setMemberOrgUnit(decodeURIComponent(id), b.orgUnitId, b.actor, b.yearMonth));
  });

// その人の所属履歴（いつどのチームだったか）。
export const GET = (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    return ok(await listMemberOrgHistory(decodeURIComponent(id)));
  });

// 指定月の所属変更を取り消す（その月の行を消し、前月からの所属を引き継ぐ）。
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const from = YearMonth.parse(req.nextUrl.searchParams.get("yearMonth") ?? "");
    const actor = z.string().min(1).parse(req.nextUrl.searchParams.get("actor") ?? "system");
    return ok(await deleteMemberOrgHistory(decodeURIComponent(id), from, actor));
  });
