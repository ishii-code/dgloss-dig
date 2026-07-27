import { handle, ok } from "@/server/http";
import type { Release } from "@/lib/releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GitHub Releases（semantic-release が自動生成）を実行時に取得して
// アプリ内「リリースノート」タブへ表示する。公開リポジトリのため未認証でも可。
// GITHUB_TOKEN があればレート制限緩和に利用。owner/repo は Vercel の
// Git 連携環境変数から解決し、無ければ既定値。
const OWNER = process.env.VERCEL_GIT_REPO_OWNER ?? "ishii-code";
const REPO = process.env.VERCEL_GIT_REPO_SLUG ?? "dgloss-dig";

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
}

/** semantic-release の本文（### Features / ### Bug Fixes + 箇条書き）を changes[] へ。 */
function parseBody(body: string): Release["changes"] {
  const changes: Release["changes"] = [];
  let type: Release["changes"][number]["type"] = "docs";
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      if (/feature/i.test(line)) type = "feat";
      else if (/fix/i.test(line)) type = "fix";
      else type = "docs";
      continue;
    }
    const m = line.match(/^[*-]\s+(.*)$/);
    if (!m) continue;
    const text = m[1]
      .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "") // ([#12](url)) ([sha](url)) を除去
      .replace(/\*\*(.*?)\*\*/g, "$1") // **scope:** → scope:
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (text) changes.push({ type, text });
  }
  return changes;
}

function toRelease(r: GitHubRelease): Release {
  const date = (r.published_at ?? r.created_at ?? "").slice(0, 10);
  const changes = r.body ? parseBody(r.body) : [];
  return {
    version: r.tag_name,
    date,
    title: r.name && r.name !== r.tag_name ? r.name : "リリース",
    changes: changes.length > 0 ? changes : [{ type: "docs", text: "変更点は GitHub Release を参照" }],
  };
}

export const GET = () =>
  handle(async () => {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dgloss-dig",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`GitHub releases ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as GitHubRelease[];
    const releases = json
      .filter((r) => !r.draft)
      .map(toRelease)
      .filter((r) => r.version);
    return ok(releases);
  });
