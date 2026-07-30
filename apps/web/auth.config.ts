import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * 認証の共通設定（Edge でも読める部分のみ）。
 * DB アクセスを伴うコールバックは auth.ts 側に置く（middleware が Edge で動くため）。
 */
/**
 * 認証を有効にするか。AUTH_SECRET があればメール＋パスワードでログインできる。
 * 未設定の間は従来どおり認証なしで動作する（本番を壊さない）。
 */
export const authEnabled = Boolean(process.env.AUTH_SECRET);

/** Google サインインも併用するか（クライアントIDとシークレットが揃っているとき）。 */
export const googleEnabled = Boolean(
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
  // Google は任意。メール＋パスワード（Credentials）は auth.ts 側で足す
  // （DB を参照するため Edge の middleware には載せられない）。
  providers: googleEnabled
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
    // Google サインインは許可ドメイン以外を入れない。
    // メール＋パスワードは管理者が発行したアカウントのみなのでドメイン検証はしない。
    signIn({ account, profile, user }) {
      if (account?.provider !== "google") return true;
      return isAllowedEmail(profile?.email ?? user?.email ?? null);
    },
    // middleware から使う保護判定（Edge 実行・DB は触らない）。
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
