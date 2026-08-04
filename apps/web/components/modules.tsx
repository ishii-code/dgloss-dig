"use client";

import { useEffect, useState } from "react";
import { man, yen } from "@/lib/format";
import { apiGet } from "@/lib/api";
import {
  BONUS_ITEMS,
  BONUS_RECORD_VIEWS,
  BONUS_TOTAL,
  bonusTotalsByMember,
} from "@/lib/bonus";
import { RELEASES, type Release } from "@/lib/releases";
import { netByMember, TXN_TOTAL, TXN_VIEWS } from "@/lib/txn";
import { SectionHeader } from "./ui";

function Pill({ text, on }: { text: string; on: boolean }) {
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-xs font-bold ${
        on ? "bg-emerald-100 text-semantic-success" : "bg-slate-100 text-ink-muted"
      }`}
    >
      {text}
    </span>
  );
}

// ── ボーナスDig（F-4） ──
export function BonusDig() {
  const totals = bonusTotalsByMember();
  return (
    <>
      <SectionHeader
        title="ボーナスDig 集計"
        note="営業以外の貢献（学習・ナレッジ共有・組織貢献等）。月次評価に自動加算。"
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="今月付与合計" value={man(BONUS_TOTAL)} accent />
        <Stat label="付与件数" value={`${BONUS_RECORD_VIEWS.length}件`} />
        <Stat label="有効項目数" value={`${BONUS_ITEMS.filter((i) => i.enabled).length}件`} />
      </div>

      <div className="mb-2 text-sm font-semibold text-ink">項目マスタ</div>
      <div className="mb-6 overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-4 py-2.5 font-semibold">ID</th>
              <th className="px-4 py-2.5 font-semibold">カテゴリ</th>
              <th className="px-4 py-2.5 font-semibold">項目名</th>
              <th className="px-4 py-2.5 text-right font-semibold">付与Dig</th>
              <th className="px-4 py-2.5 text-right font-semibold">上限/月</th>
              <th className="px-4 py-2.5 text-center font-semibold">有効</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {BONUS_ITEMS.map((i) => (
              <tr key={i.itemId} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2.5 text-ink-muted">{i.itemId}</td>
                <td className="px-4 py-2.5 text-ink-muted">{i.category}</td>
                <td className="px-4 py-2.5 font-medium text-ink">{i.name}</td>
                <td className="px-4 py-2.5 text-right">{yen(i.grantDig)}</td>
                <td className="px-4 py-2.5 text-right text-ink-muted">{yen(i.monthlyCapDig)}</td>
                <td className="px-4 py-2.5 text-center">
                  <Pill text={i.enabled ? "ON" : "OFF"} on={i.enabled} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold text-ink">記録一覧</div>
          <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">記録日</th>
                  <th className="px-4 py-2.5 font-semibold">氏名</th>
                  <th className="px-4 py-2.5 font-semibold">項目</th>
                  <th className="px-4 py-2.5 text-right font-semibold">獲得Dig</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {BONUS_RECORD_VIEWS.map((r, i) => (
                  <tr key={i} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2.5 text-ink-muted">{r.recordedOn}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{r.memberName}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.itemName}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{yen(r.grantedDig)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-ink">社員別 月次集計</div>
          <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">氏名</th>
                  <th className="px-4 py-2.5 text-right font-semibold">ボーナスDig</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {totals.map((t) => (
                  <tr key={t.personId} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{t.name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-brand-accent">
                      {yen(t.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ── 取引ログ（F-6） ──
export function TransactionLog() {
  const net = netByMember();
  return (
    <>
      <SectionHeader
        title="取引ログ（メンバー間送金）"
        note="業務委託の対価をメンバー間でDig送金。自己送金・残高超過は不可。"
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Stat label="今月の送金総額" value={man(TXN_TOTAL)} accent />
        <Stat label="取引件数" value={`${TXN_VIEWS.length}件`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold text-ink">取引一覧</div>
          <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">取引日</th>
                  <th className="px-4 py-2.5 font-semibold">支払</th>
                  <th className="px-4 py-2.5 font-semibold">受取</th>
                  <th className="px-4 py-2.5 text-right font-semibold">金額</th>
                  <th className="px-4 py-2.5 font-semibold">内容</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {TXN_VIEWS.map((t, i) => (
                  <tr key={i} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2.5 text-ink-muted">{t.tradedOn}</td>
                    <td className="px-4 py-2.5">{t.payerName}</td>
                    <td className="px-4 py-2.5">{t.payeeName}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{yen(t.amount)}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-ink">社員別 純増減</div>
          <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">氏名</th>
                  <th className="px-4 py-2.5 text-right font-semibold">純増減</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {net.map((n) => (
                  <tr key={n.personId} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{n.name}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold ${
                        n.net >= 0 ? "text-semantic-success" : "text-semantic-danger"
                      }`}
                    >
                      {n.net >= 0 ? "+" : "▲"}
                      {yen(Math.abs(n.net))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ── リリースノート ──
export function ReleaseNotes() {
  // GitHub Releases（semantic-release 自動生成）を実行時取得。失敗時は同梱の静的リストにフォールバック。
  const [releases, setReleases] = useState<Release[]>(RELEASES);
  const [note, setNote] = useState("読み込み中…");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await apiGet<Release[]>("/api/releases");
        if (!alive) return;
        if (Array.isArray(data) && data.length > 0) {
          setReleases(data);
          setNote("GitHub Release から自動取得");
        } else {
          setNote("GitHub Release が未作成のため同梱リストを表示");
        }
      } catch {
        if (!alive) return;
        setNote("取得失敗のため同梱リストを表示");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <SectionHeader title="リリースノート" note={note} />
      <div className="space-y-4">
        {releases.map((r) => (
          <div key={r.version} className="rounded-card border border-surface-border bg-white p-5 shadow-card">
            <div className="flex items-center gap-3">
              <span className="rounded-pill bg-brand-primary px-2.5 py-0.5 text-sm font-bold text-white">
                {r.version}
              </span>
              <span className="font-semibold text-ink">{r.title}</span>
              <span className="ml-auto text-xs text-ink-muted">{r.date}</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {r.changes.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      c.type === "feat"
                        ? "bg-blue-100 text-brand-primary"
                        : c.type === "fix"
                          ? "bg-amber-100 text-semantic-warn"
                          : "bg-slate-100 text-ink-muted"
                    }`}
                  >
                    {c.type}
                  </span>
                  <span className="text-ink">{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular mt-1 text-2xl font-bold ${accent ? "text-brand-accent" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
