/**
 * シードデータ（要件 §11 移行）。dig_v5.xlsx のメンバー一部＋設定＋ボーナス項目。
 * 月次評価は @dig/core で計算して投入。実行: pnpm db:seed
 */
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_SETTING,
  type EmploymentType,
  type EvaluationCycle,
  type JobType,
  type Position,
} from "@dig/contracts";
import { buildInitialLoan, evaluateMonthly, monthlyRateFromAnnual } from "@dig/core";

const prisma = new PrismaClient();
const YM = "2026-01";
const S = DEFAULT_SETTING;

interface MemberSeed {
  personId: string;
  name: string;
  division: string;
  position: Position;
  jobType: JobType | null;
  employmentType: EmploymentType;
  positionBase: number;
  basePay: number;
  joinedOn: string;
  cycle: EvaluationCycle;
  seikaDig: number;
}

const MEMBERS: MemberSeed[] = [
  { personId: "B0000064", name: "掛端光", division: "AIテレアポ事業部", position: "部長", jobType: null, employmentType: "正社員", positionBase: 780000, basePay: 745000, joinedOn: "2024-08-01", cycle: "半期", seikaDig: 8910000 },
  { personId: "B0000068", name: "土屋知己", division: "AIテレアポ事業部", position: "マネージャー", jobType: "IS", employmentType: "正社員", positionBase: 720000, basePay: 800000, joinedOn: "2024-06-01", cycle: "半期", seikaDig: 3435000 },
  { personId: "B0000098", name: "近藤浩人", division: "AIテレアポ事業部", position: "マネージャー", jobType: "FS", employmentType: "正社員", positionBase: 540000, basePay: 483334, joinedOn: "2025-11-01", cycle: "半期", seikaDig: 6105000 },
  { personId: "B0000099", name: "福島伊吹", division: "AIテレアポ事業部", position: "マネージャー", jobType: "FS", employmentType: "正社員", positionBase: 540000, basePay: 500000, joinedOn: "2025-12-01", cycle: "半期", seikaDig: 4291250 },
  { personId: "B0000097", name: "堀川璃歩", division: "AIテレアポ事業部", position: "メンバー", jobType: "IS", employmentType: "正社員", positionBase: 345000, basePay: 350000, joinedOn: "2025-11-04", cycle: "四半期", seikaDig: 2600000 },
  { personId: "B0000105", name: "色川巧美", division: "AIテレアポ事業部", position: "メンバー", jobType: "IS", employmentType: "正社員", positionBase: 345000, basePay: 325000, joinedOn: "2026-01-05", cycle: "四半期", seikaDig: 1200000 },
  { personId: "B0000069", name: "駒田真一郎", division: "SP事業部", position: "部長", jobType: "CS", employmentType: "正社員", positionBase: 555000, basePay: 580000, joinedOn: "2024-09-09", cycle: "半期", seikaDig: 3800000 },
  { personId: "B0000078", name: "櫛谷千春", division: "SP事業部", position: "メンバー", jobType: "CS", employmentType: "正社員", positionBase: 183000, basePay: 218334, joinedOn: "2025-03-21", cycle: "四半期", seikaDig: 980000 },
  { personId: "B0000085", name: "本間駿", division: "CRM事業部", position: "マネージャー", jobType: "FS", employmentType: "正社員", positionBase: 720000, basePay: 666667, joinedOn: "2025-05-01", cycle: "半期", seikaDig: 5400000 },
  { personId: "B0000087", name: "青木未来", division: "CRM事業部", position: "メンバー", jobType: "IS", employmentType: "正社員", positionBase: 255000, basePay: 241667, joinedOn: "2025-06-01", cycle: "四半期", seikaDig: 1650000 },
];

async function main() {
  // 設定
  await prisma.setting.upsert({
    where: { yearMonth: YM },
    update: {},
    create: {
      yearMonth: YM,
      insuranceCoefficient: S.insuranceCoefficient,
      budgetCoefficient: S.budgetCoefficient,
      annualRatePct: S.annualRatePct,
      initialLoanDefault: S.initialLoanDefault,
      loanTermMonthsDefault: S.loanTermMonthsDefault,
      commonCostFulltime: S.commonCostFulltime,
      commonCostParttime: S.commonCostParttime,
      promotionUpTwo: S.promotion.upTwo,
      promotionUpOne: S.promotion.upOne,
      promotionDownOne: S.promotion.downOne,
      promotionDownTwo: S.promotion.downTwo,
    },
  });

  // ボーナスDig項目
  const bonusItems = [
    { itemId: "B001", category: "インプット・アウトプット", name: "本を会社ライブラリに寄付", grantDig: 1000, monthlyCapDig: 10000, description: "ビジネス書・専門書限定", enabled: true },
    { itemId: "B002", category: "インプット・アウトプット", name: "読了後アウトプット", grantDig: 1000, monthlyCapDig: 3000, description: "朝礼でのアウトプット", enabled: true },
    { itemId: "B003", category: "組織貢献", name: "月間MVP", grantDig: 50000, monthlyCapDig: 50000, description: "石井からのMVP", enabled: true },
    { itemId: "B004", category: "健康・勤怠", name: "シフト通りの出勤数", grantDig: 10000, monthlyCapDig: 10000, description: null, enabled: true },
    { itemId: "B005", category: "スキルアップ", name: "資格取得", grantDig: 5000, monthlyCapDig: 15000, description: "業務関連資格", enabled: true },
  ];
  for (const it of bonusItems) {
    await prisma.bonusDigItem.upsert({ where: { itemId: it.itemId }, update: it, create: it });
  }

  // メンバー＋月次評価＋入社時初回借入
  for (const m of MEMBERS) {
    await prisma.member.upsert({
      where: { personId: m.personId },
      update: {},
      create: {
        personId: m.personId,
        name: m.name,
        division: m.division,
        position: m.position,
        jobType: m.jobType,
        employmentType: m.employmentType,
        basePay: m.basePay,
        positionBase: m.positionBase,
        joinedOn: new Date(`${m.joinedOn}T00:00:00Z`),
        evaluationCycle: m.cycle,
        status: "在籍",
      },
    });

    const ev = evaluateMonthly({
      yearMonth: YM,
      personId: m.personId,
      employmentType: m.employmentType,
      positionBase: m.positionBase,
      joinedOn: m.joinedOn,
      leftOn: null,
      evaluationCycle: m.cycle,
      seikaDig: m.seikaDig,
      bonusDig: 0,
      loanDig: 0,
      setting: S,
    });

    await prisma.monthlyEvaluation.upsert({
      where: { yearMonth_personId: { yearMonth: YM, personId: m.personId } },
      update: {},
      create: {
        yearMonth: YM,
        personId: m.personId,
        division: m.division,
        employmentType: m.employmentType,
        positionBase: m.positionBase,
        joinedOn: new Date(`${m.joinedOn}T00:00:00Z`),
        residencyDays: ev.residencyDays,
        prorationCoefficient: ev.prorationCoefficient,
        seatCost: ev.seatCost,
        totalCost: ev.totalCost,
        monthlyBudgetDig: ev.monthlyBudgetDig,
        cumulativeBudgetDig: ev.cumulativeBudgetDig,
        seikaDig: ev.seikaDig,
        bonusDig: ev.bonusDig,
        loanDig: ev.loanDig,
        monthlyActualDig: ev.monthly.actualDig,
        monthlyRate: ev.monthly.achievementRate,
        monthlyRank: ev.monthly.rank,
        cumulativeActualDig: ev.cumulative.actualDig,
        cumulativeRate: ev.cumulative.achievementRate,
        cumulativeRank: ev.cumulative.rank,
        finalized: false,
      },
    });

    // 入社時の必須初回借入（自動承認）
    const init = buildInitialLoan({
      id: `init-${m.personId}`,
      yearMonth: YM,
      borrowerId: m.personId,
      joinedOn: m.joinedOn,
      setting: S,
    });
    await prisma.loan.create({
      data: {
        yearMonth: init.yearMonth,
        borrowerId: init.borrowerId,
        lender: init.lender,
        loanType: init.loanType,
        status: init.status,
        principal: init.principal,
        monthlyRate: init.monthlyRate,
        termMonths: init.termMonths,
        appliedOn: new Date(`${m.joinedOn}T00:00:00Z`),
        approvedBy: init.approvedBy,
        approvedOn: new Date(`${m.joinedOn}T00:00:00Z`),
        note: init.note,
      },
    });
  }

  // 追加借入の申請（承認待ち）
  const rate = monthlyRateFromAnnual(S.annualRatePct);
  await prisma.loan.createMany({
    data: [
      { yearMonth: YM, borrowerId: "B0000097", lender: "ディグロス金融", loanType: "追加", status: "申請中", principal: 1000000, monthlyRate: rate, termMonths: 12, appliedOn: new Date("2026-01-12T00:00:00Z"), reason: "OJT延長に伴う運転資金" },
      { yearMonth: YM, borrowerId: "B0000078", lender: "ディグロス金融", loanType: "追加", status: "申請中", principal: 500000, monthlyRate: rate, termMonths: 6, appliedOn: new Date("2026-01-20T00:00:00Z"), reason: "資格取得費用の立替" },
    ],
  });

  // ボーナスDig記録
  await prisma.bonusDigRecord.createMany({
    data: [
      { yearMonth: YM, recordedOn: new Date("2026-01-05T00:00:00Z"), personId: "B0000098", itemId: "B003", grantedDig: 50000, note: "1月MVP" },
      { yearMonth: YM, recordedOn: new Date("2026-01-08T00:00:00Z"), personId: "B0000097", itemId: "B004", grantedDig: 10000, note: "無欠勤" },
      { yearMonth: YM, recordedOn: new Date("2026-01-10T00:00:00Z"), personId: "B0000078", itemId: "B002", grantedDig: 1000, note: "「営業の魔法」要約" },
    ],
  });

  // 取引記録
  await prisma.transaction.createMany({
    data: [
      { yearMonth: YM, tradedOn: new Date("2026-01-05T00:00:00Z"), payerId: "B0000064", payeeId: "B0000097", amount: 50000, description: "リスト作成代行" },
      { yearMonth: YM, tradedOn: new Date("2026-01-10T00:00:00Z"), payerId: "B0000068", payeeId: "B0000078", amount: 30000, description: "テレアポ業務委託" },
    ],
  });

  const counts = {
    members: await prisma.member.count(),
    evaluations: await prisma.monthlyEvaluation.count(),
    loans: await prisma.loan.count(),
    bonusItems: await prisma.bonusDigItem.count(),
    bonusRecords: await prisma.bonusDigRecord.count(),
    transactions: await prisma.transaction.count(),
  };
  console.log("seeded:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
