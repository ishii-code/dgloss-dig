import type { NextRequest } from "next/server";
import { MemberSchema } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listMembers, upsertMember } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listMembers()));

// メンバーマスタ編集（要件 F-2・Person ID は手入力）
const Body = MemberSchema.pick({
  personId: true,
  name: true,
  division: true,
  position: true,
  jobType: true,
  employmentType: true,
  basePay: true,
  positionBase: true,
  joinedOn: true,
  evaluationCycle: true,
  status: true,
}).extend({ actor: z.string().min(1).max(32) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const { actor, ...m } = Body.parse(await req.json());
    return created(await upsertMember({ ...m, actor }));
  });
