import type { NextRequest } from "next/server";
import { z } from "zod";
import { error, handle, ok } from "@/server/http";
import { assertCanManageAccount, requireAdmin } from "@/server/guard";
import { listTargetDivisions, orgUnitWithDescendants, provisionMemberAccounts } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  actor: z.string().min(1).max(64),
  /**
   * 対象範囲。org=指定した組織（事業部/グループ）とその配下 /
   * target=評価対象事業部 / all=全在籍メンバー
   */
  scope: z.enum(["org", "target", "all"]).default("org"),
  /** scope=org のときの対象組織（事業部またはグループ） */
  orgUnitId: z.number().int().positive().optional(),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).default("USER"),
  /** true なら jinjer にメールが無い人は仮メールを作らずスキップする */
  requireRealEmail: z.boolean().default(false),
  /** true なら各自の仮パスワードを生成する（平文は応答でのみ返す） */
  issuePasswords: z.boolean().default(false),
  /** true なら既にパスワードがある人も再発行する */
  resetExisting: z.boolean().default(false),
});

// 在籍メンバーへアカウントを一括発行（既定は USER 権限・既存の権限は変更しない）。
export const POST = (req: NextRequest) =>
  handle(async () => {
    const viewer = await requireAdmin();
    const body = Body.parse(await req.json());
    // ADMIN はスーパーADMIN 権限のアカウントを一括発行できない。
    assertCanManageAccount(viewer, null, body.role);

    // 組織を指定した場合は、その組織と配下すべてのメンバーが対象。
    let orgUnitIds: number[] | undefined;
    if (body.scope === "org") {
      if (!body.orgUnitId) return error(400, "組織を選択してください");
      orgUnitIds = await orgUnitWithDescendants(body.orgUnitId);
    }
    const divisions = body.scope === "target" ? await listTargetDivisions() : undefined;

    return ok({
      scope: body.scope,
      orgUnitIds: orgUnitIds ?? null,
      divisions: divisions ?? null,
      ...(await provisionMemberAccounts({
        actor: body.actor,
        divisions,
        orgUnitIds,
        role: body.role,
        requireRealEmail: body.requireRealEmail,
        issuePasswords: body.issuePasswords,
        resetExisting: body.resetExisting,
      })),
    });
  });
