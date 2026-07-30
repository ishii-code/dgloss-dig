import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { requireAdmin } from "@/server/guard";
import { listDivisions, listTargetDivisions, setTargetDivisions } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dig制度の対象事業部（登録された事業部のメンバーだけが評価対象）。
export const GET = () =>
  handle(async () => {
    const [targets, all] = await Promise.all([listTargetDivisions(), listDivisions()]);
    return ok({ targets, all });
  });

const Body = z.object({
  divisions: z.array(z.string().min(1).max(100)).max(50),
  actor: z.string().min(1).max(64),
});

export const POST = (req: NextRequest) =>
  handle(async () => {
    await requireAdmin();
    const b = Body.parse(await req.json());
    return ok(await setTargetDivisions(b.divisions, b.actor));
  });
