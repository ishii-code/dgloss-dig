import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { allowedDomains, authEnabled } from "@/auth.config";

export const dynamic = "force-dynamic";

/**
 * サインイン画面（Google・社内ドメイン限定）。
 * 認証が未設定のときはそのままダッシュボードへ戻す（従来どおり認証なしで使える）。
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  if (!authEnabled) redirect("/");
  const session = await auth();
  if (session?.user) redirect(from && from.startsWith("/") ? from : "/");

  const domains = allowedDomains().join(" / ");

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

        <h1 className="mt-6 text-lg font-bold text-ink">サインイン</h1>
        <p className="mt-1 text-sm text-ink-muted">
          社内アカウント（{domains}）の Google でサインインしてください。
          初回サインイン時に従業員マスタと自動で紐付け、マイページが表示されます。
        </p>

        {error && (
          <div className="mt-4 rounded-card bg-rose-50 px-3 py-2 text-xs text-semantic-danger">
            サインインできませんでした。社内アカウント（{domains}）でお試しください。
            それでも入れない場合は管理者へご連絡ください。
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: from && from.startsWith("/") ? from : "/" });
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="w-full rounded-card bg-brand-primary px-4 py-2.5 text-sm font-bold text-white"
          >
            Google でサインイン
          </button>
        </form>

        <p className="mt-4 text-[11px] text-ink-faint">
          ※ 会社メールが従業員マスタに登録されていない場合は氏名で突合します。
          同姓同名などで自動判定できないときは、管理者がアカウント管理画面で紐付けます。
        </p>
      </div>
    </main>
  );
}
