import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { allowedDomains, authEnabled, googleEnabled } from "@/auth.config";

export const dynamic = "force-dynamic";

/**
 * サインイン画面。メールアドレス＋パスワード（管理者が発行した仮パスワード）でログインする。
 * Google が設定されている場合はそちらも選べる。
 * 認証が未設定のときはそのままダッシュボードへ戻す（従来どおり認証なしで使える）。
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string; changed?: string; email?: string }>;
}) {
  const { from, error, changed, email } = await searchParams;
  if (!authEnabled) redirect("/");
  const session = await auth();
  if (session?.user) redirect(from && from.startsWith("/") ? from : "/");

  const to = from && from.startsWith("/") ? from : "/";

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

        <h1 className="mt-6 text-lg font-bold text-ink">ログイン</h1>
        <p className="mt-1 text-sm text-ink-muted">
          会社のメールアドレスと、管理者から配布されたパスワードを入力してください。
        </p>

        {changed === "1" && (
          <div className="mt-4 rounded-card bg-emerald-50 px-3 py-2 text-xs text-semantic-success">
            ログインIDとパスワードを変更しました。
            {email && (
              <>
                {" "}新しいログインIDは <b className="break-all">{email}</b> です。
              </>
            )}
            {" "}新しいパスワードでログインしてください。
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-card bg-rose-50 px-3 py-2 text-xs text-semantic-danger">
            メールアドレスまたはパスワードが違います。
            パスワードが分からない場合は管理者に再発行を依頼してください。
          </div>
        )}

        <form
          action={async (formData: FormData) => {
            "use server";
            try {
              await signIn("password", {
                email: String(formData.get("email") ?? ""),
                password: String(formData.get("password") ?? ""),
                redirectTo: to,
              });
            } catch (e) {
              // 認証失敗はエラー表示付きで同じ画面へ戻す（redirect の例外はそのまま投げる）。
              if (e instanceof AuthError) {
                redirect(`/signin?error=1&from=${encodeURIComponent(to)}`);
              }
              throw e;
            }
          }}
          className="mt-6 space-y-3"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">メールアドレス</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@dgloss.co.jp"
              className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">パスワード</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-card bg-brand-primary px-4 py-2.5 text-sm font-bold text-white"
          >
            ログイン
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="my-5 flex items-center gap-3 text-[11px] text-ink-faint">
              <span className="h-px flex-1 bg-surface-border" />
              または
              <span className="h-px flex-1 bg-surface-border" />
            </div>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: to });
              }}
            >
              <button
                type="submit"
                className="w-full rounded-card border border-surface-border px-4 py-2.5 text-sm font-bold text-ink"
              >
                Google でサインイン（{allowedDomains().join(" / ")}）
              </button>
            </form>
          </>
        )}

        <p className="mt-5 text-[11px] text-ink-faint">
          ※ 初回は配布された仮パスワードでログインし、その後パスワードの変更を求められます。
        </p>
      </div>
    </main>
  );
}
