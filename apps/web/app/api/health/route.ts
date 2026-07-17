import { NextResponse } from "next/server";
import { hasDatabase, prisma } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabase) return NextResponse.json({ ok: true, db: false });
  try {
    const members = await prisma.member.count();
    return NextResponse.json({ ok: true, db: true, members });
  } catch {
    return NextResponse.json({ ok: true, db: false });
  }
}
