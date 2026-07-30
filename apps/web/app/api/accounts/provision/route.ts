import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { listTargetDivisions, provisionMemberAccounts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  actor: z.string().min(1).max(64),
  /** target=評価対象事業部のみ / all=全在籍メンバー */
  scope: z.enum(["target", "all"]).default("target"),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).default("USER"),
  /** true なら jinjer にメールが無い人は仮メールを作らずスキップする */
  requireRealEmail: z.boolean().default(false),
});

// 在籍メンバーへアカウントを一括発行（既定は USER 権限・既存の権限は変更しない）。
export const POST = (req: NextRequest) =>
  handle(async () => {
    const body = Body.parse(await req.json());
    const divisions = body.scope === "target" ? await listTargetDivisions() : undefined;
    return ok({
      scope: body.scope,
      divisions: divisions ?? null,
      ...(await provisionMemberAccounts({
        actor: body.actor,
        divisions,
        role: body.role,
        requireRealEmail: body.requireRealEmail,
      })),
    });
  });
