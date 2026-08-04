import { describe, expect, it } from "vitest";
import { CG_INCENTIVE_RATE, DEFAULT_SETTING } from "@dig/contracts";
import {
  barterDig,
  CG_SPLIT_RENEWAL_SALES_PCT,
  CG_SPLIT_UPSELL_SALES_PCT,
  cgChurnDig,
  cgGrossDig,
  cgRenewalDig,
  cgSplit,
  cgUpsellDig,
  incentiveAmount,
  achievementRate,
  aggregateSeikaDig,
  blendedIncentive,
  buildInitialLoan,
  clawback,
  computeContractDig,
  computeQuarterBalance,
  cumulativeBudgetElapsed,
  cumulativeMonths,
  demotionOnNegative,
  evaluationRateWithBehavior,
  cumulativeBudgetDig,
  daysInMonth,
  evaluateMonthly,
  evaluationRank,
  loanSchedule,
  monthlyBudgetDig,
  monthlyRateFromAnnual,
  mround,
  monthDiff,
  promotionRate,
  promotionStep,
  promotionStepDual,
  prorationCoefficient,
  residencyDays,
  salaryGradeMove,
  seatCost,
  splitDig,
  surplusAllocation,
  totalCost,
  zeroSumTransfer,
  EMPTY_ORG_OVERRIDE,
  inheritedOverride,
  mergeSetting,
} from "./dig-calc.js";
import type { OrgSettingNode, OrgSettingOverride } from "./dig-calc.js";

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

describe("期途中入社の累計（Q7・入社月除外・翌月〜）", () => {
  it("1月入社・3月評価 → 2ヶ月（2月,3月）", () => {
    expect(cumulativeMonths("2026-01", "2026-03", 3)).toBe(2);
  });
  it("長期在籍は四半期=3で頭打ち", () => {
    expect(cumulativeMonths("2024-08", "2026-03", 3)).toBe(3);
  });
  it("入社月と同月は0", () => {
    expect(cumulativeMonths("2026-03", "2026-03", 3)).toBe(0);
  });
  it("累計予算= 単月×月数", () => {
    expect(cumulativeBudgetElapsed(4300000, 2)).toBe(8600000);
  });
});

describe("管理職インセンのブレンド（Q9）", () => {
  it("個人70%/グループ30%", () => {
    expect(blendedIncentive(100000, 200000, 0.7)).toBeCloseTo(130000, 6);
  });
});

describe("クローバック（Q11・期間比例）", () => {
  it("12ヶ月契約を3ヶ月で解約 → 残9ヶ月分巻き戻し", () => {
    expect(clawback(1200000, 12, 3)).toBe(900000);
  });
  it("満了は巻き戻しなし", () => {
    expect(clawback(1200000, 12, 12)).toBe(0);
  });
});

describe("超過分の持ち越し/インセン選択（Q3）", () => {
  it("incentive選択 → 超過×20%", () => {
    expect(surplusAllocation(1000000, "incentive")).toEqual({ incentive: 200000, carryover: 0 });
  });
  it("carryover選択 → 全額繰越・インセン0", () => {
    expect(surplusAllocation(1000000, "carryover")).toEqual({ incentive: 0, carryover: 1000000 });
  });
  it("マイナス着地は減給（-2段）", () => {
    expect(demotionOnNegative(-50000, S)).toBe(-2);
    expect(demotionOnNegative(10000, S)).toBe(0);
  });
});

describe("安全弁（Q15・行動指標を重み小で評価）", () => {
  it("ボーナスは重み0.5で評価に算入", () => {
    // 成果50万+ボーナス20万×0.5+借入0 = 60万 / 予算120万 = 0.5
    expect(evaluationRateWithBehavior({ seika: 500000, bonus: 200000, loan: 0, budget: 1200000 })).toBeCloseTo(0.5, 6);
  });
});

describe("相対貸借ゼロサム（Q12）", () => {
  it("貸し手-/借り手+", () => {
    expect(zeroSumTransfer("A", "B", 100000)).toEqual([
      { personId: "A", delta: -100000 },
      { personId: "B", delta: 100000 },
    ]);
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

describe("barterDig（バーター契約）", () => {
  it("同額発注なら固定20万Dig", () => {
    expect(barterDig(500_000, 500_000)).toBe(200_000);
  });

  it("当方の発注額のほうが大きい（持ち出し）なら付与なし", () => {
    expect(barterDig(800_000, 500_000)).toBe(0);
  });

  it("当方の発注額のほうが小さければ差額の半額", () => {
    // 差額 300,000 → 千円切捨 300,000 → 半額 150,000
    expect(barterDig(500_000, 800_000)).toBe(150_000);
  });

  it("差額は千円単位で切り捨ててから半額にする", () => {
    // 差額 301,999 → 千円切捨 301,000 → 半額 150,500
    expect(barterDig(500_000, 801_999)).toBe(150_500);
  });

  it("双方0円なら付与なし", () => {
    expect(barterDig(0, 0)).toBe(0);
  });

  it("当方0円・先方発注ありなら差額の半額", () => {
    expect(barterDig(0, 1_000_000)).toBe(500_000);
  });

  it("固定Digは運用値を差し替えられる", () => {
    expect(barterDig(100_000, 100_000, 300_000)).toBe(300_000);
  });
});

describe("カスタマーグロースの獲得Dig", () => {
  it("アップセル: 増分月額 × 粗利率50% × 残契約月数", () => {
    // 15万円/月 の増分・残10ヶ月 → 150,000 × 0.5 × 10 = 750,000
    expect(cgUpsellDig(150_000, 10)).toBe(750_000);
  });

  it("更新: 月額 × 粗利率50% × 更新期間", () => {
    // 30万円/月・12ヶ月更新 → 300,000 × 0.5 × 12 = 1,800,000
    expect(cgRenewalDig(300_000, 12)).toBe(1_800_000);
  });

  it("粗利は千円単位で切り捨てる", () => {
    // 100,999 × 0.5 × 1 = 50,499.5 → 四捨五入 50,500 → 千円切捨 50,000
    expect(cgGrossDig(100_999, 1)).toBe(50_000);
  });

  it("更新月での解約（満了）はマイナスなし", () => {
    expect(cgChurnDig(300_000, 0, true)).toBe(0);
    // 残月数があっても、更新月での終了ならマイナスにしない
    expect(cgChurnDig(300_000, 6, true)).toBe(0);
  });

  it("途中解約は残存期間の粗利をマイナス計上", () => {
    // 30万円/月・残8ヶ月 → 300,000 × 0.5 × 8 = 1,200,000 のマイナス
    expect(cgChurnDig(300_000, 8, false)).toBe(-1_200_000);
  });

  it("途中解約でも残月数0ならマイナスなし", () => {
    expect(cgChurnDig(300_000, 0, false)).toBe(0);
  });

  it("分配: アップセルは CG70 / 営業30", () => {
    expect(cgSplit(750_000, CG_SPLIT_UPSELL_SALES_PCT)).toEqual({ cg: 525_000, sales: 225_000 });
  });

  it("分配: 更新は CG80 / 営業20", () => {
    expect(cgSplit(1_800_000, CG_SPLIT_RENEWAL_SALES_PCT)).toEqual({ cg: 1_440_000, sales: 360_000 });
  });

  it("分配は原資を増やさない（端数はCG側へ寄せる）", () => {
    const r = cgSplit(1_001, 30);
    expect(r.cg + r.sales).toBe(1_001);
    expect(r.sales).toBe(300);
  });

  it("分配率0%なら全額CG（初回営業が退職済みのケース）", () => {
    expect(cgSplit(500_000, 0)).toEqual({ cg: 500_000, sales: 0 });
  });

  it("マイナスDigは分配しない（チャーンはCGが負う）", () => {
    expect(cgSplit(-1_200_000, 30)).toEqual({ cg: 0, sales: 0 });
  });
});

describe("インセンティブ還元率（事業部で異なる）", () => {
  it("既定は20%（営業）", () => {
    expect(incentiveAmount(1_000_000)).toBe(200_000);
  });

  it("カスタマーグロースは5%", () => {
    expect(incentiveAmount(1_000_000, CG_INCENTIVE_RATE)).toBe(50_000);
  });

  it("computeQuarterBalance に率を渡せる", () => {
    // 上振れ 100万 → 5% = 5万
    const r = computeQuarterBalance({
      personId: "X",
      gross: 5_000_000,
      target: 4_000_000,
      bonus: 0,
      incentiveRate: CG_INCENTIVE_RATE,
    });
    expect(r.balance).toBe(1_000_000);
    expect(r.incentive).toBe(50_000);
  });

  it("未達ならインセンなし", () => {
    const r = computeQuarterBalance({
      personId: "X",
      gross: 3_000_000,
      target: 4_000_000,
      bonus: 0,
      incentiveRate: CG_INCENTIVE_RATE,
    });
    expect(r.incentive).toBe(0);
  });

  it("ボーナスDigはインセン原資に含めない（残高には積む）", () => {
    const r = computeQuarterBalance({
      personId: "X",
      gross: 5_000_000,
      target: 4_000_000,
      bonus: 500_000,
    });
    expect(r.balance).toBe(1_500_000); // 残高はボーナス込み
    expect(r.incentive).toBe(200_000); // 上振れ100万 × 20%（ボーナスは除外）
  });

  it("未達でもボーナスがあればインセンは付かない", () => {
    const r = computeQuarterBalance({
      personId: "X",
      gross: 3_000_000,
      target: 4_000_000,
      bonus: 1_000_000,
    });
    expect(r.balance).toBe(1_000_000);
    expect(r.incentive).toBe(0);
  });
});

describe("事業部別 Dig予算設定（組織ツリーで継承）", () => {
  // 事業部(1) ─ グループ(2) ─ チーム(3)
  const tree = (
    overrides: Record<number, Partial<OrgSettingOverride>>,
  ): Map<number, OrgSettingNode> =>
    new Map(
      [
        { id: 1, parentId: null },
        { id: 2, parentId: 1 },
        { id: 3, parentId: 2 },
      ].map((n) => [n.id, { ...EMPTY_ORG_OVERRIDE, ...n, ...(overrides[n.id] ?? {}) }]),
    );

  it("組織未設定なら全社設定そのまま", () => {
    const s = mergeSetting(S, inheritedOverride(null, tree({})));
    expect(s).toEqual(S);
  });

  it("事業部の設定が配下のチームまで降りてくる", () => {
    const byId = tree({ 1: { budgetCoefficient: 5, commonCostFulltime: 200_000 } });
    const s = mergeSetting(S, inheritedOverride(3, byId));
    expect(s.budgetCoefficient).toBe(5);
    expect(s.commonCostFulltime).toBe(200_000);
    // 触っていない項目は全社設定のまま
    expect(s.insuranceCoefficient).toBe(S.insuranceCoefficient);
  });

  it("近い階層の設定が上位より優先される", () => {
    const byId = tree({ 1: { budgetCoefficient: 5 }, 2: { budgetCoefficient: 3 } });
    expect(mergeSetting(S, inheritedOverride(3, byId)).budgetCoefficient).toBe(3);
    expect(mergeSetting(S, inheritedOverride(1, byId)).budgetCoefficient).toBe(5);
  });

  it("項目ごとに独立して継承する", () => {
    const byId = tree({
      1: { budgetCoefficient: 5, promotionUpOne: 1.1 },
      3: { budgetCoefficient: 2 },
    });
    const s = mergeSetting(S, inheritedOverride(3, byId));
    expect(s.budgetCoefficient).toBe(2); // チームの値
    expect(s.promotion.upOne).toBe(1.1); // 事業部から継承
    expect(s.promotion.downTwo).toBe(S.promotion.downTwo); // 全社設定
  });

  it("0 は「未設定」ではなく有効な値として扱う", () => {
    const byId = tree({ 1: { commonCostParttime: 0 } });
    expect(mergeSetting(S, inheritedOverride(1, byId)).commonCostParttime).toBe(0);
  });

  it("親子が循環していても止まる", () => {
    const byId = new Map<number, OrgSettingNode>([
      [1, { ...EMPTY_ORG_OVERRIDE, id: 1, parentId: 2, budgetCoefficient: 7 }],
      [2, { ...EMPTY_ORG_OVERRIDE, id: 2, parentId: 1 }],
    ]);
    expect(mergeSetting(S, inheritedOverride(2, byId)).budgetCoefficient).toBe(7);
  });

  it("事業部別の予算係数が単月予算Digに効く", () => {
    const byId = tree({ 1: { budgetCoefficient: 2 } });
    const cg = mergeSetting(S, inheritedOverride(1, byId));
    const args = {
      yearMonth: "2026-04",
      personId: "X",
      employmentType: "正社員" as const,
      positionBase: 500_000,
      joinedOn: "2020-01-01",
      leftOn: null,
      evaluationCycle: "四半期" as const,
      seikaDig: 0,
      bonusDig: 0,
      loanDig: 0,
    };
    const base = evaluateMonthly({ ...args, setting: S });
    const scoped = evaluateMonthly({ ...args, setting: cg });
    // 予算係数 4.0 → 2.0 なので、単月予算Digは半分になる。
    expect(scoped.monthlyBudgetDig).toBe(base.monthlyBudgetDig / 2);
  });
});
