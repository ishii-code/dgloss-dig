import type { NextRequest } from "next/server";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listDivisionRules, listTeamMappings, upsertDivisionRule } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 紐づけ画面用: ルール一覧＋jinjer所属（末端）別の人数。
export const GET = () =>
  handle(async () => {
    const [rules, teams] = await Promise.all([listDivisionRules(), listTeamMappings()]);
    return ok({ rules, teams });
  });

// ルールの追加/更新（pattern は jinjer 所属名の前方一致）。
const Body = z.object({
  pattern: z.string().min(1).max(200),
  division: z.string().min(1).max(100),
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    return created(await upsertDivisionRule(b.pattern.trim(), b.division.trim(), b.actor));
  });
