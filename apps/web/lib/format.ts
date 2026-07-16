/** 金額(Dig=円)を「◯◯万Dig」表記に。1 Dig = 1円。 */
export function man(value: number): string {
  const man = Math.round(value / 10_000);
  return `${man.toLocaleString("ja-JP")}万Dig`;
}

/** 生の円をカンマ区切りに。 */
export function yen(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}`;
}

/** 達成率(0..1)を「85%」表記に。 */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 達成率で色（BRAND セマンティック）。 */
export function rateColor(rate: number): string {
  if (rate >= 1) return "text-semantic-success";
  if (rate >= 0.8) return "text-semantic-warn";
  return "text-semantic-danger";
}

/** 評価ランクのバッジ配色。 */
export function rankStyle(rank: string): string {
  switch (rank) {
    case "S":
      return "bg-violet-100 text-brand-accent";
    case "A":
      return "bg-blue-100 text-brand-primary";
    case "B":
      return "bg-emerald-100 text-semantic-success";
    case "C":
      return "bg-amber-100 text-semantic-warn";
    default:
      return "bg-rose-100 text-semantic-danger";
  }
}
