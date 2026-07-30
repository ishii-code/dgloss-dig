import type { NextRequest } from "next/server";
import { error, handle, ok } from "@/server/http";
import { lookupContractsByCompany } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 顧客ID（または契約ID・契約番号）から契約管理DBの契約を引く。Dig申請フォームの自動記載用。
export const GET = (req: NextRequest) =>
  handle(async () => {
    const companyId = (req.nextUrl.searchParams.get("companyId") ?? "").trim();
    if (!companyId) return error(400, "顧客IDを入力してください");
    return ok(await lookupContractsByCompany(companyId));
  });
