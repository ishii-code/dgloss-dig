/**
 * 取引ログ モジュール（要件 F-6）。メンバー間Dig送金。
 * ※ 永続化は P4（Supabase）。ここは UI 検証用シード。
 */
import type { Transaction } from "@dig/contracts";
import { MEMBERS, YEAR_MONTH } from "./mock";

export const TRANSACTIONS: Transaction[] = [
  { yearMonth: YEAR_MONTH, tradedOn: `${YEAR_MONTH}-05`, payerId: "B0000064", payeeId: "B0000097", amount: 50000, description: "リスト作成代行", note: null },
  { yearMonth: YEAR_MONTH, tradedOn: `${YEAR_MONTH}-10`, payerId: "B0000068", payeeId: "B0000078", amount: 30000, description: "テレアポ業務委託", note: null },
  { yearMonth: YEAR_MONTH, tradedOn: `${YEAR_MONTH}-18`, payerId: "B0000098", payeeId: "B0000087", amount: 20000, description: "商談同席サポート", note: null },
];

const nameOf = (id: string) => MEMBERS.find((m) => m.personId === id)?.name ?? id;

export interface TxnView extends Transaction {
  payerName: string;
  payeeName: string;
}

export const TXN_VIEWS: TxnView[] = TRANSACTIONS.map((t) => ({
  ...t,
  payerName: nameOf(t.payerId),
  payeeName: nameOf(t.payeeId),
}));

/** 社員別の純増減（受取 − 支払）。 */
export function netByMember(): { personId: string; name: string; net: number }[] {
  const map = new Map<string, number>();
  for (const t of TRANSACTIONS) {
    map.set(t.payerId, (map.get(t.payerId) ?? 0) - t.amount);
    map.set(t.payeeId, (map.get(t.payeeId) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([personId, net]) => ({ personId, name: nameOf(personId), net }))
    .sort((a, b) => b.net - a.net);
}

export const TXN_TOTAL = TRANSACTIONS.reduce((s, t) => s + t.amount, 0);
