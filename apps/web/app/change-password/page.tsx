import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authEnabled } from "@/auth.config";
import { ChangePasswordForm } from "./form";

export const dynamic = "force-dynamic";

/** パスワード変更画面。仮パスワードでログインした直後はここへ誘導される。 */
export default async function ChangePasswordPage() {
  if (!authEnabled) redirect("/");
  const session = await auth();
  if (!session?.user?.email) redirect("/signin?from=%2Fchange-password");

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-panel p-6">
      <div className="w-full max-w-md rounded-card border border-surface-border bg-white p-8 shadow-card">
        <div className="flex items-center gap-2">
          <span className="bg-gradient-to-br from-brand-primary to-brand-accent bg-clip-text text-xl font-bold text-transparent">
            dgloss
          </span>
          <span className="text-ink-faint">/</span>
          <span className="text-[15px] font-bold text-ink">Dig評価</span>
        </div>

        <h1 className="mt-6 text-lg font-bold text-ink">パスワードの変更</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {session.user.mustChangePassword
            ? "仮パスワードのままです。ご自身のパスワードに変更してください。"
            : "パスワードを変更します。"}
        </p>
        <p className="mt-1 text-xs text-ink-faint">{session.user.email}</p>

        <ChangePasswordForm required={Boolean(session.user.mustChangePassword)} />
      </div>
    </main>
  );
}
