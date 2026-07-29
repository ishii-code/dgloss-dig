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
  division: string; // 事業部/部署（/v1/employees/affiliations の主務 department 名）
  position: string; // 役職
  employmentType: "正社員" | "アルバイト";
  joinedOn: string; // YYYY-MM-DD
  status: string; // 在籍状況（在籍/退職 等）
  basePay: number; // 基本給(月給)（/v1/employees/salaries の salary_units より）
}

// ── 実API ─────────────────────────────
// トークンは4h有効。呼び出しごとの再取得を避けるためプロセス内でキャッシュする。
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const token = await requestToken();
  tokenCache = { token, expiresAt: Date.now() + 3 * 60 * 60 * 1000 }; // 3h（4h有効の余裕）
  return token;
}

async function requestToken(): Promise<string> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET して JSON を返す。jinjer は稀に 200 でも非JSON本文（"An error occurred…"
 * 等の一時エラー/レート制限）を返すため、非JSON/例外時は最大 tries 回リトライする。
 */
async function fetchJson(
  url: string,
  headers: Record<string, string>,
  tries = 3,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  let last: { ok: boolean; status: number; json: unknown; text: string } = { ok: false, status: 0, json: null, text: "" };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "GET", headers });
      const text = await res.text();
      try {
        return { ok: res.ok, status: res.status, json: JSON.parse(text), text };
      } catch {
        last = { ok: res.ok, status: res.status, json: null, text };
      }
    } catch (e) {
      last = { ok: false, status: 0, json: null, text: String(e).slice(0, 200) };
    }
    if (i < tries - 1) await sleep(500 * (i + 1)); // 0.5s, 1s とバックオフ
  }
  return last;
}

/**
 * ページング取得の共通処理（page のみ・非JSON耐性・重複排除で終端）。
 * jinjer /v1/* は limit を受け付けない（E400QP0023）ため page のみ。
 * 2ページ目以降のエラー/非JSONは終端扱いで部分取得を許容する。
 */
async function fetchPagedList(
  path: string,
  headers: Record<string, string>,
  keyOf: (it: Record<string, unknown>) => string,
  tries = 3,
): Promise<Record<string, unknown>[]> {
  const sep = path.includes("?") ? "&" : "?";
  const seen = new Set<string>();
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page++) {
    const r = await fetchJson(`${JINJER_BASE}${path}${sep}page=${page}`, headers, tries);
    if (!r.ok || r.json === null) {
      if (page === 1) throw new Error(`jinjer ${path} ${r.status}: ${r.text.slice(0, 300)}`);
      break;
    }
    const list = extractList(r.json);
    if (list.length === 0) break;
    let added = 0;
    for (const it of list) {
      const key = keyOf(it);
      if (!seen.has(key)) { seen.add(key); all.push(it); added += 1; }
    }
    if (added === 0) break;
  }
  return all;
}

async function fetchRawEmployees(): Promise<Record<string, unknown>[]> {
  const token = await getToken();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  return fetchPagedList("/v1/employees", headers, (item) =>
    String(item["employee_code"] ?? item["emp_code"] ?? item["code"] ?? item["id"] ?? JSON.stringify(item)),
  );
}

// ── 正規化（jinjerのフィールド名は複数候補にフォールバック）──
function pick(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

// Member.position の Prisma enum（Position）に一致する値のみ許可。
const VALID_POSITIONS = new Set(["部長", "マネージャー", "リーダー", "メンバー"]);

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
  // 役職(Position enum: 部長/マネージャー/リーダー/メンバー)。jinjer に役職が無いので、
  // 既知値のときのみ採用し、それ以外（雇用区分など）は既定「メンバー」にする。
  const posRaw = pick(company, "position_name", "position");
  const position = VALID_POSITIONS.has(posRaw) ? posRaw : "メンバー";

  // division/basePay は別エンドポイント（affiliations/salaries）で後から補完する。
  return { personId, name, division, position, employmentType, joinedOn, status, basePay: 0 };
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

/** /v1/employees/xxx 系の全ページ取得（page のみ・重複排除で終端）。 */
// 補完（所属/給与）はタイムアウト防止のため高速フェイル（tries=1）。
// jinがレート制限気味でも取込自体を止めない（部署/給与は取れた分だけ反映）。
async function fetchPaged(path: string, headers: Record<string, string>): Promise<Record<string, unknown>[]> {
  return fetchPagedList(path, headers, (it) => String(it["employee_id"] ?? it["id"] ?? JSON.stringify(it)), 1);
}

/** 所属レコード1件 → 主務の所属部署名（未選択は空）。 */
function parseAffiliation(r: Record<string, unknown>): string {
  const affs = Array.isArray(r["affiliations"]) ? (r["affiliations"] as Record<string, unknown>[]) : [];
  // 主務＝先頭の所属。department:{id,name}。
  const name = pick(asObj(affs[0]?.["department"]), "name");
  return name && name !== "未選択" ? name : "";
}

/** 給与レコード1件 → 基本給(月給)（最新改定の salary_units より）。 */
function parseBasePay(r: Record<string, unknown>): number {
  const sals = Array.isArray(r["salaries"]) ? (r["salaries"] as Record<string, unknown>[]) : [];
  // 最新の改定（revised_on 降順）を採用。
  const latest = sals.slice().sort((a, b) => pick(b, "revised_on").localeCompare(pick(a, "revised_on")))[0];
  const units = latest && Array.isArray(latest["salary_units"]) ? (latest["salary_units"] as Record<string, unknown>[]) : [];
  const valueOf = (pred: (label: string) => boolean): number => {
    const u = units.find((x) => pred(pick(x, "label")));
    return u ? Number(u["value"]) || 0 : 0;
  };
  // 基本給(月給) を優先、無ければ 基本給 を含むもの。
  return valueOf((l) => l.includes("基本給") && l.includes("月給")) || valueOf((l) => l.includes("基本給"));
}

export type EnrichKind = "affiliations" | "salaries";

export interface EnrichRow {
  personId: string;
  division?: string;
  basePay?: number;
}

/**
 * 所属/給与を「1ページだけ」取得して正規化する（タイムアウト回避のため細分化）。
 * 呼び出し側がページを進めながら繰り返し呼ぶ。
 */
export async function fetchEnrichPage(
  kind: EnrichKind,
  page: number,
): Promise<{ ok: boolean; status: number; count: number; rows: EnrichRow[]; error?: string }> {
  if (!jinjerConnected) return { ok: false, status: 0, count: 0, rows: [], error: "jinjer未接続（APIキー未設定）" };
  const token = await getToken();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const r = await fetchJson(`${JINJER_BASE}/v1/employees/${kind}?page=${page}`, headers, 2);
  if (!r.ok || r.json === null) {
    return { ok: false, status: r.status, count: 0, rows: [], error: r.text.slice(0, 200) };
  }
  const list = extractList(r.json);
  const rows: EnrichRow[] = [];
  for (const it of list) {
    const personId = pick(it, "employee_id", "id");
    if (!personId) continue;
    if (kind === "affiliations") {
      const division = parseAffiliation(it);
      if (division) rows.push({ personId, division });
    } else {
      const basePay = parseBasePay(it);
      if (basePay > 0) rows.push({ personId, basePay });
    }
  }
  return { ok: true, status: r.status, count: list.length, rows };
}

/**
 * 所属(部署名)と基本給のマップをまとめて取得（一括版・小規模向け）。
 * 大量件数ではタイムアウトするため、通常は fetchEnrichPage を使う。
 */
export async function fetchOrgSalaryMaps(): Promise<{
  affMap: Map<string, string>;
  salMap: Map<string, number>;
}> {
  if (!jinjerConnected) return { affMap: new Map(), salMap: new Map() };
  const affMap = new Map<string, string>();
  const salMap = new Map<string, number>();
  for (let page = 1; page <= 100; page++) {
    const r = await fetchEnrichPage("affiliations", page).catch(() => null);
    if (!r || !r.ok || r.count === 0) break;
    for (const row of r.rows) if (row.division) affMap.set(row.personId, row.division);
  }
  for (let page = 1; page <= 100; page++) {
    const r = await fetchEnrichPage("salaries", page).catch(() => null);
    if (!r || !r.ok || r.count === 0) break;
    for (const row of r.rows) if (row.basePay) salMap.set(row.personId, row.basePay);
  }
  return { affMap, salMap };
}

/**
 * jinjerから従業員を取得して正規化し、在籍者のみを対象にする。
 * 部署(division)は /v1/employees/affiliations、基本給(basePay)は
 * /v1/employees/salaries から補完する。CRM事業部・管理本部は除外。
 * 未接続時はサンプルで動作。
 */
export async function fetchEmployeesForSync(): Promise<{
  employees: NormalizedEmployee[];
  excluded: NormalizedEmployee[];
  connected: boolean;
  fetched: number; // jinjerから取得した生レコード数（診断用）
  parsed: number; // 社員番号が取れて正規化できた数
  activeCount: number; // 在籍者数
  retiredCount: number; // 在籍以外（退職等）の数
  departmentCounts: Record<string, number>; // 在籍者の部署別人数（AIテレアポ名確認用）
  rawSampleKeys: string[]; // 先頭レコードの項目名（マッピング診断用）
  rawSample: Record<string, unknown> | null; // 先頭レコードそのもの（マッピング診断用）
}> {
  // 基本同期は従業員のみを取得（軽量・確実）。部署/給与は別処理
  // (enrichMembersFromJinjer) で反映し、タイムアウトを避ける。
  const raw = jinjerConnected ? await fetchRawEmployees() : SAMPLE_RAW;
  const all = raw.map(normalize).filter((e): e is NormalizedEmployee => e !== null);

  const active = all.filter((e) => isActive(e.status));
  const employees = active.filter((e) => !EXCLUDED_DIVISIONS.includes(e.division));
  const excluded = active.filter((e) => EXCLUDED_DIVISIONS.includes(e.division));

  const departmentCounts: Record<string, number> = {};
  for (const e of active) {
    const key = e.division || "(部署なし)";
    departmentCounts[key] = (departmentCounts[key] ?? 0) + 1;
  }

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
    departmentCounts,
    rawSampleKeys,
    rawSample,
  };
}

// ── 組織/部署API 調査（診断） ─────────────────────────
// jinjer の部署(事業部)取得エンドポイントとレスポンス構造が不明なため、
// 候補エンドポイントを順に叩いて、どれが有効か・構造はどうかを可視化する。
function truncate(v: unknown, n = 600): unknown {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : v;
}

interface ProbeResult {
  path: string;
  status: number;
  ok: boolean;
  count: number;
  keys: string[];
  sample: unknown;
}

async function probePath(
  path: string,
  headers: Record<string, string>,
): Promise<ProbeResult> {
  try {
    const res = await fetch(`${JINJER_BASE}${path}`, { method: "GET", headers });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    const list = extractList(body);
    const first = list[0] ?? (Array.isArray(body) ? undefined : body);
    const keys = first && typeof first === "object" ? Object.keys(first as Record<string, unknown>) : [];
    return { path, status: res.status, ok: res.ok, count: list.length, keys, sample: truncate(first ?? body) };
  } catch (e) {
    return { path, status: 0, ok: false, count: 0, keys: [], sample: String(e).slice(0, 120) };
  }
}

export async function probeJinjerOrg(): Promise<{
  connected: boolean;
  results: ProbeResult[];
}> {
  if (!jinjerConnected) return { connected: false, results: [] };
  const token = await getToken();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // 社員↔部署の所属マッピング候補（部署一覧 /v1/departments は判明済み）＋
  // 給与系候補（給与管理者権限の付与後に見えるようになる想定。給与＝基本給/役職ベースの取得元、
  // かつ給与データに所属部署が含まれる可能性もある）。
  const staticCandidates = [
    // 所属（jinjer回答: /v1/employees/affiliations が department=所属グループID を返す）
    "/v1/departments?page=1",
    "/v1/employees/affiliations",
    "/v1/employees/affiliations?page=1",
    // 給与（jinjer回答: 従業員に紐づく給与単価情報。/v1/employees/xxx パターンで探索）
    "/v1/employees/salaries",
    "/v1/employees/unit_prices",
    "/v1/employees/unit_price",
    "/v1/employees/wage_unit_prices",
    "/v1/employees/salary_unit_prices",
    "/v1/employees/wages",
    "/v1/employees/payments",
    "/v1/employees/base_salaries",
    "/v1/employees/compensations",
  ];
  const results: ProbeResult[] = [];
  for (const p of staticCandidates) results.push(await probePath(p, headers));

  // 部署詳細と部署メンバー（先頭部署IDを使う）。
  try {
    const deps = await fetch(`${JINJER_BASE}/v1/departments?page=1`, { method: "GET", headers });
    if (deps.ok) {
      const firstDep = extractList(await deps.json())[0] as Record<string, unknown> | undefined;
      const depId = firstDep ? String(firstDep["id"] ?? "") : "";
      if (depId) {
        results.push(await probePath(`/v1/departments/${depId}`, headers));
        results.push(await probePath(`/v1/departments/${depId}/employees`, headers));
        results.push(await probePath(`/v1/departments/${depId}/members`, headers));
      }
    }
  } catch { /* 無視 */ }

  // 従業員に紐づく所属（先頭社員IDを使う）。
  try {
    const emps = await fetch(`${JINJER_BASE}/v1/employees?page=1`, { method: "GET", headers });
    if (emps.ok) {
      const firstEmp = extractList(await emps.json())[0] as Record<string, unknown> | undefined;
      const empId = firstEmp ? String(firstEmp["id"] ?? "") : "";
      if (empId) {
        results.push(await probePath(`/v1/employees/${empId}/departments`, headers));
        results.push(await probePath(`/v1/employees/${empId}/affiliations`, headers));
      }
    }
  } catch { /* 無視 */ }

  return { connected: jinjerConnected, results };
}
