"use client";

import { SessionProvider } from "next-auth/react";

/** クライアント側でセッションを参照するためのプロバイダ（パスワード変更後の更新に使う）。 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
