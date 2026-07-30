import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * 認証の共通設定（Edge でも読める部分のみ）。
 * DB アクセスを伴うコールバックは auth.ts 側に置く（middleware が Edge で動くため）。
 *
 * env-gated: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / AUTH_SECRET が揃ったときだけ
 * 認証を有効にする。未設定の間は従来どおり認証なしで動作する（本番を壊さない）。
 */
export const authEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET,
);

/** ログインを許可するメールドメイン（カンマ区切り）。既定は dgloss.co.jp。 */
export function allowedDomains(): string[] {
  const raw = process.env.CG_AUTH_ALLOWED_DOMAINS ?? "dgloss.co.jp";
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** メールが許可ドメインかどうか（ドメイン未設定なら全許可＝ローカル検証用）。 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  const domains = allowedDomains();
  if (domains.length === 0) return true;
  const domain = (email ?? "").split("@")[1]?.toLowerCase() ?? "";
  return domains.includes(domain);
}

export const authConfig = {
  // 認証未設定のときは provider 無し（＝サインイン不可・middleware も素通り）。
  providers: authEnabled
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          // 社内アカウントを既定で選ばせる（hd はヒントであり検証は signIn 側で行う）。
          authorization: { params: { hd: allowedDomains()[0], prompt: "select_account" } },
        }),
      ]
    : [],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    // 許可ドメイン以外は入れない。
    signIn({ profile, user }) {
      const email = profile?.email ?? user?.email ?? null;
      return isAllowedEmail(email);
    },
    // middleware から使う保護判定（Edge 実行・DB は触らない）。
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
