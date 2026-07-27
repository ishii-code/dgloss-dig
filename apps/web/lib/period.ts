/**
 * 会計年度・四半期のユーティリティ。
 * 会計年度は 6 月始まり（FY ラベル＝開始年）。
 *   1Q=6-8月 / 2Q=9-11月 / 3Q=12-2月 / 4Q=3-5月
 * 例: 2026-01 は FY2025 の 3Q（"2025-3Q"）。
 * ※ 期首を変える場合は FISCAL_START_MONTH のみ変更すればよい。
 */
export const FISCAL_START_MONTH = 6; // 1-12

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
 * セレクタ用の四半期一覧。基準 ym の四半期を先頭に、そこから
 * 過去へ count 個ぶんを新しい順で返す（未来の四半期は含めない）。
 */
export function quarterOptions(anchorYm: string, count = 12): QuarterOption[] {
  let { fyYear, quarter } = fiscalOf(anchorYm);
  const out: QuarterOption[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ fyYear, quarter, label: quarterLabel(fyYear, quarter) });
    quarter -= 1;
    if (quarter < 1) {
      quarter = 4;
      fyYear -= 1;
    }
  }
  return out;
}

/** 現在の年月（YYYY-MM）。クライアントのローカル時刻基準。 */
export function currentYm(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 月表示ラベル（例: 2026-01 → "2026年1月"）。 */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}
