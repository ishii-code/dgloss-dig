# デプロイ手順（Vercel + Vercel Postgres / Neon）

Supabase 不要。**Vercel の DB（Vercel Postgres / Neon）**でそのままデプロイできます。
Prisma は任意の PostgreSQL で動くため、接続文字列を差し替えるだけです。

## 0. 前提
- モノレポ（pnpm workspace）。Next.js アプリは `apps/web`。
- Prisma datasource は 2系統:
  - `DATABASE_URL`（実行時・**プール接続**）
  - `DIRECT_URL`（マイグレーション・**非プール接続**）
- Prisma generator に `rhel-openssl-3.0.x` を同梱済み（Vercel Functions 対応）。

## 1. Vercel でプロジェクト作成
1. Vercel ダッシュボード → **Add New → Project** → このリポ（`ishii-code/dgloss-dig`）を import。
2. **Root Directory** = リポジトリ直下（`/`）のまま。`vercel.json` がビルドを定義しているので Framework は自動で Next.js。
   - Build Command / Install Command / Output は `vercel.json` の値が使われる（`apps/web/.next`）。

## 2. DB を作成して接続（Vercel Postgres / Neon）
1. Vercel → プロジェクト → **Storage → Create Database → Postgres**（Neon）を作成し、プロジェクトに **Connect**。
2. 連携すると以下の環境変数が自動注入される:
   - `POSTGRES_PRISMA_URL`（プール・`?pgbouncer=true` 付き）
   - `POSTGRES_URL_NON_POOLING`（非プール）
3. **Settings → Environment Variables** で、本アプリ用に割り当て（Production/Preview/Development すべて）:
   ```
   DATABASE_URL = <POSTGRES_PRISMA_URL の値>
   DIRECT_URL   = <POSTGRES_URL_NON_POOLING の値>
   ```
   ※ どちらも `NEXT_PUBLIC_` を付けない（サーバ専用）。

## 3. マイグレーション
`vercel.json` の buildCommand に `prisma migrate deploy` を含めているため、**デプロイ時に自動でマイグレーションが適用**されます（冪等・適用済みなら no-op）。
- 手動で流す場合（ローカルから本番DBへ）:
  ```bash
  DATABASE_URL="<pooled>" DIRECT_URL="<non-pooling>" pnpm db:deploy
  ```

## 4. 初期データ（seed・任意）
サンプルデータを入れる場合、ローカルから本番DBに対して:
```bash
DATABASE_URL="<pooled>" DIRECT_URL="<non-pooling>" pnpm db:seed
```
> 本番運用では seed は使わず、従業員マスタ等を画面から登録する運用に切り替える。

## 5. デプロイ
- `main` に push → Vercel が自動ビルド＆デプロイ。
- ビルドは `contracts → core → prisma generate → prisma migrate deploy → web build` の順。

## 6. 動作確認
- `https://<your-app>.vercel.app/api/health` → `{"ok":true,"db":true,"members":N}` なら DB 接続OK。
- 画面右上の権限セレクタは**デモ用**。本番は Supabase Auth ではなく **Vercel + 任意の認証**（後述）に置き換える。

## 7. 注意・既知の勘所
- **プール接続必須**: サーバレスは接続数が増えるため、実行時は必ずプール（`POSTGRES_PRISMA_URL`）を使う。`DATABASE_URL` にこれを割り当てる。
- **マイグレーションは非プール**: `DIRECT_URL` に `POSTGRES_URL_NON_POOLING` を割り当てる（PgBouncer 経由では migrate が失敗するため）。
- **binaryTargets**: `rhel-openssl-3.0.x` を同梱済み。未同梱だと本番で「Query engine not found」になる。
- **外部連携（SP_CRM / keiyaku）**: 別途 `SPCRM_/KEIYAKU_SUPABASE_*` を設定（未設定時はサンプルで動作）。

## 8. 認証（次段）
現状の権限はデモ（ロール切替）。本番は次のいずれかに置換:
- **NextAuth + Google**（社内ドメイン制限）→ ログインメール → `Account` の role を引く。
- Vercel のミドルウェアで保護 + アカウントマスタで権限判定。
