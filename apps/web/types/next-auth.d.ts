import type { DefaultSession } from "next-auth";

// セッションに載せる独自フィールド（権限・従業員ID・突合方法）。
declare module "next-auth" {
  interface Session {
    user: {
      role?: string;
      personId?: string | null;
      accountId?: string;
      matchedBy?: string;
      /** 仮パスワードのため変更が必要か */
      mustChangePassword?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    personId?: string | null;
    accountId?: string;
    matchedBy?: string;
    mustChangePassword?: boolean;
  }
}
