import type { NextRequest } from "next/server";
import { DigApplicationSchema } from "@dig/contracts";
import { created, error, handle, ok } from "@/server/http";
import { requireAdmin, requireSelfOrAdmin } from "@/server/guard";
import { createDigApplication, listDigApplications } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dig申請の一覧。personId 指定なら本人（＋折半相手）分のみ、未指定は全件（承認キュー用）。
export const GET = (req: NextRequest) =>
  handle(async () => {
    const personId = req.nextUrl.searchParams.get("personId") ?? "";
    // 全件（承認キュー）は ADMIN 以上。本人分は本人でも参照できる。
    if (personId) await requireSelfOrAdmin(personId);
    else await requireAdmin();
    return ok(await listDigApplications(personId || undefined));
  });

// Dig申請の登録（マイページから）
export const POST = (req: NextRequest) =>
  handle(async () => {
    const body = DigApplicationSchema.parse(await req.json());
    // 他人の名義では申請できない（ADMIN 以上は代理申請可）。
    await requireSelfOrAdmin(body.applicantId);
    if (body.splitDig > body.grantedDig) {
      return error(400, "折半ポイントは獲得ポイント以下にしてください");
    }
    if (body.splitDig > 0 && !body.splitPartnerId) {
      return error(400, "折半ポイントがある場合は折半相手を選択してください");
    }
    return created(await createDigApplication(body));
  });
