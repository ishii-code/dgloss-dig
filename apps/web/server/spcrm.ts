/**
 * SP_CRM コネクタ（uifujitsuka-cmd/SP_CRM・Supabase）。
 * 企業ID（取引先=法人番号/Account.id）→ 商談の担当者(assigned_to=FS / apo_creator=IS)
 * → SP_CRM Member.email → dgloss Account.email → personId で従業員を特定。
 *
 * 本番: SPCRM_SUPABASE_URL / SPCRM_SUPABASE_KEY を設定すると直結。
 * 未設定時: 下記サンプルデータで解決（UI/ロジック検証用）。
 */
import type { AssignmentShare } from "@dig/contracts";
import { prisma } from "./db";

// ── SP_CRM のサンプル（型は SP_CRM src/types に準拠） ──
interface SpcrmAccount {
  id: string;
  name: string;
  corporate_number: string | null;
}
interface SpcrmMember {
  id: string;
  name: string;
  email: string;
}
interface SpcrmOpportunity {
  id: string;
  account_id: string;
  assigned_to: string; // Member.id（FS担当）
  apo_creator: string | null; // アポ獲得者メール/名（IS担当）
}

// dgloss seed のアカウント email と一致させる（email→personId 解決のため）
const SAMPLE_MEMBERS: SpcrmMember[] = [
  { id: "m-kondo", name: "近藤浩人", email: "kondo@dgloss.co.jp" },
  { id: "m-kakehata", name: "掛端光", email: "kakehata@dgloss.co.jp" },
  { id: "m-honma", name: "本間駿", email: "honma@dgloss.co.jp" },
  { id: "m-horikawa", name: "堀川璃歩", email: "horikawa@dgloss.co.jp" },
];

const SAMPLE_ACCOUNTS: SpcrmAccount[] = [
  { id: "SP-ACC-1001", name: "サンプル商事", corporate_number: "1234567890123" },
  { id: "SP-ACC-1002", name: "テスト工業", corporate_number: "2345678901234" },
  { id: "SP-ACC-2001", name: "CRM顧客A", corporate_number: "3456789012345" },
];

const SAMPLE_OPPS: SpcrmOpportunity[] = [
  { id: "opp-1", account_id: "SP-ACC-1001", assigned_to: "m-kondo", apo_creator: "horikawa@dgloss.co.jp" },
  { id: "opp-2", account_id: "SP-ACC-1002", assigned_to: "m-kakehata", apo_creator: null },
  { id: "opp-3", account_id: "SP-ACC-2001", assigned_to: "m-honma", apo_creator: null },
];

export const spcrmConnected = Boolean(
  process.env.SPCRM_SUPABASE_URL && process.env.SPCRM_SUPABASE_KEY,
);

/** email → dgloss personId（Account マスタ経由） */
async function personIdByEmail(email: string): Promise<string | null> {
  const acc = await prisma.account.findUnique({ where: { email } });
  return acc?.personId ?? null;
}

function memberEmail(memberId: string): string | null {
  return SAMPLE_MEMBERS.find((m) => m.id === memberId)?.email ?? null;
}

/**
 * 企業ID から担当者(FS/IS)を解決し、初期の折半 shares を返す。
 * FS(assigned_to) と IS(apo_creator) がいれば 50/50、FSのみなら 100。
 * ※ 本番は SP_CRM Supabase を直結して同ロジックで解決する。
 */
export async function resolveAssigneesByCompany(
  companyId: string | null,
): Promise<{ shares: AssignmentShare[]; note: string }> {
  if (!companyId) return { shares: [], note: "企業ID未設定" };

  // companyId は Account.id または corporate_number のどちらでも照合
  const acc = SAMPLE_ACCOUNTS.find(
    (a) => a.id === companyId || a.corporate_number === companyId,
  );
  if (!acc) return { shares: [], note: `SP_CRMに企業ID ${companyId} が見つかりません` };

  const opp = SAMPLE_OPPS.find((o) => o.account_id === acc.id);
  if (!opp) return { shares: [], note: `${acc.name} に商談がありません` };

  const fsEmail = memberEmail(opp.assigned_to);
  const isEmail = opp.apo_creator;

  const fsPerson = fsEmail ? await personIdByEmail(fsEmail) : null;
  const isPerson = isEmail ? await personIdByEmail(isEmail) : null;

  const shares: AssignmentShare[] = [];
  if (fsPerson && isPerson && fsPerson !== isPerson) {
    shares.push({ personId: fsPerson, sharePercent: 50 });
    shares.push({ personId: isPerson, sharePercent: 50 });
  } else if (fsPerson) {
    shares.push({ personId: fsPerson, sharePercent: 100 });
  }
  const note = shares.length
    ? `SP_CRM ${acc.name}: FS=${fsPerson ?? "—"}${isPerson ? ` / IS=${isPerson}` : ""}`
    : `${acc.name}: 担当者を dgloss 従業員に解決できません（Accountマスタのemail紐付けを確認）`;
  return { shares, note };
}
