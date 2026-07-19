/**
 * jinjer（勤怠管理）コネクタ。従業員マスタを自動連携。
 * API: base https://api.jinjer.biz
 *   認証:  GET /v2/token  ヘッダ X-API-KEY / X-SECRET-KEY → data.access_token（4h有効）
 *   従業員: GET /v1/employees  ヘッダ Authorization: Bearer <token>
 *
 * 本番: JINJER_API_KEY / JINJER_SECRET_KEY を設定すると実APIから取得。
 * 未設定時: 下記サンプルで同期ロジック（除外フィルタ・upsert）を検証。
 *
 * 取込対象: CRM事業部・管理本部 以外の全員（EXCLUDED_DIVISIONS）。
 */

const JINJER_BASE = process.env.JINJER_API_BASE ?? "https://api.jinjer.biz";
export const jinjerConnected = Boolean(
  process.env.JINJER_API_KEY && process.env.JINJER_SECRET_KEY,
);

/** 取込から除外する事業部/部署 */
export const EXCLUDED_DIVISIONS = ["CRM事業部", "管理本部"];

/** dgloss 従業員マスタ向けに正規化した形 */
export interface NormalizedEmployee {
  personId: string; // 社員番号
  name: string;
  division: string; // 事業部/部署
  position: string; // 役職
  employmentType: "正社員" | "アルバイト";
  joinedOn: string; // YYYY-MM-DD
}

// ── 実API ─────────────────────────────
async function getToken(): Promise<string> {
  const res = await fetch(`${JINJER_BASE}/v2/token`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.JINJER_API_KEY ?? "",
      "X-SECRET-KEY": process.env.JINJER_SECRET_KEY ?? "",
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

/** 全ページ取得（200名でも取り切る）。page/limit を増やしつつ重複排除で終端検出。 */
async function fetchRawEmployees(): Promise<Record<string, unknown>[]> {
  const token = await getToken();
  const limit = 100;
  const seen = new Set<string>();
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${JINJER_BASE}/v1/employees?limit=${limit}&page=${page}`, {
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
    // ページングが効いていない/最終ページなら終了
    if (list.length < limit || added === 0) break;
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

function normalize(o: Record<string, unknown>): NormalizedEmployee | null {
  const personId = pick(o, "employee_code", "emp_code", "code", "staff_code");
  if (!personId) return null;
  const name =
    pick(o, "full_name", "name") ||
    `${pick(o, "last_name", "family_name")}${pick(o, "first_name", "given_name")}`.trim();
  const division = pick(o, "group_name", "department_name", "busho", "division", "事業部");
  const position = pick(o, "position_name", "position", "役職");
  const empRaw = pick(o, "employment_type", "employment_status", "雇用形態");
  const employmentType: "正社員" | "アルバイト" =
    empRaw.includes("アルバイト") || empRaw.includes("パート") || empRaw.toLowerCase().includes("part")
      ? "アルバイト"
      : "正社員";
  const joinedRaw = pick(o, "enter_date", "hire_date", "join_date", "入社日");
  const joinedOn = joinedRaw ? joinedRaw.slice(0, 10) : "2020-01-01";
  return { personId, name: name || personId, division, position: position || "メンバー", employmentType, joinedOn };
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

/**
 * jinjerから従業員を取得し、CRM事業部・管理本部を除外して正規化。
 * 未接続時はサンプルで動作。
 */
export async function fetchEmployeesForSync(): Promise<{
  employees: NormalizedEmployee[];
  excluded: NormalizedEmployee[];
  connected: boolean;
  fetched: number; // jinjerから取得した生レコード数（診断用）
  parsed: number; // 社員番号が取れて正規化できた数
}> {
  const raw = jinjerConnected ? await fetchRawEmployees() : SAMPLE_RAW;
  const all = raw.map(normalize).filter((e): e is NormalizedEmployee => e !== null);
  const employees = all.filter((e) => !EXCLUDED_DIVISIONS.includes(e.division));
  const excluded = all.filter((e) => EXCLUDED_DIVISIONS.includes(e.division));
  return { employees, excluded, connected: jinjerConnected, fetched: raw.length, parsed: all.length };
}
