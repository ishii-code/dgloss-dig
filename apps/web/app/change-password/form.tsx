"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { apiSend } from "@/lib/api";

/**
 * パスワード変更フォーム。成功したらセッションの mustChangePassword を落として
 * ダッシュボードへ戻す（毎回この画面に戻されないようにする）。
 */
export function ChangePasswordForm({
  required,
  currentEmail,
  placeholderEmail,
  emailDomain,
}: {
  required: boolean;
  /** 現在のログインID */
  currentEmail: string;
  /** 会社メールが取れず従業員IDから生成した仮メールか */
  placeholderEmail: boolean;
  /** 許可する会社ドメイン */
  emailDomain: string;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  // 仮メールの人は実メールへ直してもらう（ログインIDなので変更後は入り直し）。
  const [email, setEmail] = useState(placeholderEmail ? "" : currentEmail);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirm) {
      setErr("新しいパスワードが一致しません");
      return;
    }
    const wanted = email.trim().toLowerCase();
    if (placeholderEmail && !wanted) {
      setErr("会社のメールアドレスを入力してください");
      return;
    }
    setBusy(true);
    try {
      const r = await apiSend<{ emailChanged: boolean; email: string }>(
        "/api/account/password",
        "POST",
        {
          currentPassword: current,
          newPassword: next,
          newEmail: wanted || null,
        },
      );
      // メール＝ログインIDなので、変えたらセッションが指す先が変わる。入り直してもらう。
      if (r.emailChanged) {
        await signOut({ redirect: false });
        router.push(`/signin?changed=1&email=${encodeURIComponent(r.email)}`);
        router.refresh();
        return;
      }
      await update({ passwordChanged: true });
      router.push("/");
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-muted">
          ログインID（会社のメールアドレス）
        </span>
        <input
          type="email"
          required={placeholderEmail}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`you@${emailDomain}`}
          className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-[11px] text-ink-faint">
          {placeholderEmail ? (
            <>
              現在のログインID <b>{currentEmail}</b> は仮のものです。
              会社のメールアドレス（@{emailDomain}）に変更してください。
              変更するとログインし直しになります。
            </>
          ) : (
            <>変更しない場合はそのままで構いません。変更するとログインし直しになります。</>
          )}
        </span>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-muted">
          現在のパスワード（仮パスワード）
        </span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-muted">新しいパスワード</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-[11px] text-ink-faint">
          8文字以上で、英字と数字をそれぞれ1文字以上含めてください。
        </span>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-muted">
          新しいパスワード（確認）
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-card border border-surface-border px-3 py-2 text-sm"
        />
      </label>

      {err && <div className="rounded-card bg-rose-50 px-3 py-2 text-xs text-semantic-danger">{err}</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-card bg-brand-primary px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "変更中…" : "変更する"}
        </button>
        {!required && (
          <a href="/" className="rounded-card border border-surface-border px-4 py-2 text-sm text-ink-muted">
            戻る
          </a>
        )}
      </div>
    </form>
  );
}
