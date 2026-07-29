# [1.11.0](https://github.com/ishii-code/dgloss-dig/compare/v1.10.1...v1.11.0) (2026-07-29)


### Features

* **members:** 基本給を一覧表示＋役員を評価対象から除外 ([#49](https://github.com/ishii-code/dgloss-dig/issues/49)) ([2493dee](https://github.com/ishii-code/dgloss-dig/commit/2493deef9bc254376aa690d62f06837ebacda060))

## [1.10.1](https://github.com/ishii-code/dgloss-dig/compare/v1.10.0...v1.10.1) (2026-07-29)


### Bug Fixes

* **division:** 所属一覧でその場で紐づけ（ページ最上部への移動を廃止） ([#48](https://github.com/ishii-code/dgloss-dig/issues/48)) ([8bf49a7](https://github.com/ishii-code/dgloss-dig/commit/8bf49a781008ebe88432f79b5432bc948a796aea))

# [1.10.0](https://github.com/ishii-code/dgloss-dig/compare/v1.9.0...v1.10.0) (2026-07-29)


### Features

* **division:** jinjer所属→事業部の紐づけ管理を追加 ([#47](https://github.com/ishii-code/dgloss-dig/issues/47)) ([1049638](https://github.com/ishii-code/dgloss-dig/commit/104963867df549317beb5df788dceb1cf70f4ed4))

# [1.9.0](https://github.com/ishii-code/dgloss-dig/compare/v1.8.3...v1.9.0) (2026-07-29)


### Features

* **jinjer:** 部署ツリーを辿り所属を「事業部」レベルへ正規化 ([#46](https://github.com/ishii-code/dgloss-dig/issues/46)) ([85c2599](https://github.com/ishii-code/dgloss-dig/commit/85c2599fb49451fa69d7a59dfb4e8ea5b4877325))

## [1.8.3](https://github.com/ishii-code/dgloss-dig/compare/v1.8.2...v1.8.3) (2026-07-29)


### Bug Fixes

* **jinjer:** 部署・給与の反映を1ページ単位に細分化しタイムアウト解消 ([#45](https://github.com/ishii-code/dgloss-dig/issues/45)) ([5d45ab3](https://github.com/ishii-code/dgloss-dig/commit/5d45ab3b625eae931adad2afabfd0f8241af0538))

## [1.8.2](https://github.com/ishii-code/dgloss-dig/compare/v1.8.1...v1.8.2) (2026-07-29)


### Bug Fixes

* **jinjer:** 同期を「取込」と「部署・給与反映」に分離しタイムアウト回避 ([#44](https://github.com/ishii-code/dgloss-dig/issues/44)) ([e115b0b](https://github.com/ishii-code/dgloss-dig/commit/e115b0b70c15332cdf1cdf39985feb536a195fa2))

## [1.8.1](https://github.com/ishii-code/dgloss-dig/compare/v1.8.0...v1.8.1) (2026-07-29)


### Bug Fixes

* **jinjer:** 同期タイムアウトを防止＋クライアントを非JSON応答に耐性化 ([#43](https://github.com/ishii-code/dgloss-dig/issues/43)) ([45f08d3](https://github.com/ishii-code/dgloss-dig/commit/45f08d38896c2740d81c80ef92cf4caeec3bd179))

# [1.8.0](https://github.com/ishii-code/dgloss-dig/compare/v1.7.1...v1.8.0) (2026-07-29)


### Features

* **masters:** jinjer同期中のローディング表示とボタン無効化 ([#42](https://github.com/ishii-code/dgloss-dig/issues/42)) ([2410ee0](https://github.com/ishii-code/dgloss-dig/commit/2410ee0566d03f2833d944a38d97bb4bf54f4414))

## [1.7.1](https://github.com/ishii-code/dgloss-dig/compare/v1.7.0...v1.7.1) (2026-07-29)


### Bug Fixes

* **jinjer:** 非JSON応答に耐性（リトライ）＋取得を順次化 ([#41](https://github.com/ishii-code/dgloss-dig/issues/41)) ([be00ceb](https://github.com/ishii-code/dgloss-dig/commit/be00ceb7db691db8d8ce1ff444fbe3e4ba85b121))

# [1.7.0](https://github.com/ishii-code/dgloss-dig/compare/v1.6.0...v1.7.0) (2026-07-29)


### Features

* **jinjer:** 所属(部署)と基本給を取込に反映＋部署別人数を集計 ([#40](https://github.com/ishii-code/dgloss-dig/issues/40)) ([6b7f288](https://github.com/ishii-code/dgloss-dig/commit/6b7f2886aa00a71edb4e2bba8680fc4b474fa237))

# [1.6.0](https://github.com/ishii-code/dgloss-dig/compare/v1.5.0...v1.6.0) (2026-07-29)


### Features

* **jinjer:** 所属/給与の正解エンドポイント候補で再調査 ([#39](https://github.com/ishii-code/dgloss-dig/issues/39)) ([988b61f](https://github.com/ishii-code/dgloss-dig/commit/988b61f8fb65289cf9fe139241def1d1b90ca3f4))

# [1.5.0](https://github.com/ishii-code/dgloss-dig/compare/v1.4.0...v1.5.0) (2026-07-28)


### Features

* **jinjer:** 組織API調査に給与系エンドポイント候補を追加 ([#38](https://github.com/ishii-code/dgloss-dig/issues/38)) ([ddb403f](https://github.com/ishii-code/dgloss-dig/commit/ddb403fe68e755af6e60bed3e0ff0e0f5b126b26))

# [1.4.0](https://github.com/ishii-code/dgloss-dig/compare/v1.3.0...v1.4.0) (2026-07-28)


### Features

* **jinjer:** 所属マッピング探索の診断を拡張 ([#37](https://github.com/ishii-code/dgloss-dig/issues/37)) ([3663d97](https://github.com/ishii-code/dgloss-dig/commit/3663d970b0aa4e4f22a9c1ea6189ae3c7b3b256f))

# [1.3.0](https://github.com/ishii-code/dgloss-dig/compare/v1.2.2...v1.3.0) (2026-07-28)


### Features

* **jinjer:** 組織/部署APIの探索診断を追加（部署ソース特定用） ([#36](https://github.com/ishii-code/dgloss-dig/issues/36)) ([db13644](https://github.com/ishii-code/dgloss-dig/commit/db136443fee16779b030997170cf9a234109abff))

## [1.2.2](https://github.com/ishii-code/dgloss-dig/compare/v1.2.1...v1.2.2) (2026-07-28)


### Bug Fixes

* **jinjer:** position を Position enum 準拠に（役員等の無効値を回避） ([#35](https://github.com/ishii-code/dgloss-dig/issues/35)) ([d866a5b](https://github.com/ishii-code/dgloss-dig/commit/d866a5b3aaa6f92f9e693a92f2dcda9ebaa12c49))

## [1.2.1](https://github.com/ishii-code/dgloss-dig/compare/v1.2.0...v1.2.1) (2026-07-28)


### Bug Fixes

* **jinjer:** 実レスポンス構造(id/company ネスト)に合わせて取込を修正 ([#34](https://github.com/ishii-code/dgloss-dig/issues/34)) ([f233851](https://github.com/ishii-code/dgloss-dig/commit/f233851be3707a6b31284cfa5cd459a1aa25d05d))

# [1.2.0](https://github.com/ishii-code/dgloss-dig/compare/v1.1.1...v1.2.0) (2026-07-27)


### Features

* **jinjer:** 取込0名時にレコード項目名を診断表示（マッピング特定用） ([#33](https://github.com/ishii-code/dgloss-dig/issues/33)) ([04f259b](https://github.com/ishii-code/dgloss-dig/commit/04f259b9c65f1b54d195637e7418383195c414ef))

## [1.1.1](https://github.com/ishii-code/dgloss-dig/compare/v1.1.0...v1.1.1) (2026-07-27)


### Bug Fixes

* **header:** ヘッダのバージョン表示を実バージョン(package.json)に連動 ([#32](https://github.com/ishii-code/dgloss-dig/issues/32)) ([e9301bc](https://github.com/ishii-code/dgloss-dig/commit/e9301bcf6e8aed6957d4c71047bcd6ed709d3bfd))

# [1.1.0](https://github.com/ishii-code/dgloss-dig/compare/v1.0.0...v1.1.0) (2026-07-27)


### Features

* **release-notes:** アプリ内リリースノートをGitHub Releaseから実行時取得 ([#31](https://github.com/ishii-code/dgloss-dig/issues/31)) ([a2b4110](https://github.com/ishii-code/dgloss-dig/commit/a2b4110f59e54d21d55fe23f0d20fd0152a5d767))

# 1.0.0 (2026-07-27)


### Bug Fixes

* **ci:** Release/CIワークフローのpnpm二重指定を解消し自動化を復旧 ([#29](https://github.com/ishii-code/dgloss-dig/issues/29)) ([98edbb8](https://github.com/ishii-code/dgloss-dig/commit/98edbb83ce386e0e7040decece58fd0be89393f0))
* **deploy:** outputDirectory を .next に（apps/web二重パス解消） ([#18](https://github.com/ishii-code/dgloss-dig/issues/18)) ([c4d819c](https://github.com/ishii-code/dgloss-dig/commit/c4d819c221865f3f8cc7b9178adfd64b5b41639f))
* **deploy:** pnpm allowBuilds を true に（Vercelの pnpm install 失敗を解消） ([#15](https://github.com/ishii-code/dgloss-dig/issues/15)) ([722ae03](https://github.com/ishii-code/dgloss-dig/commit/722ae0332f7156bc75e6304b5d8b5928637b6b23))
* **deploy:** Prismaを Vercel Postgres の POSTGRES_PRISMA_URL/POSTGRES_URL_NON_POOLING 参照に ([#16](https://github.com/ishii-code/dgloss-dig/issues/16)) ([fe48506](https://github.com/ishii-code/dgloss-dig/commit/fe485062db3f3298b1dd62c68360837d5f8fd961))
* **deploy:** Vercelビルドで prisma を workspace-root 実行（schema not found 解消） ([#17](https://github.com/ishii-code/dgloss-dig/issues/17)) ([0b10672](https://github.com/ishii-code/dgloss-dig/commit/0b10672dec8c3d107917978e5403446938d66982))
* **jinjer:** /v1/employees の limit パラメータを除去（400対応） ([#28](https://github.com/ishii-code/dgloss-dig/issues/28)) ([d50cf5c](https://github.com/ishii-code/dgloss-dig/commit/d50cf5c03b3681a3d4eaae24a27dc0ed793990b5))
* **jinjer:** シークレットの環境変数名の揺れに対応（JINJER_API_SECRET） ([#27](https://github.com/ishii-code/dgloss-dig/issues/27)) ([5a02e6f](https://github.com/ishii-code/dgloss-dig/commit/5a02e6fa6d7cb2f5723fc23ea38b1345d4cc8cea))
* **jinjer:** 全ページ取得(ページング)＋診断カウント（200名対応） ([#20](https://github.com/ishii-code/dgloss-dig/issues/20)) ([eb174d7](https://github.com/ishii-code/dgloss-dig/commit/eb174d7f453df4c8a77a1a03288996365f24210a))
* **jinjer:** 実エラー本文を画面に表示（原因特定用）＋token応答の揺れ対応 ([#21](https://github.com/ishii-code/dgloss-dig/issues/21)) ([629d9e6](https://github.com/ishii-code/dgloss-dig/commit/629d9e6f847a14e803d22f72e46f1168f0513f88))
* **period:** 会計年度の期首を6月始まりに修正 ([#25](https://github.com/ishii-code/dgloss-dig/issues/25)) ([2056027](https://github.com/ishii-code/dgloss-dig/commit/2056027374481618568adf9d5794a9765038b0f9))
* **period:** 既定を現在月にし四半期一覧に現在Qを含める ([#26](https://github.com/ishii-code/dgloss-dig/issues/26)) ([b523219](https://github.com/ishii-code/dgloss-dig/commit/b52321991496eee2a7f2de97ef324953236ac046))
* **release:** semantic-releaseプラグインをdevDepsに追加し解決不能を修正 ([#30](https://github.com/ishii-code/dgloss-dig/issues/30)) ([eea5b14](https://github.com/ishii-code/dgloss-dig/commit/eea5b14b8344faaef1b1cf776510b5d4d6ab439c))


### Features

* **backend:** DB/API/監査ログ・金融管理のAPI接続・CI・デプロイ設定（P4） ([#4](https://github.com/ishii-code/dgloss-dig/issues/4)) ([c3ab512](https://github.com/ishii-code/dgloss-dig/commit/c3ab512b81e094e304103f229de3a8d7cb475515))
* **bank:** Digloss Bank／ディグロス金融（入社時必須初回借入・追加借入承認・金利変更） ([#2](https://github.com/ishii-code/dgloss-dig/issues/2)) ([dc6e9b2](https://github.com/ishii-code/dgloss-dig/commit/dc6e9b2d69717ff59a277b1bc990792ad076befb))
* **core:** P1コア実装（計算エンジン・contracts・ダッシュボード） ([#1](https://github.com/ishii-code/dgloss-dig/issues/1)) ([0498943](https://github.com/ishii-code/dgloss-dig/commit/0498943f58b8ee72e646c6d372199c824001a6b9))
* **evaluations:** 在籍メンバーから評価台帳を生成する機能を追加 ([#23](https://github.com/ishii-code/dgloss-dig/issues/23)) ([c443194](https://github.com/ishii-code/dgloss-dig/commit/c443194ea408b996a9faaa2e3e908c93a09c1121))
* **jinjer:** 勤怠API連携で従業員マスタ自動同期（CRM事業部・管理本部を除外） ([#19](https://github.com/ishii-code/dgloss-dig/issues/19)) ([d144858](https://github.com/ishii-code/dgloss-dig/commit/d1448582bdd6ab3606826030664122104a01ddb6))
* **loan:** 借入申請ページ(会社/相対)＋承認チャット(差し戻し/否決/コメント)＋添付＋未読バッジ ([#9](https://github.com/ishii-code/dgloss-dig/issues/9)) ([dafe9f1](https://github.com/ishii-code/dgloss-dig/commit/dafe9f180f2b98a381bf3eb62af8b439d206aba5))
* **monitor:** 予実モニター/メンバー評価を実データ(DB)に配線 ([#22](https://github.com/ishii-code/dgloss-dig/issues/22)) ([3487cf3](https://github.com/ishii-code/dgloss-dig/commit/3487cf334eb2f74b1e1ad6a82e7c38e715247f14))
* **monitor:** 対象期間（四半期・月）セレクタを追加 ([#24](https://github.com/ishii-code/dgloss-dig/issues/24)) ([afa3106](https://github.com/ishii-code/dgloss-dig/commit/afa3106f4c54c01093b4c80d482d9deff6a3946d))
* **period-close:** 期末処理UI(Q8確定/Q3持越選択/Q13手入力承認/Q14退社精算) ([#13](https://github.com/ishii-code/dgloss-dig/issues/13)) ([0d5e7a5](https://github.com/ishii-code/dgloss-dig/commit/0d5e7a57b98f02789e159e346bee96fefb7b0e28))
* **rbac:** アカウント一覧＋権限(スーパーADMIN/ADMIN/ユーザー) ([#6](https://github.com/ishii-code/dgloss-dig/issues/6)) ([1b1d0cf](https://github.com/ishii-code/dgloss-dig/commit/1b1d0cfaab0c193d33c4780bb7a0f3bca4b1a0a9))
* **rules:** Dig獲得ルール登録・keiyaku契約Dig反映(折半)・マスタ編集(P5) ([#5](https://github.com/ishii-code/dgloss-dig/issues/5)) ([b07b33d](https://github.com/ishii-code/dgloss-dig/commit/b07b33db5ab6212f0c81ba964824bbe004245636))
* **rules:** 運用ルール残り実装(Q3/Q7/Q9/Q11/Q12/Q15 core・Q8確定・Q12ゼロサム) ([#12](https://github.com/ishii-code/dgloss-dig/issues/12)) ([dffa9dd](https://github.com/ishii-code/dgloss-dig/commit/dffa9dd797b417a2d9d48ae21c2fd32edce5d045))
* **salary:** 全社統一給与テーブル(全員閲覧)＋運用ルール確定分の実装(Q1/Q2/Q5/Q6) ([#11](https://github.com/ishii-code/dgloss-dig/issues/11)) ([fb9bcd9](https://github.com/ishii-code/dgloss-dig/commit/fb9bcd92e1169ef83eaf647fc6c06df0f19d9fe0))
* **spcrm:** SP_CRM連携(企業ID→担当者→自動帰属)＋改善リクエストタブ(P7) ([#7](https://github.com/ishii-code/dgloss-dig/issues/7)) ([763a506](https://github.com/ishii-code/dgloss-dig/commit/763a506b27462a995bdc276d41769bd4a73e025c))
* **spcrm:** 企業名マッチング(暫定)＋Supabase接続情報の依頼文書 ([#8](https://github.com/ishii-code/dgloss-dig/issues/8)) ([155923b](https://github.com/ishii-code/dgloss-dig/commit/155923b1de9db4c5393de7c423e33115a675e86a))
* **web:** ボーナスDig・取引ログ・リリースノート・設定・昇降級（残機能を並行実装） ([#3](https://github.com/ishii-code/dgloss-dig/issues/3)) ([81b2e45](https://github.com/ishii-code/dgloss-dig/commit/81b2e454364f7134832aaa9989d65580576fdd6d))
