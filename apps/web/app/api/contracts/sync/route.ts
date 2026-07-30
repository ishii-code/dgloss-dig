/**
 * 契約管理DB（keiyaku-kanri-next の VIEW cg_customer_master）→ Dig評価の契約キャッシュ同期。
 * POST /api/contracts/sync … 画面/内部からの手動トリガー
 * GET  /api/contracts/sync … Vercel Cron 用（GET でスケジュール起動される）
 *
 * READ-ONLY：契約管理DBは SELECT のみで書き込まない（CG-CRM と同一方式）。
 * env-gated：CONTRACT_DB_URL 未設定なら { skipped } を 200 で返す（pg 接続もしない）。
 */
import { error, handle, ok } from "@/server/http";
import { isContractDbConfigured, syncContractsFromContractDb } from "@/server/contract-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run() {
  return handle(async () => {
    if (!isContractDbConfigured()) {
      return ok({ skipped: "CONTRACT_DB_URL が未設定のため契約管理DBへ接続していません" });
    }
    try {
      return ok(await syncContractsFromContractDb());
    } catch (e) {
      // 接続URL・スタックはレスポンスに含めない（サーバログのみ）。
      console.error("[contracts/sync] failed:", e);
      return error(502, "契約管理DBの同期に失敗しました");
    }
  });
}

export const POST = () => run();
export const GET = () => run();
