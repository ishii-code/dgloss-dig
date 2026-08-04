/**
 * 契約管理（keiyaku-kanri-next / Supabase Postgres）読み取り専用クライアント＋同期。
 * CG-CRM（ishii-code/dgloss-cg の src/lib/contract/client.ts・sync.ts）と同一方式：
 * 「金額を含む VIEW」cg_customer_master を SELECT のみで読み、こちら側の Contract へ取込む。
 *
 * READ-ONLY：契約管理DBには一切書き込まない（SELECT のみ）。
 * env-gated：CONTRACT_DB_URL 未設定なら isContractDbConfigured()=false で同期は no-op。
 *
 * 期待カラム（存在する列だけ拾うので、無い列があっても動く）：
 *   customer_id / customer_code / customer_name / owner / billing_mail / billing_tel /
 *   instance_id / tenant_id / contract_id / contract_no / status / model_key /
 *   start_date / end_date / plan / base_amount / bpo_fixed / monthly_total /
 *   initial_fee / setup_fee / pay_method / term_months / contract_date / auto_renew /
 *   early_cancel_flag（途中解約フラグ）/ canceled_on（解約日）
 *
 * 途中解約フラグの列名は EARLY_CANCEL_COLUMNS の候補から自動で拾う。
 * 実際の列名が候補に無い場合は CONTRACT_EARLY_CANCEL_COLUMN で明示する。
 */
import { Pool } from "pg";
import { prisma } from "./db";

/** cg_customer_master VIEW の1行（契約単位）。 */
export interface ContractMasterRow {
  customerId: string; // customers.id（UUID・グルーピングキー）
  customerCode: string | null; // 人が見る顧客ID（例 C2606000811）
  customerName: string;
  owner: string | null; // 営業担当
  billingMail: string | null;
  billingTel: string | null;
  instanceId: string | null; // Amazon Connect インスタンスID
  tenantId: string | null; // contracts.tenant_id
  contractId: string | null; // contracts.id（あれば取込キーに使う）
  contractNo: string | null;
  status: string | null; // active / post_sign / expired / canceled / …
  modelKey: string | null; // 課金形態（例 license_line）
  startDate: string | null;
  endDate: string | null;
  plan: string | null; // 契約形態
  baseAmount: number | null; // 基本月額
  bpoFixed: number | null; // BPO固定費
  monthlyTotal: number | null; // 月額合計（base+bpo）
  initialFee: number | null;
  setupFee: number | null;
  payMethod: string | null;
  termMonths: number | null;
  contractDate: string | null; // 契約締結日
  autoRenew: string | null;
  /** 途中解約フラグ（契約管理DB側で立てる） */
  earlyCancel: boolean;
  /** 解約日 */
  canceledOn: string | null;
}

/**
 * 途中解約フラグの列名候補。契約管理DB側の命名が決まったら
 * CONTRACT_EARLY_CANCEL_COLUMN で明示指定できる（候補より優先）。
 */
const EARLY_CANCEL_COLUMNS = [
  "early_cancel_flag",
  "early_cancel",
  "is_early_cancel",
  "mid_term_cancel",
  "churn_flag",
  "途中解約フラグ",
];

/** 解約日の列名候補。 */
const CANCELED_ON_COLUMNS = ["canceled_on", "canceled_at", "cancel_date", "cancelled_on", "解約日"];

/** 契約管理DBが設定済みか（読み取り専用URLの有無）。 */
export function isContractDbConfigured(): boolean {
  return !!process.env.CONTRACT_DB_URL;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** numeric/bigint は文字列で来るため許容して数値化。 */
function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** boolean/文字列/数値のどれで来ても真偽に寄せる（'t' / 'true' / 1 / 'yes' を真とする）。 */
function asBoolean(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return ["t", "true", "1", "y", "yes", "はい", "有"].includes(String(v).trim().toLowerCase());
}

/** 候補列のうち最初に存在した列の値を返す。 */
function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) {
    if (c in row && row[c] !== null && row[c] !== undefined) return row[c];
  }
  return null;
}

/** SQL識別子として安全な VIEW 名のみ許可（英数・アンダースコア・ドット）。 */
function safeViewName(raw: string | undefined): string {
  const name = (raw ?? "cg_customer_master").trim();
  return /^[A-Za-z0-9_.]+$/.test(name) ? name : "cg_customer_master";
}

function mapRow(row: Record<string, unknown>): ContractMasterRow {
  const base = asNumberOrNull(row.base_amount);
  const bpo = asNumberOrNull(row.bpo_fixed);
  return {
    customerId: asStringOrNull(row.customer_id) ?? asStringOrNull(row.id) ?? "",
    customerCode: asStringOrNull(row.customer_code),
    customerName: asStringOrNull(row.customer_name) ?? asStringOrNull(row.name) ?? "",
    owner: asStringOrNull(row.owner),
    billingMail: asStringOrNull(row.billing_mail),
    billingTel: asStringOrNull(row.billing_tel),
    instanceId: asStringOrNull(row.instance_id),
    tenantId: asStringOrNull(row.tenant_id),
    contractId: asStringOrNull(row.contract_id),
    contractNo: asStringOrNull(row.contract_no),
    status: asStringOrNull(row.status),
    modelKey: asStringOrNull(row.model_key),
    startDate: asStringOrNull(row.start_date),
    endDate: asStringOrNull(row.end_date),
    plan: asStringOrNull(row.plan),
    baseAmount: base,
    bpoFixed: bpo,
    monthlyTotal: asNumberOrNull(row.monthly_total) ?? ((base ?? 0) + (bpo ?? 0) || null),
    initialFee: asNumberOrNull(row.initial_fee),
    setupFee: asNumberOrNull(row.setup_fee),
    payMethod: asStringOrNull(row.pay_method),
    termMonths: asNumberOrNull(row.term_months),
    contractDate: asStringOrNull(row.contract_date),
    autoRenew: asStringOrNull(row.auto_renew),
    earlyCancel: resolveEarlyCancel(row),
    canceledOn: asStringOrNull(pick(row, CANCELED_ON_COLUMNS)),
  };
}

/**
 * 途中解約かどうか。契約管理DB側のフラグを正とし、フラグ列がまだ無い間だけ
 * 「解約済み かつ 契約満了前に解約日がある」で暫定判定する。
 */
function resolveEarlyCancel(row: Record<string, unknown>): boolean {
  const explicit = process.env.CONTRACT_EARLY_CANCEL_COLUMN;
  if (explicit && explicit in row) return asBoolean(row[explicit]);

  const flag = pick(row, EARLY_CANCEL_COLUMNS);
  if (flag !== null) return asBoolean(flag);

  // フォールバック（フラグ列が未整備の間）。
  const status = (asStringOrNull(row.status) ?? "").toLowerCase();
  if (!/cancel|解約/.test(status)) return false;
  const canceled = toDate(asStringOrNull(pick(row, CANCELED_ON_COLUMNS)));
  const end = toDate(asStringOrNull(row.end_date));
  if (!canceled || !end) return false;
  return canceled.getTime() < end.getTime();
}

/**
 * 契約管理VIEW を SELECT のみで取得する。接続はこの関数内で開いて必ず閉じる。
 * エラー時は接続URL・スタックを含まない Error を投げる。
 */
export async function readContractMaster(): Promise<ContractMasterRow[]> {
  const connectionString = process.env.CONTRACT_DB_URL;
  if (!connectionString) return []; // 事前ガードされる想定だが防御的に空。

  const view = safeViewName(process.env.CONTRACT_VIEW);
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 2 });
  try {
    const res = await pool.query(`SELECT * FROM ${view}`);
    return res.rows.map((row: Record<string, unknown>) => mapRow(row));
  } catch {
    throw new Error("契約管理DBの読み取りに失敗しました");
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────
// 事業部の判定（契約管理VIEWに事業部列が無いため、課金形態から寄せる）
// ─────────────────────────────────────────────
/** 既定の事業部。CONTRACT_DEFAULT_DIVISION で上書きできる。 */
const defaultDivision = () => process.env.CONTRACT_DEFAULT_DIVISION || "AIテレアポ事業部";

/** model_key / plan から事業部を推定する（未知は既定へ）。 */
export function resolveContractDivision(row: ContractMasterRow): string {
  const key = `${row.modelKey ?? ""} ${row.plan ?? ""}`.toLowerCase();
  if (/license|line|call|テレアポ|荷電/.test(key)) return "AIテレアポ事業部";
  if (/crm|account|カスタマー/.test(key)) return "CRM事業部";
  return defaultDivision();
}

/** 取込キー。contract_id → contract_no → customer#tenant の順で決める。 */
function contractKey(row: ContractMasterRow, seq: number): string {
  if (row.contractId) return row.contractId;
  if (row.contractNo) return row.contractNo;
  const suffix = row.tenantId ?? String(seq);
  return `${row.customerId || row.customerName}#${suffix}`;
}

function toDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 反映対象月。契約開始日（無ければ締結日、無ければ当月）の年月。 */
function yearMonthOf(row: ContractMasterRow): string {
  const d = toDate(row.startDate) ?? toDate(row.contractDate) ?? new Date();
  return d.toISOString().slice(0, 7);
}

export interface ContractSyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  /** 事業部別の取込件数（確認用） */
  byDivision: Record<string, number>;
}

/**
 * 契約管理VIEW → Dig評価の Contract キャッシュへ同期。
 * READ-ONLY で読み、書き込むのは自分側の Contract だけ（ContractAssignment は触らない）。
 * 1行の失敗は skipped に数えて続行する。
 */
export async function syncContractsFromContractDb(): Promise<ContractSyncResult> {
  const result: ContractSyncResult = { fetched: 0, created: 0, updated: 0, skipped: 0, byDivision: {} };
  if (!isContractDbConfigured()) return result;

  const master = await readContractMaster();
  result.fetched = master.length;

  for (const [i, row] of master.entries()) {
    try {
      if (!row.customerName && !row.customerCode) {
        result.skipped++;
        continue;
      }
      const id = contractKey(row, i);
      const division = resolveContractDivision(row);
      const data = {
        contractNo: row.contractNo,
        customerName: row.customerName || row.customerCode || "(no name)",
        // 顧客ID＝業務コード（例 C2606000811）。無ければUUIDへフォールバック。
        companyId: row.customerCode ?? (row.customerId || null),
        division,
        modelKey: row.modelKey ?? row.plan ?? "unknown",
        status: row.status ?? "unknown",
        baseAmount: row.monthlyTotal ?? row.baseAmount ?? 0,
        setupFee: row.setupFee ?? 0,
        initialFee: row.initialFee ?? 0,
        termMonths: row.termMonths ?? 0,
        startDate: toDate(row.startDate) ?? toDate(row.contractDate),
        // VIEW に明細（回線数・コール数）が無いため空。回線コール単価ルールの算定には別途明細が必要。
        lineItems: [],
        yearMonth: yearMonthOf(row),
        // 途中解約フラグは契約管理DBを正とする。確定済みのマイナスDig（churnDig）は上書きしない。
        earlyCancel: row.earlyCancel,
        canceledOn: toDate(row.canceledOn),
      };
      const existing = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
      if (existing) {
        await prisma.contract.update({ where: { id }, data });
        result.updated++;
      } else {
        await prisma.contract.create({ data: { id, ...data } });
        result.created++;
      }
      result.byDivision[division] = (result.byDivision[division] ?? 0) + 1;
    } catch {
      // 1件の失敗で全体を止めない（詳細はレスポンスに出さない）。
      result.skipped++;
    }
  }
  return result;
}

/**
 * 顧客ID（customer_code / customer_id / contract_no）で契約管理VIEWを直接引く。
 * Dig申請フォームで、まだ同期されていない契約もその場で参照できるようにするための即時参照。
 */
export async function findContractMasterByCustomer(query: string): Promise<ContractMasterRow[]> {
  if (!isContractDbConfigured()) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const master = await readContractMaster();
  return master.filter(
    (r) =>
      (r.customerCode ?? "").toLowerCase() === q ||
      (r.customerId ?? "").toLowerCase() === q ||
      (r.contractNo ?? "").toLowerCase() === q ||
      (r.contractId ?? "").toLowerCase() === q ||
      (r.tenantId ?? "").toLowerCase() === q ||
      (r.customerName ?? "").toLowerCase().includes(q),
  );
}
