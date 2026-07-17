import type { NextRequest } from "next/server";
import { LoanApplicationSchema } from "@dig/contracts";
import { created, handle, ok } from "@/server/http";
import { createLoanApplication, listLoans } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listLoans()));

// 借入申請（会社=ディグロスバンク / 相対=メンバー間）
export const POST = (req: NextRequest) =>
  handle(async () => {
    const body = LoanApplicationSchema.parse(await req.json());
    return created(await createLoanApplication(body));
  });
