import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authEnabled } from "@/auth.config";
import type { Role } from "@dig/contracts";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic";

/**
 * トップページ。認証が有効なときはセッションから権限・従業員IDを取り出して
 * ダッシュボードへ渡す。未設定のときは従来どおり（ロール切替で確認できる状態）。
 */
export default async function Page() {
  if (!authEnabled) return <Dashboard />;
  const session = await auth();
  const u = session?.user;
  if (!u?.email) return <Dashboard />;
  // 仮パスワードのままなら先に変更させる。
  if (u.mustChangePassword) redirect("/change-password");
  return (
    <Dashboard
      signedIn={{
        id: u.email,
        name: u.name ?? u.email,
        personId: u.personId ?? null,
        role: (u.role as Role) ?? "USER",
      }}
    />
  );
}
