import { man, pct, rankStyle, rateColor } from "@/lib/format";

// ── ヘッダ（社内システム: ロゴ左上・BRAND §2） ──
export function Header() {
  return (
    <header className="border-b border-surface-border bg-white">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="bg-gradient-to-br from-brand-primary to-brand-accent bg-clip-text text-xl font-bold text-transparent">
            dgloss
          </span>
          <span className="text-ink-faint">/</span>
          <span className="text-[15px] font-bold text-ink">Dig評価</span>
          <span className="rounded-pill bg-blue-50 px-2 py-0.5 text-xs font-semibold text-brand-primary">
            v0.1.0
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-muted">
          <span className="hidden sm:inline">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-semantic-success align-middle" />
            takeshi.ishii@dgloss.co.jp
          </span>
          <span className="hidden text-brand-primary sm:inline">サインアウト</span>
          <span>データ更新: 2026-01-31 05:04</span>
        </div>
      </div>
    </header>
  );
}

// ── タブナビ（BRAND: アクティブ青下線） ──
export interface Tab {
  key: string;
  label: string;
  sub: string;
}

export function TabNav({
  tabs,
  active,
  onSelect,
}: {
  tabs: Tab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="border-b border-surface-border bg-white">
      <div className="mx-auto flex max-w-[1200px] gap-6 overflow-x-auto px-6">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              onClick={() => onSelect(t.key)}
              className={`relative whitespace-nowrap py-3 text-left ${on ? "text-brand-primary" : "text-ink"}`}
            >
              <div className="text-[15px] font-bold">{t.label}</div>
              <div className="text-[11px] text-ink-faint">{t.sub}</div>
              {on && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-brand-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── セクション見出し（左アクセントバー） ──
export function SectionHeader({
  title,
  note,
  accent = "primary",
}: {
  title: string;
  note?: string;
  accent?: "primary" | "accent";
}) {
  const bar = accent === "primary" ? "bg-brand-primary" : "bg-brand-accent";
  return (
    <div className="mb-3 mt-8 flex items-center gap-2">
      <span className={`inline-block h-4 w-1 rounded ${bar}`} />
      <h2 className="text-[17px] font-bold text-ink">{title}</h2>
      {note && <span className="text-xs text-ink-muted">{note}</span>}
    </div>
  );
}

// ── プログレスバー ──
export function ProgressBar({
  rate,
  color = "primary",
}: {
  rate: number;
  color?: "primary" | "accent";
}) {
  const w = Math.min(Math.max(rate, 0), 1) * 100;
  const bg = color === "primary" ? "bg-brand-primary" : "bg-brand-accent";
  return (
    <div className="relative h-1.5 w-full rounded-pill bg-surface-panel">
      <div className={`h-full rounded-pill ${bg}`} style={{ width: `${w}%` }} />
      <span className="absolute right-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink-faint" />
    </div>
  );
}

// ── 大カード（全社KPI） ──
export function BigMetricCard({
  label,
  value,
  rate,
  budget,
  actual,
  diff,
  color = "primary",
}: {
  label: string;
  value: string;
  rate?: number;
  budget: string;
  actual: string;
  diff: number;
  color?: "primary" | "accent";
}) {
  const ring = color === "primary" ? "border-surface-border" : "border-violet-200";
  return (
    <div className={`rounded-card border ${ring} bg-white p-6 shadow-card`}>
      <div className="flex items-start justify-between">
        <div className="text-sm text-ink-muted">{label}</div>
        {rate !== undefined && (
          <div className="text-right">
            <div className="text-[11px] text-ink-faint">達成見込み</div>
            <div className={`text-2xl font-bold ${rateColor(rate)}`}>{pct(rate)}</div>
          </div>
        )}
      </div>
      <div className="tabular mt-2 text-4xl font-bold text-ink">{value}</div>
      <div className="tabular mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
        <span>予算 {budget}</span>
        <span>実績 {actual}</span>
        <span className={diff < 0 ? "text-semantic-danger" : "text-semantic-success"}>
          差異 {diff < 0 ? "▲" : "+"}
          {man(Math.abs(diff))}
        </span>
      </div>
      <div className="mt-4">
        <ProgressBar rate={rate ?? 0} color={color} />
      </div>
    </div>
  );
}

// ── 小カード（事業部別） ──
export function DivisionCard({
  division,
  value,
  rate,
  budget,
  diff,
}: {
  division: string;
  value: string;
  rate: number;
  budget: string;
  diff: number;
}) {
  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between">
        <div className="text-sm font-semibold text-ink">{division}</div>
        <div className="text-right">
          <div className="text-[10px] text-ink-faint">達成見込み</div>
          <div className={`text-lg font-bold ${rateColor(rate)}`}>{pct(rate)}</div>
        </div>
      </div>
      <div className="tabular mt-1 text-2xl font-bold text-ink">{value}</div>
      <div className="tabular mt-2 text-[11px] text-ink-muted">
        予算 {budget}
        <span className={`ml-3 ${diff < 0 ? "text-semantic-danger" : "text-semantic-success"}`}>
          差異 {diff < 0 ? "▲" : "+"}
          {man(Math.abs(diff))}
        </span>
      </div>
      <div className="mt-3">
        <ProgressBar rate={rate} />
      </div>
    </div>
  );
}

// ── ランクバッジ ──
export function RankBadge({ rank }: { rank: string }) {
  return (
    <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${rankStyle(rank)}`}>
      {rank}
    </span>
  );
}
