/**
 * 会計年度・四半期のユーティリティ。
 * 会計年度は 7 月始まり（FY ラベル＝開始年）。
 *   1Q=7-9月 / 2Q=10-12月 / 3Q=1-3月 / 4Q=4-6月
 * 例: 2026-01 は FY2025 の 3Q（"2025-3Q"）。
 * ※ 期首を変える場合は FISCAL_START_MONTH のみ変更すればよい。
 */
export const FISCAL_START_MONTH = 7; // 1-12

/** ym(YYYY-MM) → 会計年度(開始年)と四半期(1-4)。 */
export function fiscalOf(ym: string): { fyYear: number; quarter: number } {
  const [y, m] = ym.split("-").map(Number);
  const fiscalIdx = (m - FISCAL_START_MONTH + 12) % 12; // 0..11（期首=0）
  const quarter = Math.floor(fiscalIdx / 3) + 1;
  const fyYear = m >= FISCAL_START_MONTH ? y : y - 1;
  return { fyYear, quarter };
}

/** 会計年度・四半期ラベル（例: "2025-3Q"）。 */
export function quarterLabel(fyYear: number, quarter: number): string {
  return `${fyYear}-${quarter}Q`;
}

/** ym → 四半期ラベル。 */
export function quarterLabelOf(ym: string): string {
  const { fyYear, quarter } = fiscalOf(ym);
  return quarterLabel(fyYear, quarter);
}

/** 会計年度・四半期 → その3ヶ月の ym 配列（昇順）。 */
export function monthsOfQuarter(fyYear: number, quarter: number): string[] {
  const base = FISCAL_START_MONTH - 1 + (quarter - 1) * 3; // 0基点の会計月
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const n = base + i;
    const monthIdx = n % 12; // 0..11
    const year = fyYear + Math.floor(n / 12);
    out.push(`${year}-${String(monthIdx + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface QuarterOption {
  fyYear: number;
  quarter: number;
  label: string;
}

/**
 * セレクタ用の四半期一覧。基準 ym を含む会計年度を中心に、
 * 過去 spanYears 年ぶん〜当年までの全四半期を新しい順で返す。
 */
export function quarterOptions(centerYm: string, spanYears = 2): QuarterOption[] {
  const { fyYear } = fiscalOf(centerYm);
  const out: QuarterOption[] = [];
  for (let fy = fyYear; fy >= fyYear - spanYears; fy--) {
    for (let q = 4; q >= 1; q--) {
      out.push({ fyYear: fy, quarter: q, label: quarterLabel(fy, q) });
    }
  }
  return out;
}

/** 月表示ラベル（例: 2026-01 → "2026年1月"）。 */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}
