import type { NextRequest } from "next/server";
import { YearMonth } from "@dig/contracts";
import { z } from "zod";
import { created, handle } from "@/server/http";
import { ensureInitialLoans, generateEvaluations, pruneEvaluationsOutOfScope } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 実運用: 対象月の評価台帳を生成／再計算する。
// 対象事業部（TargetDivision）に限定し、対象外の未確定行は削除して整合させる。
const Body = z.object({
  yearMonth: YearMonth,
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    const pruned = await pruneEvaluationsOutOfScope(b.yearMonth, b.actor);
    // 入社時の必須初回借入（自動承認）を未作成のメンバーに作成してから台帳を計算する。
    const loans = await ensureInitialLoans(b.actor);
    const result = await generateEvaluations(b.yearMonth, b.actor);
    return created({
      ...result,
      pruned: pruned.deleted,
      initialLoansCreated: loans.created,
      initialLoansRemoved: loans.removed,
    });
  });
