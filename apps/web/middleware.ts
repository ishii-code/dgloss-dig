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
 * Basic 認証（暫定ゲート）。BASIC_AUTH_USER と BASIC_AUTH_PASSWORD の両方が
 * 設定されているときだけ有効。Google 認証を用意するまでの間、URL を知っただけの
 * 第三者がアクセスできる状態を防ぐために使う。
 */
function basicAuthPassed(req: NextRequest): boolean | null {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return null; // 未設定＝このゲートは使わない

  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    return decoded.slice(0, idx) === user && decoded.slice(idx + 1) === password;
  } catch {
    return false;
  }
}

/**
 * アクセス制御。優先順位は次のとおり。
 *   1. Vercel Cron / 内部ジョブ（CRON_SECRET）は通す
 *   2. Google 認証が有効なら、未サインインは /signin へ
 *   3. 無効でも Basic 認証が設定されていれば、それで保護する（暫定ゲート）
 *   4. どちらも未設定なら素通り（＝誰でもアクセスできる状態）
 */
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  // Vercel Cron / 内部ジョブ（セッションを持たない）は CRON_SECRET で通す。
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  if (authEnabled) return authGuard()(req, ev);

  const basic = basicAuthPassed(req);
  if (basic === null) return NextResponse.next(); // どちらも未設定
  if (basic) return NextResponse.next();
  // ヘッダ値は ByteString（latin1）のみ許可されるため realm は ASCII にする。
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="dgloss Dig", charset="UTF-8"' },
  });
}

export const config = {
  // 認証エンドポイント・サインイン画面・静的ファイル・ヘルスチェックは除外する。
  matcher: ["/((?!api/auth|api/health|signin|_next/static|_next/image|favicon.ico).*)"],
};
