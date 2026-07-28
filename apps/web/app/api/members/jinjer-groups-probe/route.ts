import { handle, ok } from "@/server/http";
import { probeJinjerOrg } from "@/server/jinjer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// jinjer の組織/部署エンドポイントを探索する診断（部署ソース特定用）。
export const POST = () => handle(async () => ok(await probeJinjerOrg()));
