# Supabase 接続情報 ご提供のお願い（Dig制度 × SP_CRM / 契約管理 連携）

作成: 2026-07-17 ／ 依頼元: Dig制度システム（ishii-code/dgloss-dig）

## 1. 背景・目的
Dig制度システムが以下2システムの Supabase を**参照（読み取り）**し、
**契約 → 担当者 → 従業員の成果Dig** を自動反映します。手入力を排し、SFA上の担当者から自動で帰属します。

| システム | アプリURL（参考） | 役割 |
|---|---|---|
| **SP_CRM** | https://sp-crm-nine.vercel.app/11111111/my | 取引先・商談・担当者（誰が担当か） |
| **契約管理（keiyaku-kanri-next）** | https://keiyaku-kanri-next.vercel.app/contracts | 契約内容（何をどれだけ＝Dig算定の元） |

> ⚠️ 上記は **アプリ（Vercel）のURL** です。必要なのは **Supabase の接続URL（`https://<プロジェクトref>.supabase.co`）とAPIキー** で、Vercel URL とは別物です。

## 2. ご提供いただきたい情報（2システム分）
各システムの Supabase プロジェクトについて、以下2点をお願いします。

1. **Project URL**：`https://<ref>.supabase.co`
2. **API Key**（どちらか）
   - **推奨**：`service_role` キー（サーバサイドのみで保持。読み取り用途に限定）
   - もしくは `anon` キー ＋ 対象テーブルに**読み取り可能な RLS ポリシー**

### 取得場所（Supabase ダッシュボード）
対象プロジェクト → **Project Settings → API** →
- 「Project URL」= 上記1
- 「Project API keys」→ `service_role`（秘匿）または `anon public` = 上記2

## 3. 参照するテーブル・カラム（最小権限で結構です）
読み取りのみ。書き込みは行いません。

### SP_CRM（担当者の特定）
| テーブル | 使うカラム | 用途 |
|---|---|---|
| `accounts`（取引先） | `id`, `name`, `corporate_number` | **企業名 / 法人番号で契約とマッチング** |
| `opportunities`（商談） | `account_id`, `assigned_to`, `apo_creator` | 担当者（FS＝assigned_to / IS＝apo_creator） |
| `members` | `id`, `name`, `email` | **email で dgloss 従業員と突合** |

### 契約管理（keiyaku-kanri-next）
| テーブル | 使うカラム | 用途 |
|---|---|---|
| `contracts` | `id`, `contract_no`, `customer_id`, `model_key`, `status`, `base_amount`, `setup_fee`, `initial_fee`, `term_months`, `line_items`, `start_date` | Dig算定の元 |
| `customers` | `id`, `name`, `customer_code`, `project_id`, `instance_id` | 企業名・企業ID候補 |

## 4. 保存・取扱い（セキュリティ）
- 環境変数（**サーバサイド専用・`NEXT_PUBLIC_` 不可**）に格納：
  ```
  SPCRM_SUPABASE_URL   = https://<ref>.supabase.co
  SPCRM_SUPABASE_KEY   = <service_role or anon key>
  KEIYAKU_SUPABASE_URL = https://<ref>.supabase.co
  KEIYAKU_SUPABASE_KEY = <service_role or anon key>
  ```
- 本番は **Vercel(dg-bo) の環境変数 / Supabase** に保管。`.env` はコミットしません（`.gitignore` 済）。
- `service_role` キーは**サーバ側のみ**で使用し、クライアントに露出しません。
- キーは Slack DM 等ではなく、可能なら Vercel 環境変数へ直接投入 or 1Password 等の共有で頂けると安全です。

## 5. マッチング方針（現状：暫定）
- **ID整理までは「企業名」でマッチング**します（契約の顧客名 ↔ SP_CRM 取引先名）。
- 企業IDの整備後に、**企業ID（法人番号 or 共有の企業ID）**でのマッチングへ切り替えます。
  - その際、keiyaku の `customers` のどの項目（`customer_code` / `project_id` / `instance_id` / 法人番号）を「企業ID」とするかをご相談させてください。

## 6. 頂いた後の流れ（こちらで実施）
1. 環境変数を投入 → コネクタが SP_CRM / keiyaku の Supabase を直結参照
2. 契約を取込 → 企業名で SP_CRM 取引先を照合 → 担当者(FS/IS)を解決 → 折半で成果Dig自動帰属
3. 「成果Digに反映」で各従業員の月次評価へ反映

---
ご不明点があれば Dig制度側（石井）までお知らせください。
