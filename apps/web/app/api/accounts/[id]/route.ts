import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/server/http";
import { deleteAccount } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const actor = z.string().min(1).parse(req.nextUrl.searchParams.get("actor") ?? "system");
    return ok(await deleteAccount(decodeURIComponent(id), actor));
  });
