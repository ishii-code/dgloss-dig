import { handle, ok } from "@/server/http";
import { previewDivisionMapping } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 部署ツリーの正規化プレビュー（末端所属 → 事業部 の対応を確認する診断）。
export const POST = () => handle(async () => ok(await previewDivisionMapping()));
