import { describe, expect, it } from "vitest";
import { DEFAULT_SETTING } from "@dig/contracts";
import {
  achievementRate,
  aggregateSeikaDig,
  buildInitialLoan,
  computeContractDig,
  computeQuarterBalance,
  cumulativeBudgetDig,
  daysInMonth,
  evaluateMonthly,
  evaluationRank,
  loanSchedule,
  monthlyBudgetDig,
  monthlyRateFromAnnual,
  mround,
  promotionRate,
  promotionStep,
  promotionStepDual,
  prorationCoefficient,
  residencyDays,
  salaryGradeMove,
  seatCost,
  splitDig,
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

describe("金利 / 初回借入（ディグロス金融・v1.2）", () => {
  it("年利12% → 月利0.01", () => {
    expect(monthlyRateFromAnnual(12)).toBeCloseTo(0.01, 6);
    expect(monthlyRateFromAnnual(6)).toBeCloseTo(0.005, 6);
  });

  it("入社時の必須初回借入は会社・自動承認", () => {
    const loan = buildInitialLoan({
      id: "L-INIT-1",
      yearMonth: "2026-01",
      borrowerId: "B0000105",
      joinedOn: "2026-01-05",
      setting: S,
    });
    expect(loan.loanType).toBe("初回");
    expect(loan.status).toBe("承認済");
    expect(loan.lender).toBe("ディグロス金融");
    expect(loan.principal).toBe(2_000_000);
    expect(loan.monthlyRate).toBeCloseTo(0.01, 6);
    expect(loan.approvedBy).toBe("ディグロス金融");
  });

  it("金利変更後の新規借入は新レートを使う", () => {
    const changed = { ...S, annualRatePct: 6 };
    const loan = buildInitialLoan({
      id: "L-INIT-2",
      yearMonth: "2026-02",
      borrowerId: "B0000104",
      joinedOn: "2026-02-01",
      setting: changed,
    });
    expect(loan.monthlyRate).toBeCloseTo(0.005, 6);
  });
});

describe("Dig獲得ルール（F-3・keiyaku連携）", () => {
  const contract = {
    id: "K-1",
    contractNo: "C-001",
    customerName: "テスト社",
    companyId: "SP-ACC-1",
    division: "AIテレアポ事業部",
    modelKey: "line_call",
    status: "active",
    baseAmount: 300_000,
    setupFee: 0,
    initialFee: 1_234_500,
    termMonths: 12,
    startDate: "2026-01-01",
    lineItems: [
      { key: "line", qty: 2, unit: 50000 },
      { key: "call", qty: 3, unit: 50000 },
    ],
  };

  it("回線コール単価: 回線2×5万 + コール3×5万 = 25万", () => {
    const rule = { id: "r1", division: "AIテレアポ事業部", name: "AIテレアポ", ruleType: "回線コール単価" as const, modelKeyFilter: null, unitLine: 50000, unitCall: 50000, ratioPercent: 0, fixedDig: 0, active: true };
    expect(computeContractDig(contract, rule)).toBe(250_000);
  });

  it("初回発注1to1: 1,234,500 → 千円切捨 1,234,000", () => {
    const rule = { id: "r2", division: "アポプロ", name: "アポプロ", ruleType: "初回発注1to1" as const, modelKeyFilter: null, unitLine: 0, unitCall: 0, ratioPercent: 0, fixedDig: 0, active: true };
    expect(computeContractDig(contract, rule)).toBe(1_234_000);
  });

  it("月額基本料金割合: 30万 × 50% = 15万", () => {
    const rule = { id: "r3", division: "x", name: "x", ruleType: "月額基本料金割合" as const, modelKeyFilter: null, unitLine: 0, unitCall: 0, ratioPercent: 50, fixedDig: 0, active: true };
    expect(computeContractDig(contract, rule)).toBe(150_000);
  });

  it("modelKeyFilter 不一致 → 0", () => {
    const rule = { id: "r4", division: "x", name: "x", ruleType: "固定Dig" as const, modelKeyFilter: "account", unitLine: 0, unitCall: 0, ratioPercent: 0, fixedDig: 99999, active: true };
    expect(computeContractDig(contract, rule)).toBe(0);
  });

  it("canceled 契約 → 0", () => {
    const rule = { id: "r5", division: "x", name: "x", ruleType: "固定Dig" as const, modelKeyFilter: null, unitLine: 0, unitCall: 0, ratioPercent: 0, fixedDig: 50000, active: true };
    expect(computeContractDig({ ...contract, status: "canceled" }, rule)).toBe(0);
  });

  it("折半: 25万を FS50%/IS50% で按分", () => {
    const split = splitDig(250_000, {
      contractId: "K-1",
      source: "manual",
      shares: [
        { personId: "A", sharePercent: 50 },
        { personId: "B", sharePercent: 50 },
      ],
    });
    expect(split).toEqual([
      { personId: "A", dig: 125_000 },
      { personId: "B", dig: 125_000 },
    ]);
  });

  it("折半端数は先頭者へ: 100を 3等分", () => {
    const split = splitDig(100, {
      contractId: "K-1",
      source: "manual",
      shares: [
        { personId: "A", sharePercent: 33 },
        { personId: "B", sharePercent: 33 },
        { personId: "C", sharePercent: 34 },
      ],
    });
    expect(split.reduce((s, r) => s + r.dig, 0)).toBe(100);
    expect(split[0]!.personId).toBe("A");
  });

  it("aggregateSeikaDig: 複数契約の従業員別合計", () => {
    const agg = aggregateSeikaDig([
      { contractId: "1", totalDig: 100, perPerson: [{ personId: "A", dig: 100 }] },
      { contractId: "2", totalDig: 200, perPerson: [{ personId: "A", dig: 100 }, { personId: "B", dig: 100 }] },
    ]);
    expect(agg.get("A")).toBe(200);
    expect(agg.get("B")).toBe(100);
  });
});

describe("2系統昇降級（Q1案1・借入は昇級に効かせない）", () => {
  it("借入で達成率1.2でも成果が乏しければ昇級しない", () => {
    // 実績込みrate=1.2(借入で嵩上げ) / 成果+ボーナスrate=0.3
    const step = promotionStepDual({ actualRate: 1.2, promoRate: 0.3, setting: S });
    expect(step).toBe(0); // 昇級せず・降級も回避
  });
  it("成果で達成率1.2なら2段昇級", () => {
    expect(promotionStepDual({ actualRate: 1.2, promoRate: 1.2, setting: S })).toBe(2);
  });
  it("借入込みでも実績rate0.4なら降級（借入で埋まらなければ降級）", () => {
    expect(promotionStepDual({ actualRate: 0.4, promoRate: 0.4, setting: S })).toBe(-2);
  });
  it("promotionRate: (成果+ボーナス)/予算", () => {
    expect(promotionRate(400000, 100000, 1000000)).toBeCloseTo(0.5, 6);
  });
});

describe("給与テーブル昇降級（Q6・16期人事制度）", () => {
  it("マネージャー(D) 基準0から1段昇級 → 行9・56万", () => {
    // 基準0の1つ上=行9
    expect(salaryGradeMove("D", 0, 1)).toEqual({ row: 9, amount: 560000 });
  });
  it("マネージャー(D) 基準0から1段降級 → 行10・52.5万", () => {
    expect(salaryGradeMove("D", 0, -1)).toEqual({ row: 10, amount: 525000 });
  });
  it("一般(A) 基準0から2段昇級 → 行8・27.5万", () => {
    expect(salaryGradeMove("A", 0, 2)).toEqual({ row: 8, amount: 275000 });
  });
  it("最上位でクランプ（行1超えない）", () => {
    expect(salaryGradeMove("A", 1, 5).row).toBe(1);
  });
  it("最下位でクランプ（行18超えない）", () => {
    expect(salaryGradeMove("A", 18, -5).row).toBe(18);
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
