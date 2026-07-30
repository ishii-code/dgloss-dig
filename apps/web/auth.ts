import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { resolveSessionAccount } from "./server/repo";

/**
 * 認証本体（Node ランタイム）。DB を参照して権限（role）と従業員ID（personId）を
 * セッションへ載せる。middleware は Edge で動くため auth.config.ts のみを読む。
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // 初回サインイン時にアカウントを解決（無ければ作成）し、role/personId を JWT に保持する。
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email ?? "").toString().toLowerCase();
      if (!email) return token;
      // user がある = サインイン直後。以降は JWT のキャッシュを使う（毎回DBを叩かない）。
      if (user || !token.role) {
        try {
          const acc = await resolveSessionAccount(email, user?.name ?? (token.name as string) ?? null);
          token.name = acc.name;
          token.role = acc.role;
          token.personId = acc.personId;
          token.accountId = acc.id;
          token.matchedBy = acc.matchedBy;
        } catch {
          // 無効化アカウント等。権限は付与せず、画面側で案内する。
          token.role = undefined;
          token.personId = null;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = token.role as string | undefined;
      session.user.personId = (token.personId as string | null) ?? null;
      session.user.accountId = (token.accountId as string | undefined) ?? session.user.email ?? "";
      session.user.matchedBy = token.matchedBy as string | undefined;
      return session;
    },
  },
});
