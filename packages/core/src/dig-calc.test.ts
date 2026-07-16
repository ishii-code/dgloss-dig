import { describe, expect, it } from "vitest";
import { DEFAULT_SETTING } from "@dig/contracts";
import {
  achievementRate,
  computeQuarterBalance,
  cumulativeBudgetDig,
  daysInMonth,
  evaluateMonthly,
  evaluationRank,
  loanSchedule,
  monthlyBudgetDig,
  mround,
  promotionStep,
  prorationCoefficient,
  residencyDays,
  seatCost,
  totalCost,
} from "./dig-calc.js";

const S = DEFAULT_SETTING;

describe("日付・在籍日数", () => {
  it("daysInMonth", () => {
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29); // 閏年
    expect(daysInMonth("2026-04")).toBe(30);
  });

  it("在籍日数: 月初以前入社・退社なし → 満了", () => {
    expect(residencyDays("2026-01", "2024-08-01", null)).toBe(31);
  });

  it("在籍日数: 月途中入社 → 按分", () => {
    // 1/17入社 → 17..31 = 15日
    expect(residencyDays("2026-01", "2026-01-17", null)).toBe(15);
  });

  it("在籍日数: 月途中退社 → 按分", () => {
    // 1/1..1/10 = 10日
    expect(residencyDays("2026-01", "2024-01-01", "2026-01-10")).toBe(10);
  });

  it("在籍日数: 対象月に不在 → 0", () => {
    expect(residencyDays("2026-01", "2026-03-01", null)).toBe(0);
  });
});

describe("MROUND（Excel互換）", () => {
  it("10万単位丸め", () => {
    expect(mround(4_344_000, 100_000)).toBe(4_300_000); // 43.44 → 43
    expect(mround(5_144_000, 100_000)).toBe(5_100_000); // 51.44 → 51
    expect(mround(4_350_000, 100_000)).toBe(4_400_000); // 43.5 → 44 (away from zero)
  });
});

describe("評価ランクしきい値（S/A/B/C/D）", () => {
  it.each([
    [1.5, "S"],
    [2.0, "S"],
    [1.0, "A"],
    [1.49, "A"],
    [0.8, "B"],
    [0.5, "C"],
    [0.4977, "D"],
    [0, "D"],
  ])("rate %s → %s", (rate, rank) => {
    expect(evaluationRank(rate as number)).toBe(rank);
  });
});

/**
 * Excel `dig_v5.xlsx` 月次評価1月 row4「掛端光(B0000064)」との回帰一致。
 * 役職ベース I4=780,000 / 座席代 N4=150,000（当該行は雇用形態未設定で共通費150k適用）
 * → O4 総コスト=1,086,000 / P4 単月予算Dig=4,300,000。
 */
describe("回帰: 掛端光 (Excel 月次評価1月 row4)", () => {
  const proration = 1; // 在籍31/31
  const seat150k = 150_000; // Excel N4（雇用形態ブランク→アルバイト共通費）

  it("総コスト O4 = 1,086,000", () => {
    expect(totalCost(780_000, S, proration, seat150k)).toBe(1_086_000);
  });

  it("単月予算Dig P4 = 4,300,000", () => {
    const total = totalCost(780_000, S, proration, seat150k);
    expect(monthlyBudgetDig(total, S)).toBe(4_300_000);
  });

  it("実績Dig=1,710,000 / 達成率≒0.3977 / ランクD（単月）", () => {
    const rate = achievementRate(1_710_000, 4_300_000);
    expect(rate).toBeCloseTo(0.3977, 4);
    expect(evaluationRank(rate)).toBe("D");
  });

  it("累計予算Dig（半期×6・v1.1）= 25,800,000", () => {
    expect(cumulativeBudgetDig(4_300_000, "半期")).toBe(25_800_000);
  });
});

/** 正社員として正しく計上した場合（座席代=350k）の formula 検証 */
describe("座席代: 雇用形態別", () => {
  it("正社員 → 350,000 × 日割", () => {
    expect(seatCost("正社員", S, 1)).toBe(350_000);
    expect(seatCost("正社員", S, prorationCoefficient(15, 31))).toBeCloseTo(
      350_000 * (15 / 31),
      6,
    );
  });
  it("アルバイト → 150,000 × 日割", () => {
    expect(seatCost("アルバイト", S, 1)).toBe(150_000);
  });
});

describe("evaluateMonthly（集約）", () => {
  it("正社員・満了・成果171万 → 単月ランクD", () => {
    const r = evaluateMonthly({
      yearMonth: "2026-01",
      personId: "B0000064",
      employmentType: "正社員",
      positionBase: 780_000,
      joinedOn: "2024-08-01",
      leftOn: null,
      evaluationCycle: "半期",
      seikaDig: 1_710_000,
      bonusDig: 0,
      loanDig: 0,
      setting: S,
    });
    // 正社員なので座席代350k: 総コスト=936,000+350,000=1,286,000
    expect(r.totalCost).toBe(1_286_000);
    expect(r.monthlyBudgetDig).toBe(5_100_000); // MROUND(5,144,000)
    expect(r.cumulativeBudgetDig).toBe(30_600_000); // ×6
    expect(r.monthly.actualDig).toBe(1_710_000);
    expect(r.monthly.rank).toBe("D");
  });
});

/**
 * Excel 借入管理 row2「色川巧美」との回帰一致。
 * 借入200万・月利1%・12回 → 利息2万・元利202万・当月返済168,333.33・残高1,851,666.67
 */
describe("回帰: 借入スケジュール (Excel 借入管理 row2)", () => {
  const sched = loanSchedule(2_000_000, 0.01, 12);

  it("1回目: 利息20,000 / 返済168,333.33 / 残高1,851,666.67", () => {
    const first = sched[0]!;
    expect(first.interest).toBe(20_000);
    expect(first.principalPlusInterest).toBe(2_020_000);
    expect(first.repayment).toBeCloseTo(168_333.333, 2);
    expect(first.closingBalance).toBeCloseTo(1_851_666.667, 2);
  });

  it("2回目: 残高1,851,666.67から継続", () => {
    const second = sched[1]!;
    expect(second.openingBalance).toBeCloseTo(1_851_666.667, 2);
  });

  it("12回で完済に向かい残高は単調減少", () => {
    for (let i = 1; i < sched.length; i++) {
      expect(sched[i]!.closingBalance).toBeLessThan(sched[i - 1]!.closingBalance);
    }
  });
});

/**
 * Excel 残高計算 row2「掛端光」との回帰一致。
 * 獲得粗利1,710,000・目標0 → 残高1,710,000・インセン342,000。
 */
describe("回帰: インセンティブ (Excel 残高計算 row2)", () => {
  it("残高1,710,000 → インセン342,000", () => {
    const r = computeQuarterBalance({
      personId: "B0000064",
      gross: 1_710_000,
      target: 0,
      bonus: 0,
    });
    expect(r.balance).toBe(1_710_000);
    expect(r.incentive).toBe(342_000);
  });
});

describe("昇降級判定", () => {
  it.each([
    [1.3, 2],
    [1.0, 1],
    [0.9, 0],
    [0.7, -1],
    [0.5, -2],
  ])("rate %s → %s段", (rate, step) => {
    expect(promotionStep(rate as number, S)).toBe(step);
  });
});
