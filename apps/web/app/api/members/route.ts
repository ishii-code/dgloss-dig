import { handle, ok } from "@/server/http";
import { listMembers } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => handle(async () => ok(await listMembers()));
