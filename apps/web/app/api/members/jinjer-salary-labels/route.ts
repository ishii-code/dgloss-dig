import { handle, ok } from "@/server/http";
import { probeSalaryLabels } from "@/server/jinjer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// jinjer 給与単価の項目一覧（役職ベースに使える項目を特定する診断）。
export const POST = () => handle(async () => ok(await probeSalaryLabels()));
