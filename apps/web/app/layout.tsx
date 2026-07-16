import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dig評価 | dgloss",
  description: "Dig制度（社内通貨による営業評価）ダッシュボード",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
