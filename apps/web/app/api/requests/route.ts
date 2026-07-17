import type { NextRequest } from "next/server";
import { FeatureRequestSchema } from "@dig/contracts";
import { created, handle, ok } from "@/server/http";
import { createFeatureRequest, listFeatureRequests } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listFeatureRequests()));

export const POST = (req: NextRequest) =>
  handle(async () => {
    const b = FeatureRequestSchema.parse(await req.json());
    return created(await createFeatureRequest(b));
  });
