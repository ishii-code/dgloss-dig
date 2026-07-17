/**
 * リリースノート モジュール。dgloss RELEASE.md では semantic-release が自動生成する想定。
 * P4 で CHANGELOG 自動集約に置換（ここは暫定の手動リスト）。
 */
export interface Release {
  version: string;
  date: string;
  title: string;
  changes: { type: "feat" | "fix" | "docs"; text: string }[];
}

export const RELEASES: Release[] = [
  {
    version: "v0.2.0",
    date: "2026-01-31",
    title: "Digloss Bank／ディグロス金融",
    changes: [
      { type: "feat", text: "入社時の必須初回借入（自動承認）" },
      { type: "feat", text: "追加借入の承認フロー（ディグロス金融 管理画面）" },
      { type: "feat", text: "金利設定の変更（新規借入に適用・既存は借入時レート保持）" },
      { type: "feat", text: "返済スケジュール表示（元利均等・自動返済）" },
    ],
  },
  {
    version: "v0.1.0",
    date: "2026-01-31",
    title: "Dig評価 P1コア",
    changes: [
      { type: "feat", text: "月次評価（予算Dig／実績Dig／達成率／評価ランク）" },
      { type: "feat", text: "予実モニター・事業部別・メンバー評価ダッシュボード" },
      { type: "docs", text: "要件定義 v1.1・計算エンジン（Excel回帰テスト）" },
    ],
  },
];
