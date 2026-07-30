import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { resolveSessionAccount, verifyCredentials } from "./server/repo";

/**
 * 認証本体（Node ランタイム）。DB を参照して権限（role）と従業員ID（personId）を
 * セッションへ載せる。middleware は Edge で動くため auth.config.ts のみを読む。
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    // メールアドレス＋パスワード。管理者が発行した仮パスワードで初回ログインし、
    // その後に本人がパスワードを変更する（mustChangePassword）。
    Credentials({
      id: "password",
      name: "メールアドレスとパスワード",
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(raw) {
        const email = typeof raw?.email === "string" ? raw.email : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        if (!email || !password) return null;
        const acc = await verifyCredentials(email, password);
        if (!acc) return null;
        return {
          id: acc.id,
          email: acc.email,
          name: acc.name,
          role: acc.role,
          personId: acc.personId,
          mustChangePassword: acc.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // 初回サインイン時にアカウントを解決（無ければ作成）し、role/personId を JWT に保持する。
    async jwt({ token, user, account, trigger, session }) {
      const email = (user?.email ?? token.email ?? "").toString().toLowerCase();
      if (!email) return token;

      // パスワード変更後に mustChangePassword を落とす（クライアントの update() から）。
      if (trigger === "update" && (session as { passwordChanged?: boolean })?.passwordChanged) {
        token.mustChangePassword = false;
        return token;
      }

      // メール＋パスワードは authorize() で検証済み。DB を再解決しない
      // （アカウントの自動作成は Google サインインのときだけ行う）。
      if (account?.provider === "password" && user) {
        const u = user as { role?: string; personId?: string | null; mustChangePassword?: boolean };
        token.name = user.name ?? token.name;
        token.role = u.role;
        token.personId = u.personId ?? null;
        token.accountId = email;
        token.matchedBy = "account";
        token.mustChangePassword = Boolean(u.mustChangePassword);
        return token;
      }

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
      session.user.mustChangePassword = Boolean(token.mustChangePassword);
      return session;
    },
  },
});
