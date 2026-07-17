/**
 * ボーナスDig モジュール（要件 F-4）。項目マスタ＋記録＋月次集計。
 * ※ 永続化は P4（Supabase）。ここは UI 検証用シード。
 */
import type { BonusDigItem, BonusDigRecord } from "@dig/contracts";
import { MEMBERS, YEAR_MONTH } from "./mock";

/** ボーナスDig項目マスタ（ボーナスDig項目シート準拠） */
export const BONUS_ITEMS: BonusDigItem[] = [
  { itemId: "B001", category: "インプット・アウトプット", name: "本を会社ライブラリに寄付", grantDig: 1000, monthlyCapDig: 10000, description: "ビジネス書・専門書限定。重複不可", enabled: true },
  { itemId: "B002", category: "インプット・アウトプット", name: "読了後アウトプット", grantDig: 1000, monthlyCapDig: 3000, description: "朝礼でのアウトプット", enabled: true },
  { itemId: "B003", category: "組織貢献", name: "月間MVP", grantDig: 50000, monthlyCapDig: 50000, description: "石井からのMVP", enabled: true },
  { itemId: "B004", category: "健康・勤怠", name: "シフト通りの出勤数", grantDig: 10000, monthlyCapDig: 10000, description: null, enabled: true },
  { itemId: "B005", category: "スキルアップ", name: "資格取得", grantDig: 5000, monthlyCapDig: 15000, description: "業務関連資格", enabled: true },
  { itemId: "B006", category: "ナレッジ共有", name: "社内勉強会の開催", grantDig: 3000, monthlyCapDig: 9000, description: null, enabled: false },
];

const ITEM = (id: string) => BONUS_ITEMS.find((i) => i.itemId === id);

/** ボーナスDig記録（記録シート準拠・Person ID で突合） */
export const BONUS_RECORDS: BonusDigRecord[] = [
  { yearMonth: YEAR_MONTH, recordedOn: `${YEAR_MONTH}-05`, personId: "B0000098", itemId: "B003", grantedDig: 50000, note: "1月MVP" },
  { yearMonth: YEAR_MONTH, recordedOn: `${YEAR_MONTH}-08`, personId: "B0000097", itemId: "B004", grantedDig: 10000, note: "無欠勤" },
  { yearMonth: YEAR_MONTH, recordedOn: `${YEAR_MONTH}-10`, personId: "B0000078", itemId: "B002", grantedDig: 1000, note: "「営業の魔法」要約" },
  { yearMonth: YEAR_MONTH, recordedOn: `${YEAR_MONTH}-12`, personId: "B0000097", itemId: "B001", grantedDig: 1000, note: "書籍寄付" },
  { yearMonth: YEAR_MONTH, recordedOn: `${YEAR_MONTH}-20`, personId: "B0000098", itemId: "B005", grantedDig: 5000, note: "資格取得" },
];

export interface BonusRecordView extends BonusDigRecord {
  memberName: string;
  itemName: string;
  category: string;
}

export const BONUS_RECORD_VIEWS: BonusRecordView[] = BONUS_RECORDS.map((r) => {
  const item = ITEM(r.itemId);
  return {
    ...r,
    memberName: MEMBERS.find((m) => m.personId === r.personId)?.name ?? r.personId,
    itemName: item?.name ?? r.itemId,
    category: item?.category ?? "—",
  };
});

/** 月次集計（社員別のボーナスDig合計）。 */
export function bonusTotalsByMember(): { personId: string; name: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of BONUS_RECORDS) {
    map.set(r.personId, (map.get(r.personId) ?? 0) + r.grantedDig);
  }
  return [...map.entries()]
    .map(([personId, total]) => ({
      personId,
      name: MEMBERS.find((m) => m.personId === personId)?.name ?? personId,
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

export const BONUS_TOTAL = BONUS_RECORDS.reduce((s, r) => s + r.grantedDig, 0);
