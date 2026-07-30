# 引き継ぎ：jinjer API 連携の実装メモ

Dig評価（dgloss-dig）で jinjer API を実装して分かったことをまとめる。
勤怠管理システム側でも同じ API を叩くため、ハマりどころを含めて共有する。

実装の参照元: `apps/web/server/jinjer.ts`

---

## 1. 認証

```
GET https://api.jinjer.biz/v2/token
ヘッダ: X-API-KEY: <APIキー>
        X-SECRET-KEY: <シークレット>
        Content-Type: application/json
```

- レスポンスは `{ "data": { "access_token": "..." } }`（トップレベルに `access_token` が来る場合もあるので両対応にした）
- 以降のリクエストは `Authorization: Bearer <access_token>`
- **トークンの有効期限は4時間**。毎リクエストで取り直すとすぐレート制限に当たるので、プロセス内で3時間キャッシュしている

```ts
let tokenCache: { token: string; expiresAt: number } | null = null;
async function getToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const token = await requestToken();
  tokenCache = { token, expiresAt: Date.now() + 3 * 60 * 60 * 1000 };
  return token;
}
```

環境変数名の揺れに注意。Vercel 側の設定が `JINJER_API_SECRET` になっていたことがあり、
`JINJER_SECRET_KEY ?? JINJER_API_SECRET` の両対応にしている。

---

## 2. 使ったエンドポイント

| エンドポイント | 用途 | 備考 |
| --- | --- | --- |
| `GET /v1/employees?page=N` | 従業員の基本情報 | **部署・役職は返ってこない** |
| `GET /v1/employees/affiliations?page=N` | 所属（部署）情報 | 主務は `affiliations[0].department.name` |
| `GET /v1/employees/salaries?page=N` | 給与情報 | 月給・時給の両方がここ |
| `GET /v1/departments` | 部署ツリー | 事業部への正規化に使用 |

### ハマりどころ①：`limit` パラメータは使えない

```
400 Bad Request: 'limit' is not allowed
```

ページネーションは **`page` のみ**。1ページあたりの件数は指定できない（実測100件程度）。
終端判定は「取得0件」または「前ページと同じIDが返ってきたら終了」で行っている。

### ハマりどころ②：200 で非JSONが返ってくることがある

レート制限や一時エラーのときに、ステータス200のまま
`An error occurred...` のようなHTMLやプレーンテキストが返る。
JSON.parse が例外を投げてクラッシュするので、**リトライ付きのフェッチ**を用意した。

```ts
async function fetchJson(url, headers, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    try { return { ok: res.ok, status: res.status, json: JSON.parse(text), text }; }
    catch { /* 非JSON → リトライ */ }
    if (i < tries - 1) await sleep(500 * (i + 1)); // 0.5s, 1s
  }
}
```

### ハマりどころ③：レスポンスの入れ物が一定でない

配列がトップレベルに来る場合と `data` / `employees` / `results` / `items` / `list`、
さらに `data.employees` のような入れ子もある。候補キーを順に見る関数を用意した。

---

## 3. 従業員データの構造（ここが一番ハマった）

`GET /v1/employees` の1レコードは **社員番号がトップレベルの `id`**、
氏名などは **`company` / `personal` の入れ子**に入っている。

```json
{
  "id": "B0000064",
  "company": {
    "last_name": "掛端",
    "first_name": "光",
    "employment_classification": { "name": "正社員" },
    "enrollment_classification": { "name": "在籍" },
    "joined_on": "2024-08-01",
    "email": "kakehata@dgloss.co.jp"
  },
  "personal": {
    "email": "xxxx@gmail.com"
  }
}
```

当初 `employee_code` を社員番号だと思って読んでいたため、**1586件取得して取込0件**になった。
`id` がフラットに来ている点に注意。

### 分類系フィールドはオブジェクト

`employment_classification` や `enrollment_classification` は文字列ではなく
`{ id, name }` のオブジェクト。`.name` を取る必要がある。

- 在籍判定: `enrollment_classification.name` に「在籍」を含むか
- 役員判定: `employment_classification.name` に「役員」を含むか（Dig評価では役員を除外）

実データ内訳（2026年7月時点）: 取得1586件 → 在籍184 / 退職1402

### メールアドレス

- **`company.email` に会社メール**（`@dgloss.co.jp`・300名中272名）
- **`personal.email` に私用メール**（`@gmail.com` 等・300名中279名）

アカウント発行に使うなら **`company` 側だけ**を見ること。
`personal` にフォールバックすると私用の gmail をログインIDにしてしまう。
Dig評価では私用ドメイン（gmail/yahoo/icloud/docomo/au/softbank 等）を除外している。

---

## 4. 部署（affiliations）

`GET /v1/employees/affiliations` の1レコード:

```json
{
  "employee_id": "B0000064",
  "affiliations": [
    { "department": { "id": "123", "name": "ダイレクトセールス部セールスG" } }
  ]
}
```

- 主務は `affiliations[0]`
- 部署名が `"未選択"` のことがあるので空扱いにする
- **末端のチーム名が返る**（例「ダイレクトセールス部セールスG」「デリバリーISG」「カスタマーグロース部」）。
  事業部単位で扱いたい場合は自前でマッピングが必要（Dig評価では「所属名 → 事業部」のルールテーブルを作った）
- 同じチームでも人によって所属事業部が違うケースがあるため、**メンバー個別の上書き**も持たせている

---

## 5. 給与（salaries）

`GET /v1/employees/salaries` の1レコード:

```json
{
  "employee_id": "B0000064",
  "salaries": [
    {
      "revised_on": "2025-04-01",
      "salary_units": [
        { "label": "基本給(月給)", "value": 400000 },
        { "label": "役職手当",     "value": 50000 }
      ]
    }
  ]
}
```

- `salaries` は改定履歴の配列。**`revised_on` の降順で最新を取る**
- 金額は `salary_units` の `label` で引く。**項目名は文字列ベタ書きなので要注意**
- **月給と時給で label が別**:
  - 正社員 … `基本給(月給)`
  - アルバイト … `基本給(時給)`

当初 `基本給` だけを見ていたため、185名中50名しか給与が取れなかった。
時給者を別項目として扱って解決した。

label の一覧は API を叩いて実データから確認するのが確実
（Dig評価では「給与項目を確認」という診断ボタンを作った。数ページ分を集計して
label ごとの設定人数と例を表示する。同じ方式で「メール項目を確認」も作った）。

---

## 6. タイムアウト対策（Vercel で必須）

在籍184名でも、従業員＋所属＋給与を1リクエストで全部取ると
**Vercel の関数タイムアウト（既定10秒 / maxDuration 60秒でも足りないことがある）** に当たる。
`Unexpected token 'A', "An error o"` というエラーの正体はタイムアウトのHTMLだった。

対策として処理を分けた:

1. **従業員の取込**（`POST /api/members/sync-jinjer`）
2. **所属・給与の反映**（`POST /api/members/enrich-jinjer`）は **1リクエスト＝1ページ**にして、
   クライアントが `page` を進めながら繰り返し呼ぶ

```ts
export const maxDuration = 60; // ルートごとに指定
```

クライアント側では、非JSONレスポンスを「タイムアウトしました」と分かる形に変換している
（生の `Unexpected token` を出さない）。

---

## 7. 同期の設計で気をつけること

**jinjer が正の項目だけを更新する。** これを守らないと自社側で入力した値が消える。

Dig評価では一度これで事故を起こした。jinjer は部署も役職も返さないのに、
同期処理が両方を書き込んでいたため、同期のたびに

- 事業部が空文字で上書きされる
- 役職が既定値「メンバー」で上書きされる

という状態になった。現在は次のように整理している。

| 区分 | 項目 |
| --- | --- |
| jinjer が正（毎回更新する） | 氏名・雇用区分・入社日・在籍状況・会社メール・基本給 |
| 自社側が正（**同期で触らない**） | 事業部の紐づけ・役職・給与レンジ・評価サイクル・グループ長 |

さらに保険として、**同期の直前に自社側の入力項目を監査ログへスナップショット**し、
1クリックで巻き戻せる「復元」機能を用意した。同じ作りにしておくと事故ったとき助かる。

---

## 8. 勤怠管理システム側で追加調査が必要そうな点

Dig評価では従業員マスタしか使っていないため、勤怠側で必要になりそうな以下は未検証。

- 打刻・勤怠実績のエンドポイント（`/v1/attendances` 等があるか、期間指定の形式）
- 締め状態・承認フローの取得
- 休暇（有給残など）
- 更新系（POST/PUT）の可否とレスポンス形式
- レート制限の具体値（Dig評価では0.5秒バックオフ×3回で足りている）

エンドポイントの当たりを付けるときは、**まず生レスポンスのキー一覧を出す診断エンドポイント**を
作ってから正規化を書くのが早い。項目名の推測でコードを書くと確実にハマる。

---

## 9. 環境変数

```
JINJER_API_KEY=<X-API-KEY>
JINJER_SECRET_KEY=<X-SECRET-KEY>   # JINJER_API_SECRET でも読めるようにしてある
JINJER_API_BASE=https://api.jinjer.biz
```

未設定のときはサンプルデータで動くようにしてある（env-gated）。
本番のキーが無い環境でも正規化・除外ロジックを検証できるので、同じ作りを推奨する。
