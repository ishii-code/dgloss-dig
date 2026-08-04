import { z } from "zod";
import { handle, ok, created } from "@/server/http";
import { requireSuperAdmin } from "@/server/guard";
import { createOrgUnit, listOrgUnits } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 組織（事業部 > グループ > チーム）の一覧。
export const GET = () => handle(async () => ok(await listOrgUnits()));

const Body = z.object({
  name: z.string().min(1).max(100),
  level: z.enum(["事業部", "グループ", "チーム"]),
  parentId: z.number().int().positive().nullable().default(null),
  actor: z.string().min(1).max(64),
});

export const POST = (req: Request) =>
  handle(async () => {
    await requireSuperAdmin();
    const b = Body.parse(await req.json());
    return created(await createOrgUnit(b));
  });
