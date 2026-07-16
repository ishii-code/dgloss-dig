# dgloss-dig

Dig制度（社内通貨による営業評価制度）のシステム化リポジトリ。

dgloss OS v2.0 の評価レイヤー（画面20「Dig評価システム」）に相当。現行の Excel 運用（`dig_v5.xlsx`）をシステム化する。

## 構成（contract-first / pnpm monorepo）

```
packages/contracts  @dig/contracts  型・zodスキーマ・enum（source of truth）
packages/core       @dig/core       計算エンジン（純関数）+ Vitest（Excel回帰）
apps/web            @dig/web         Next.js(App Router) ダッシュボード
prisma/             schema.prisma    Supabase(PostgreSQL) データモデル
```

## セットアップ

```bash
pnpm install
pnpm --filter @dig/contracts build   # 契約をビルド
pnpm --filter @dig/core test         # 計算エンジンのテスト（Excel回帰・30 green）
pnpm --filter @dig/web dev           # ダッシュボード（http://localhost:3007）
```

技術スタック: TypeScript / Node 22 / pnpm / Next.js App Router / Tailwind / Supabase(PostgreSQL)+Prisma / zod / Vitest（dgloss `TECH_STACK.md` 準拠）。ブランドは dgloss 青`#2563EB`/紫`#7C3AED`（`BRAND.md`）。

## ドキュメント

- [Dig制度 システム要件定義書 v1.1](docs/Dig制度_システム要件定義書_v1.1.md)
  - 現行 Excel（計算ロジックの正）と dgloss OS ワイヤーフレーム画面20（UI/連携の正）を突合して作成。
  - v1.1: 確認質問（Q1〜Q8）への回答を反映（PT除外／累計予算Dig係数×3・×6／成果Dig手入力／Person ID手入力／承認ゲート必須）。
  - §12 に決定事項ログ。残る未設定（Q5相対貸借精算・Q6安全弁）は実装前に別途確定。
- [P1（コア）技術設計](docs/P1_技術設計.md) — contracts/core/web/prisma の設計・Excel回帰・DoD。
