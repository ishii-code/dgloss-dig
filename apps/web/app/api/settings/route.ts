import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { error, handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { getSetting, updateLoanDefaults, updateSetting } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  handle(async () => {
    const ym = YearMonth.parse(req.nextUrl.searchParams.get("ym") ?? "2026-01");
    const setting = await getSetting(ym);
    return setting ? ok(setting) : error(404, "設定が見つかりません");
  });

// 設定マスタ編集（要件 F-1）
const Body = z.object({
  yearMonth: YearMonth,
  budgetCoefficient: z.number().positive(),
  insuranceCoefficient: z.number().positive(),
  annualRatePct: z.number().min(0).max(100),
  initialLoanDefault: z.number().min(0),
  loanTermMonthsDefault: z.number().int().positive(),
  commonCostFulltime: z.number().min(0),
  commonCostParttime: z.number().min(0),
  actor: z.string().min(1).max(32),
});

export const PUT = (req: NextRequest) =>
  handle(async () => {
    await requireAdmin();
    const b = Body.parse(await req.json());
    return ok(await updateSetting(b));
  });

// 借入の既定値のみの部分更新（金融管理画面から）。
const LoanBody = z.object({
  yearMonth: YearMonth,
  initialLoanDefault: z.number().min(0).optional(),
  loanTermMonthsDefault: z.number().int().positive().max(600).optional(),
  actor: z.string().min(1).max(64),
});

export const PATCH = (req: NextRequest) =>
  handle(async () => {
    await requireAdmin();
    const b = LoanBody.parse(await req.json());
    return ok(await updateLoanDefaults(b));
  });
