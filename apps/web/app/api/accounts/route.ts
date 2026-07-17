import type { NextRequest } from "next/server";
import { AccountSchema } from "@dig/contracts";
import { z } from "zod";
import { created, handle, ok } from "@/server/http";
import { listAccounts, upsertAccount } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listAccounts()));

const Body = AccountSchema.extend({ actor: z.string().min(1).max(64) });

export const POST = (req: NextRequest) =>
  handle(async () => {
    const { actor, ...account } = Body.parse(await req.json());
    return created(await upsertAccount({ ...account, actor }));
  });
