/**
 * jinjer（勤怠管理）コネクタ。従業員マスタを自動連携。
 * API: base https://api.jinjer.biz
 *   認証:  GET /v2/token  ヘッダ X-API-KEY / X-SECRET-KEY → data.access_token（4h有効）
 *   従業員: GET /v1/employees  ヘッダ Authorization: Bearer <token>
 *
 * 本番: JINJER_API_KEY と シークレット（JINJER_SECRET_KEY または
 * JINJER_API_SECRET のどちらでも可）を設定すると実APIから取得。
 * 未設定時: 下記サンプルで同期ロジック（除外フィルタ・upsert）を検証。
 *
 * 取込対象: CRM事業部・管理本部 以外の全員（EXCLUDED_DIVISIONS）。
 */

const JINJER_BASE = process.env.JINJER_API_BASE ?? "https://api.jinjer.biz";
// キー名の揺れに対応（Vercel 側の設定名が JINJER_API_SECRET のことがある）。
const JINJER_API_KEY = process.env.JINJER_API_KEY ?? "";
const JINJER_SECRET_KEY =
  process.env.JINJER_SECRET_KEY ?? process.env.JINJER_API_SECRET ?? "";
export const jinjerConnected = Boolean(JINJER_API_KEY && JINJER_SECRET_KEY);

/** 取込から除外する事業部/部署 */
export const EXCLUDED_DIVISIONS = ["CRM事業部", "管理本部"];

/** dgloss 従業員マスタ向けに正規化した形 */
export interface NormalizedEmployee {
  personId: string; // 社員番号（jinjer では top-level id）
  name: string;
  division: string; // 事業部/部署（jinjer 従業員APIには無いため通常空）
  position: string; // 役職
  employmentType: "正社員" | "アルバイト";
  joinedOn: string; // YYYY-MM-DD
  status: string; // 在籍状況（在籍/退職 等）
}

// ── 実API ─────────────────────────────
async function getToken(): Promise<string> {
  const res = await fetch(`${JINJER_BASE}/v2/token`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": JINJER_API_KEY,
      "X-SECRET-KEY": JINJER_SECRET_KEY,
    },
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`jinjer /v2/token ${res.status}: ${bodyText.slice(0, 300)}`);
  let json: { data?: { access_token?: string }; access_token?: string };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`jinjer /v2/token レスポンスがJSONでない: ${bodyText.slice(0, 200)}`);
  }
  const token = json.data?.access_token ?? json.access_token;
  if (!token) throw new Error(`jinjer access_token が取れません（応答: ${bodyText.slice(0, 200)}）`);
  return token;
}

/** レスポンスから従業員配列を取り出す（形の揺れに対応）。 */
function extractList(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const o = json as Record<string, unknown>;
  for (const k of ["data", "employees", "results", "items", "list"]) {
    if (Array.isArray(o?.[k])) return o[k] as Record<string, unknown>[];
  }
  // data.employees のような入れ子
  const data = o?.data as Record<string, unknown> | undefined;
  if (data) {
    for (const k of ["employees", "results", "items", "list"]) {
      if (Array.isArray(data[k])) return data[k] as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * 全ページ取得。jinjer /v1/employees は `limit` を受け付けない
 * （E400QP0023）ため page のみでページングし、重複排除で終端検出する。
 * page が無視される実装でも「新規0件で終端」により安全に停止する。
 */
async function fetchRawEmployees(): Promise<Record<string, unknown>[]> {
  const token = await getToken();
  const seen = new Set<string>();
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${JINJER_BASE}/v1/employees?page=${page}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`jinjer /v1/employees ${res.status}: ${(await res.text()).slice(0, 300)}`);
      break; // 2ページ目以降のエラーは終端扱い
    }
    const list = extractList(await res.json());
    if (list.length === 0) break;
    let added = 0;
    for (const item of list) {
      const key = String(item["employee_code"] ?? item["emp_code"] ?? item["code"] ?? item["id"] ?? JSON.stringify(item));
      if (!seen.has(key)) {
        seen.add(key);
        all.push(item);
        added += 1;
      }
    }
    // 新規が増えない（=同じ結果 or 最終ページ）なら終了
    if (added === 0) break;
  }
  return all;
}

// ── 正規化（jinjerのフィールド名は複数候補にフォールバック）──
function pick(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** jinjer の区分オブジェクト {id, name} から name を取り出す。 */
function className(v: unknown): string {
  return pick(asObj(v), "name");
}

/**
 * jinjer 人事労務の従業員レコードを正規化。
 * 実構造: { id, company:{ last_name, first_name, joined_on,
 *   employment_classification:{name}, enrollment_classification:{name}, ... },
 *   personal:{...}, ... }。旧フラット形（サンプル）にもフォールバック。
 * 事業部/部署・給与はこのレコードに含まれない（別リソース）。
 */
function normalize(o: Record<string, unknown>): NormalizedEmployee | null {
  const company = asObj(o["company"]);
  const personal = asObj(o["personal"]);
  const personId = pick(o, "id", "employee_code", "emp_code", "code", "staff_code");
  if (!personId) return null;

  const last = pick(company, "last_name") || pick(personal, "last_name") || pick(o, "last_name", "family_name");
  const first = pick(company, "first_name") || pick(personal, "first_name") || pick(o, "first_name", "given_name");
  const name = `${last}${first}`.trim() || pick(o, "full_name", "name") || personId;

  const empRaw =
    className(company["employment_classification"]) ||
    pick(o, "employment_type", "employment_status", "雇用形態");
  const employmentType: "正社員" | "アルバイト" =
    empRaw.includes("アルバイト") || empRaw.includes("パート") || empRaw.toLowerCase().includes("part")
      ? "アルバイト"
      : "正社員";

  const joinedRaw = pick(company, "joined_on") || pick(o, "enter_date", "hire_date", "join_date", "入社日");
  const joinedOn = joinedRaw ? joinedRaw.slice(0, 10) : "2020-01-01";

  // 在籍状況（在籍/退職）。取込は在籍のみ対象。
  const status = className(company["enrollment_classification"]) || pick(o, "status") || "在籍";

  // 事業部/部署はこのAPIに無いため空（将来 組織API 等で補完）。
  const division = pick(o, "group_name", "department_name", "busho", "division", "事業部");
  // 役職も無いため雇用区分を暫定表示。
  const position = pick(company, "position_name") || empRaw || "メンバー";

  return { personId, name, division, position, employmentType, joinedOn, status };
}

// ── サンプル（jinjer形・未接続時の検証用。CRM事業部/管理本部を含めて除外を確認）──
const SAMPLE_RAW: Record<string, unknown>[] = [
  { employee_code: "B0000064", last_name: "掛端", first_name: "光", group_name: "AIテレアポ事業部", position_name: "部長", employment_type: "正社員", enter_date: "2024-08-01" },
  { employee_code: "B0000097", last_name: "堀川", first_name: "璃歩", group_name: "AIテレアポ事業部", position_name: "メンバー", employment_type: "正社員", enter_date: "2025-11-04" },
  { employee_code: "B0000069", last_name: "駒田", first_name: "真一郎", group_name: "SP事業部", position_name: "部長", employment_type: "正社員", enter_date: "2024-09-09" },
  { employee_code: "D0001039", last_name: "伊藤", first_name: "颯汰", group_name: "SP事業部", position_name: "メンバー", employment_type: "アルバイト", enter_date: "2025-09-01" },
  { employee_code: "B0000091", last_name: "江藤", first_name: "利幸", group_name: "PT事業部", position_name: "マネージャー", employment_type: "正社員", enter_date: "2025-07-25" },
  // 以下は除外対象
  { employee_code: "B0000085", last_name: "本間", first_name: "駿", group_name: "CRM事業部", position_name: "マネージャー", employment_type: "正社員", enter_date: "2025-05-01" },
  { employee_code: "C0000008", last_name: "渡部", first_name: "あすか", group_name: "管理本部", position_name: "マネージャー", employment_type: "正社員", enter_date: "2024-06-01" },
];

/** 在籍とみなす在籍状況（退職・休職等を除外）。 */
function isActive(status: string): boolean {
  return status.includes("在籍");
}

/**
 * jinjerから従業員を取得して正規化し、在籍者のみを対象にする。
 * 事業部/部署が取れる場合は CRM事業部・管理本部 を除外（現状 jinjer 従業員API
 * には部署が無いため通常は全在籍者が対象）。未接続時はサンプルで動作。
 */
export async function fetchEmployeesForSync(): Promise<{
  employees: NormalizedEmployee[];
  excluded: NormalizedEmployee[];
  connected: boolean;
  fetched: number; // jinjerから取得した生レコード数（診断用）
  parsed: number; // 社員番号が取れて正規化できた数
  activeCount: number; // 在籍者数
  retiredCount: number; // 在籍以外（退職等）の数
  rawSampleKeys: string[]; // 先頭レコードの項目名（マッピング診断用）
  rawSample: Record<string, unknown> | null; // 先頭レコードそのもの（マッピング診断用）
}> {
  const raw = jinjerConnected ? await fetchRawEmployees() : SAMPLE_RAW;
  const all = raw.map(normalize).filter((e): e is NormalizedEmployee => e !== null);
  const active = all.filter((e) => isActive(e.status));
  const employees = active.filter((e) => !EXCLUDED_DIVISIONS.includes(e.division));
  const excluded = active.filter((e) => EXCLUDED_DIVISIONS.includes(e.division));
  const rawSample = raw[0] ?? null;
  const rawSampleKeys = rawSample ? Object.keys(rawSample) : [];
  return {
    employees,
    excluded,
    connected: jinjerConnected,
    fetched: raw.length,
    parsed: all.length,
    activeCount: active.length,
    retiredCount: all.length - active.length,
    rawSampleKeys,
    rawSample,
  };
}
