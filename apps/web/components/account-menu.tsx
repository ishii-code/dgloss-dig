"use client";

import { signOut } from "next-auth/react";

/**
 * ヘッダーのアカウント操作（パスワード変更・サインアウト）。
 * サインアウトは Auth.js の確認ページを挟まず、その場でセッションを破棄して
 * ログイン画面へ戻す。画面幅が狭くても必ず表示する。
 */
export function AccountMenu() {
  return (
    <span className="flex items-center gap-2">
      <a href="/change-password" className="font-semibold text-ink-muted hover:text-ink">
        パスワード変更
      </a>
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: "/signin" })}
        className="rounded-card border border-surface-border px-2 py-1 font-semibold text-brand-primary hover:bg-surface-panel"
      >
        サインアウト
      </button>
    </span>
  );
}
