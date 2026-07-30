import NextAuth from "next-auth";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authConfig, authEnabled } from "./auth.config";

// Edge で動くため DB を触らない設定のみを読む（auth.config.ts）。
let guard: NextMiddleware | null = null;

/** 認証が有効なときだけ Auth.js のミドルウェアを組み立てる（未設定時は一切初期化しない）。 */
function authGuard(): NextMiddleware {
  if (!guard) {
    const { auth } = NextAuth(authConfig);
    guard = auth((req) => {
      if (req.auth?.user) return NextResponse.next();
      const url = new URL("/signin", req.nextUrl.origin);
      url.searchParams.set("from", req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }) as unknown as NextMiddleware;
  }
  return guard;
}

/**
 * 未サインインのアクセスを /signin へ送る。
 * 認証が未設定（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / AUTH_SECRET のいずれか欠け）の
 * 場合は素通りさせ、従来どおり認証なしで動作させる（本番を壊さない）。
 */
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  if (!authEnabled) return NextResponse.next();
  // Vercel Cron / 内部ジョブ（セッションを持たない）は CRON_SECRET で通す。
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }
  return authGuard()(req, ev);
}

export const config = {
  // 認証エンドポイント・サインイン画面・静的ファイル・ヘルスチェックは除外する。
  matcher: ["/((?!api/auth|api/health|signin|_next/static|_next/image|favicon.ico).*)"],
};
