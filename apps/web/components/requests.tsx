"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";
const CATEGORIES = ["機能改善", "不具合", "その他"] as const;
const STATUSES = ["未対応", "対応中", "完了"] as const;

interface Req {
  id: number;
  title: string;
  body: string | null;
  category: string;
  status: string;
  page: string | null;
  createdBy: string;
  createdAt: string;
}

function statusStyle(s: string): string {
  if (s === "完了") return "bg-emerald-100 text-semantic-success";
  if (s === "対応中") return "bg-amber-100 text-semantic-warn";
  return "bg-slate-100 text-ink-muted";
}

export function FeatureRequests() {
  const [items, setItems] = useState<Req[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("機能改善");
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");

  async function load() {
    try {
      setItems(await apiGet<Req[]>("/api/requests"));
      setSource("db");
    } catch {
      setSource("mock");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function post() {
    if (!title.trim()) {
      setMsg("タイトルは必須です");
      return;
    }
    try {
      await apiSend("/api/requests", "POST", {
        title,
        body: body || null,
        category,
        page: null,
        createdBy: ACTOR,
      });
      setMsg("改善リクエストを投稿しました");
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setMsg(`投稿失敗: ${(e as Error).message}`);
    }
  }

  async function setStatus(id: number, status: string) {
    try {
      await apiSend(`/api/requests/${id}`, "PATCH", { status, actor: ACTOR });
      await load();
    } catch (e) {
      setMsg(`更新失敗: ${(e as Error).message}`);
    }
  }

  const open = items.filter((r) => r.status !== "完了");
  const done = items.filter((r) => r.status === "完了");

  return (
    <>
      <SectionHeader title="改善リクエスト" note="機能改善・不具合の要望を投稿し、対応状況を管理。" />
      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && <div className="mb-3 rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">{msg}</div>}

      {/* 投稿フォーム */}
      <div className="mb-6 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">リクエストを投稿</div>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-ink-muted">タイトル</span>
            <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 達成率の推移グラフが欲しい" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-muted">分類</span>
            <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={post} className="w-full rounded-card bg-brand-primary px-4 py-2 text-sm font-bold text-white">投稿</button>
          </div>
          <label className="block sm:col-span-4">
            <span className="mb-1 block text-[11px] text-ink-muted">詳細（任意）</span>
            <textarea className="inp" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink">対応中・未対応</span>
        <span className="rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-bold text-semantic-warn">{open.length}件</span>
      </div>
      <RequestTable items={open} onStatus={setStatus} />

      {done.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-sm font-semibold text-ink-muted">完了（{done.length}件）</div>
          <RequestTable items={done} onStatus={setStatus} />
        </>
      )}
      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>
    </>
  );
}

function RequestTable({ items, onStatus }: { items: Req[]; onStatus: (id: number, s: string) => void }) {
  return (
    <div className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
            <th className="px-4 py-2.5 font-semibold">分類</th>
            <th className="px-4 py-2.5 font-semibold">タイトル</th>
            <th className="px-4 py-2.5 font-semibold">投稿者</th>
            <th className="px-4 py-2.5 font-semibold">状態</th>
            <th className="px-4 py-2.5 font-semibold">変更</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-faint">リクエストはありません</td></tr>
          )}
          {items.map((r) => (
            <tr key={r.id} className="border-b border-surface-border last:border-0">
              <td className="px-4 py-2.5 text-ink-muted">{r.category}</td>
              <td className="px-4 py-2.5">
                <div className="font-medium text-ink">{r.title}</div>
                {r.body && <div className="text-xs text-ink-muted">{r.body}</div>}
              </td>
              <td className="px-4 py-2.5 text-ink-muted">{r.createdBy}</td>
              <td className="px-4 py-2.5">
                <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${statusStyle(r.status)}`}>{r.status}</span>
              </td>
              <td className="px-4 py-2.5">
                <select
                  className="rounded-card border border-surface-border px-2 py-1 text-xs"
                  value={r.status}
                  onChange={(e) => onStatus(r.id, e.target.value)}
                >
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
