/**
 * データアクセス層（Prisma）。API Route Handlers から利用。
 * rawSQL 不使用（CONVENTIONS）。変更系は監査ログを残す。
 */
import { Prisma } from "@prisma/client";
import type { Setting as DbSetting } from "@prisma/client";
import type {
  AssignmentShare,
  CalcRule,
  Contract,
  ContractLineItem,
  EmploymentType,
  EvaluationCycle,
  Setting,
} from "@dig/contracts";
import {
  achievementRate,
  aggregateSeikaDig,
  buildInitialLoan,
  cgChurnDig,
  computeContractDig,
  loanSchedule,
  cumulativeBudgetElapsed,
  cumulativeMonths,
  EMPTY_ORG_OVERRIDE,
  evaluateMonthly,
  evaluationRank,
  inheritedOverride,
  mergeSetting,
  monthDiff,
  ORG_SETTING_KEYS,
  splitDig,
} from "@dig/core";
import type { OrgSettingNode, OrgSettingOverride } from "@dig/core";
import { prisma } from "./db";
import {
  equalsConstantTime,
  generateTemporaryPassword,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "./password";

/** 監査ログ記録 */
export async function audit(
  actor: string,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, entity, entityId, detail } });
}

// ── 読み取り ──
export const listMembers = () =>
  prisma.member.findMany({ orderBy: [{ division: "asc" }, { personId: "asc" }] });

export const listEvaluations = (yearMonth: string) =>
  prisma.monthlyEvaluation.findMany({ where: { yearMonth }, orderBy: { personId: "asc" } });

export const listLoans = () =>
  prisma.loan.findMany({ orderBy: [{ status: "asc" }, { appliedOn: "desc" }] });

export const listBonusItems = () =>
  prisma.bonusDigItem.findMany({ orderBy: { itemId: "asc" } });

export const listBonusRecords = (yearMonth: string) =>
  prisma.bonusDigRecord.findMany({ where: { yearMonth }, orderBy: { recordedOn: "asc" } });

export const listTransactions = (yearMonth: string) =>
  prisma.transaction.findMany({ where: { yearMonth }, orderBy: { tradedOn: "asc" } });

export const getSetting = (yearMonth: string) =>
  prisma.setting.findUnique({ where: { yearMonth } });

// ── 変更 ──
export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/** 借入の承認/却下（申請中のみ・要件 F-5） */
export async function decideLoan(
  loanId: number,
  approve: boolean,
  actor: string,
): Promise<{ id: number; status: string }> {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new NotFoundError("loan not found");
  if (loan.status !== "申請中") throw new ConflictError("既に処理済みの申請です");

  const status = approve ? "承認済" : "却下";
  const updated = await prisma.loan.update({
    where: { id: loanId },
    data: {
      status,
      approvedBy: actor,
      approvedOn: new Date(),
    },
  });
  await audit(actor, approve ? "loan.approve" : "loan.reject", "Loan", String(loanId), {
    principal: loan.principal.toString(),
    borrowerId: loan.borrowerId,
  });
  return { id: updated.id, status: updated.status };
}

/** 会社金利の変更（ディグロス金融・要件 F-5） */
export async function updateAnnualRate(
  yearMonth: string,
  annualRatePct: number,
  actor: string,
): Promise<{ yearMonth: string; annualRatePct: number }> {
  const setting = await prisma.setting.findUnique({ where: { yearMonth } });
  if (!setting) throw new NotFoundError("setting not found");
  await prisma.setting.update({ where: { yearMonth }, data: { annualRatePct } });
  await audit(actor, "setting.rate.update", "Setting", yearMonth, {
    from: setting.annualRatePct.toString(),
    to: annualRatePct,
  });
  return { yearMonth, annualRatePct };
}

/** ボーナスDig記録の追加（要件 F-4） */
export async function createBonusRecord(input: {
  yearMonth: string;
  recordedOn: string;
  personId: string;
  itemId: string;
  grantedDig: number;
  note: string | null;
  actor: string;
}): Promise<{ id: number }> {
  const [member, item] = await Promise.all([
    prisma.member.findUnique({ where: { personId: input.personId } }),
    prisma.bonusDigItem.findUnique({ where: { itemId: input.itemId } }),
  ]);
  if (!member) throw new NotFoundError("member not found");
  if (!item) throw new NotFoundError("bonus item not found");

  const rec = await prisma.bonusDigRecord.create({
    data: {
      yearMonth: input.yearMonth,
      recordedOn: new Date(`${input.recordedOn}T00:00:00Z`),
      personId: input.personId,
      itemId: input.itemId,
      grantedDig: input.grantedDig,
      note: input.note,
    },
  });
  await audit(input.actor, "bonus.create", "BonusDigRecord", String(rec.id), {
    personId: input.personId,
    itemId: input.itemId,
    grantedDig: input.grantedDig,
  });
  return { id: rec.id };
}

/** メンバー間送金（要件 F-6） */
// ─────────────────────────────────────────────
// Dig譲渡（申請 → 受け手の承認で成果Digが移動する）
// ─────────────────────────────────────────────
/**
 * 譲渡を申請する（成果Digはまだ動かない）。
 * 通常の配分ルールはそのままに、当事者間の相対で調整するための仕組み。
 */
export async function createDigTransfer(input: {
  yearMonth: string;
  tradedOn: string;
  payerId: string;
  payeeId: string;
  amount: number;
  description: string;
  note: string | null;
  actor: string;
}) {
  if (input.payerId === input.payeeId) throw new ConflictError("自分自身へは譲渡できません");
  const [payer, payee] = await Promise.all([
    prisma.member.findUnique({ where: { personId: input.payerId } }),
    prisma.member.findUnique({ where: { personId: input.payeeId } }),
  ]);
  if (!payer || !payee) throw new NotFoundError("メンバーが見つかりません");

  // 譲れる範囲（その月の成果Dig）を超える申請は受け付けない。
  const ev = await prisma.monthlyEvaluation.findUnique({
    where: { yearMonth_personId: { yearMonth: input.yearMonth, personId: input.payerId } },
  });
  const available = ev ? ev.seikaDig.toNumber() : 0;
  if (input.amount > available) {
    throw new ConflictError(
      `${payer.name} の ${input.yearMonth} の成果Digは ${available.toLocaleString()} のため、${input.amount.toLocaleString()} は譲渡できません`,
    );
  }

  const txn = await prisma.transaction.create({
    data: {
      yearMonth: input.yearMonth,
      tradedOn: new Date(`${input.tradedOn}T00:00:00Z`),
      payerId: input.payerId,
      payeeId: input.payeeId,
      amount: input.amount,
      description: input.description,
      note: input.note,
      status: "申請中",
      requestedBy: input.actor,
    },
  });
  await audit(input.actor, "transfer.create", "Transaction", String(txn.id), {
    payerId: input.payerId,
    payeeId: input.payeeId,
    amount: input.amount,
  });
  return { id: txn.id, status: txn.status };
}

/**
 * 譲渡の承認／却下。**受け手本人（または ADMIN 以上）だけ**が判定できる。
 * 承認した時点で、対象月の成果Digを譲り手から受け手へ移動する。
 */
export async function decideDigTransfer(
  id: number,
  approve: boolean,
  actor: string,
  rejectReason?: string,
) {
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) throw new NotFoundError("譲渡申請が見つかりません");
  if (txn.status !== "申請中") throw new ConflictError("既に処理済みの申請です");

  const amount = txn.amount.toNumber();
  if (approve) {
    // 承認時点でも残高を再確認する（申請後に成果Digが減っている場合がある）。
    const ev = await prisma.monthlyEvaluation.findUnique({
      where: { yearMonth_personId: { yearMonth: txn.yearMonth, personId: txn.payerId } },
    });
    const available = ev ? ev.seikaDig.toNumber() : 0;
    if (amount > available) {
      throw new ConflictError(
        `譲り手の成果Digが ${available.toLocaleString()} まで減っているため承認できません`,
      );
    }
    await addSeikaDig(txn.yearMonth, txn.payerId, -amount, actor);
    await addSeikaDig(txn.yearMonth, txn.payeeId, amount, actor);
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      status: approve ? "承認済" : "却下",
      decidedBy: actor,
      decidedOn: new Date(),
      rejectReason: approve ? null : (rejectReason ?? null),
    },
  });
  await audit(actor, approve ? "transfer.approve" : "transfer.reject", "Transaction", String(id), {
    payerId: txn.payerId,
    payeeId: txn.payeeId,
    amount,
  });
  return { id: updated.id, status: updated.status };
}

/** 申請者が自分の申請を取り消す（申請中のみ）。 */
export async function cancelDigTransfer(id: number, actor: string) {
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) throw new NotFoundError("譲渡申請が見つかりません");
  if (txn.status !== "申請中") throw new ConflictError("既に処理済みの申請です");
  const updated = await prisma.transaction.update({ where: { id }, data: { status: "取消" } });
  await audit(actor, "transfer.cancel", "Transaction", String(id), {});
  return { id: updated.id, status: updated.status };
}

/** 譲渡の一覧。personId 指定なら本人が関係する分のみ。 */
export async function listDigTransfers(personId?: string) {
  const rows = await prisma.transaction.findMany({
    where: personId ? { OR: [{ payerId: personId }, { payeeId: personId }] } : {},
    orderBy: [{ status: "asc" }, { tradedOn: "desc" }],
    take: 300,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.payerId, r.payeeId]))];
  const members = await prisma.member.findMany({
    where: { personId: { in: ids } },
    select: { personId: true, name: true },
  });
  const nameOf = new Map(members.map((m) => [m.personId, m.name]));
  return rows.map((r) => ({
    id: r.id,
    yearMonth: r.yearMonth,
    tradedOn: r.tradedOn.toISOString().slice(0, 10),
    payerId: r.payerId,
    payerName: nameOf.get(r.payerId) ?? r.payerId,
    payeeId: r.payeeId,
    payeeName: nameOf.get(r.payeeId) ?? r.payeeId,
    amount: r.amount.toNumber(),
    description: r.description,
    note: r.note,
    status: r.status,
    decidedBy: r.decidedBy,
    decidedOn: r.decidedOn ? r.decidedOn.toISOString().slice(0, 10) : null,
    rejectReason: r.rejectReason,
  }));
}

export async function createTransaction(input: {
  yearMonth: string;
  tradedOn: string;
  payerId: string;
  payeeId: string;
  amount: number;
  description: string;
  note: string | null;
  actor: string;
}): Promise<{ id: number }> {
  const [payer, payee] = await Promise.all([
    prisma.member.findUnique({ where: { personId: input.payerId } }),
    prisma.member.findUnique({ where: { personId: input.payeeId } }),
  ]);
  if (!payer || !payee) throw new NotFoundError("member not found");

  const txn = await prisma.transaction.create({
    data: {
      yearMonth: input.yearMonth,
      tradedOn: new Date(`${input.tradedOn}T00:00:00Z`),
      payerId: input.payerId,
      payeeId: input.payeeId,
      amount: input.amount,
      description: input.description,
      note: input.note,
    },
  });
  await audit(input.actor, "transaction.create", "Transaction", String(txn.id), {
    payerId: input.payerId,
    payeeId: input.payeeId,
    amount: input.amount,
  });
  return { id: txn.id };
}

// ─────────────────────────────────────────────
// Dig獲得ルール（CalcRule・要件 F-3）
// ─────────────────────────────────────────────
export const listCalcRules = () =>
  prisma.calcRule.findMany({ orderBy: [{ division: "asc" }, { id: "asc" }] });

export async function upsertCalcRule(input: CalcRule, actor: string) {
  const data = {
    division: input.division,
    name: input.name,
    ruleType: input.ruleType,
    modelKeyFilter: input.modelKeyFilter,
    unitLine: input.unitLine,
    unitCall: input.unitCall,
    ratioPercent: input.ratioPercent,
    fixedDig: input.fixedDig,
    marginRatePct: input.marginRatePct,
    salesSharePct: input.salesSharePct,
    active: input.active,
  };
  const rule = await prisma.calcRule.upsert({
    where: { id: input.id },
    update: data,
    create: { id: input.id, ...data },
  });
  await audit(actor, "calcRule.upsert", "CalcRule", input.id, { division: input.division, ruleType: input.ruleType });
  return rule;
}

// ─────────────────────────────────────────────
// 契約（keiyaku取込）＋帰属＋Dig反映（要件 F-3）
// ─────────────────────────────────────────────
export const listContracts = (yearMonth: string) =>
  prisma.contract.findMany({ where: { yearMonth }, include: { assignment: true }, orderBy: { id: "asc" } });

// ─────────────────────────────────────────────
// 途中解約（チャーン）アラート
// 契約管理DBの途中解約フラグを日次同期で取り込み、
// 管理者がマイナスDigを確定するまで未処理として出し続ける。
// ─────────────────────────────────────────────
export interface ChurnAlert {
  contractId: string;
  contractNo: string | null;
  customerName: string;
  division: string;
  /** 月額（粗利計算のもと） */
  monthlyAmount: number;
  termMonths: number;
  startDate: string | null;
  canceledOn: string | null;
  /** 解約日から契約満了までの残月数 */
  remainingMonths: number;
  /** 残存粗利から自動計算したマイナスDig（負値）。入力欄の初期値に使う */
  suggestedDig: number;
  /** 管理者が確定したマイナスDig。null の間はアラートが消えない */
  churnDig: number | null;
  churnDecidedBy: string | null;
  churnDecidedOn: string | null;
  churnNote: string | null;
  /** 契約に紐づく担当者（マイナスDigを負う候補） */
  shares: { personId: string; sharePercent: number }[];
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** 解約日から契約満了までの残月数（切り上げ・マイナスにはしない）。 */
function remainingMonthsOf(startDate: Date | null, termMonths: number, canceledOn: Date | null): number {
  if (!startDate || termMonths <= 0 || !canceledOn) return 0;
  const end = new Date(startDate);
  end.setMonth(end.getMonth() + termMonths);
  if (canceledOn >= end) return 0;
  const months = monthDiff(ymd(canceledOn)!.slice(0, 7), ymd(end)!.slice(0, 7));
  return Math.max(0, months);
}

/**
 * 途中解約フラグが立っている契約の一覧。
 * `pendingOnly` なら、まだマイナスDigが確定していないもの（＝アラート対象）だけ返す。
 */
export async function listChurnAlerts(pendingOnly = false): Promise<ChurnAlert[]> {
  const rows = await prisma.contract.findMany({
    where: { earlyCancel: true, ...(pendingOnly ? { churnDig: null } : {}) },
    include: { assignment: true },
    orderBy: [{ canceledOn: "desc" }, { id: "asc" }],
  });
  return rows.map((c) => {
    const monthlyAmount = c.baseAmount.toNumber();
    const remaining = remainingMonthsOf(c.startDate, c.termMonths, c.canceledOn);
    return {
      contractId: c.id,
      contractNo: c.contractNo,
      customerName: c.customerName,
      division: c.division,
      monthlyAmount,
      termMonths: c.termMonths,
      startDate: ymd(c.startDate),
      canceledOn: ymd(c.canceledOn),
      remainingMonths: remaining,
      // 途中解約なので atRenewal=false。更新月での解約はフラグが立たない想定。
      suggestedDig: cgChurnDig(monthlyAmount, remaining, false),
      churnDig: c.churnDig ? c.churnDig.toNumber() : null,
      churnDecidedBy: c.churnDecidedBy,
      churnDecidedOn: c.churnDecidedOn ? c.churnDecidedOn.toISOString() : null,
      churnNote: c.churnNote,
      shares: ((c.assignment?.shares ?? []) as AssignmentShare[]).map((s) => ({
        personId: s.personId,
        sharePercent: s.sharePercent,
      })),
    };
  });
}

/** アラートバッジ用の未処理件数。 */
export async function countPendingChurn(): Promise<number> {
  return prisma.contract.count({ where: { earlyCancel: true, churnDig: null } });
}

/**
 * 途中解約のマイナスDigを確定する。確定するとアラートから消える。
 * 金額は負値で保存する（0 を許容＝「マイナスなしで確定」もできる）。
 */
export async function decideChurnDig(
  contractId: string,
  input: { churnDig: number; note?: string | null },
  actor: string,
) {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new NotFoundError("契約が見つかりません");
  if (!contract.earlyCancel) throw new ConflictError("途中解約フラグが立っていない契約です");
  if (!Number.isFinite(input.churnDig)) throw new ConflictError("マイナスDigを入力してください");
  // 正の値で来ても符号を寄せる（画面の入力ゆれを吸収）。
  const value = -Math.abs(Math.round(input.churnDig));
  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: {
      churnDig: value,
      churnDecidedBy: actor,
      churnDecidedOn: new Date(),
      churnNote: input.note?.trim() || null,
    },
  });
  await audit(actor, "contract.churn.decide", "Contract", contractId, { churnDig: value });
  return { contractId, churnDig: updated.churnDig?.toNumber() ?? 0 };
}

/** 確定を取り消してアラートに戻す。 */
export async function clearChurnDig(contractId: string, actor: string) {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new NotFoundError("契約が見つかりません");
  await prisma.contract.update({
    where: { id: contractId },
    data: { churnDig: null, churnDecidedBy: null, churnDecidedOn: null, churnNote: null },
  });
  await audit(actor, "contract.churn.clear", "Contract", contractId, {});
  return { contractId };
}

function pickRule(rules: CalcRule[], division: string, modelKey: string): CalcRule | undefined {
  return rules.find(
    (r) => r.active && r.division === division && (!r.modelKeyFilter || r.modelKeyFilter === modelKey),
  );
}

function toContract(row: {
  id: string; contractNo: string | null; customerName: string; companyId: string | null; division: string; modelKey: string;
  status: string; baseAmount: Prisma.Decimal; setupFee: Prisma.Decimal; initialFee: Prisma.Decimal;
  termMonths: number; startDate: Date | null; lineItems: Prisma.JsonValue;
}): Contract {
  return {
    id: row.id,
    contractNo: row.contractNo,
    customerName: row.customerName,
    companyId: row.companyId,
    division: row.division,
    modelKey: row.modelKey,
    status: row.status,
    baseAmount: row.baseAmount.toNumber(),
    setupFee: row.setupFee.toNumber(),
    initialFee: row.initialFee.toNumber(),
    termMonths: row.termMonths,
    startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
    lineItems: (row.lineItems as unknown as ContractLineItem[]) ?? [],
  };
}

function toCalcRule(row: {
  id: string; division: string; name: string; ruleType: string; modelKeyFilter: string | null;
  unitLine: Prisma.Decimal; unitCall: Prisma.Decimal; ratioPercent: Prisma.Decimal; fixedDig: Prisma.Decimal;
  marginRatePct: Prisma.Decimal; salesSharePct: Prisma.Decimal; active: boolean;
}): CalcRule {
  return {
    id: row.id, division: row.division, name: row.name,
    ruleType: row.ruleType as CalcRule["ruleType"], modelKeyFilter: row.modelKeyFilter,
    unitLine: row.unitLine.toNumber(), unitCall: row.unitCall.toNumber(),
    ratioPercent: row.ratioPercent.toNumber(), fixedDig: row.fixedDig.toNumber(),
    marginRatePct: row.marginRatePct.toNumber(), salesSharePct: row.salesSharePct.toNumber(),
    active: row.active,
  };
}

/** 契約ごとの計算結果（Dig＋帰属）を返す（プレビュー用）。 */
export async function previewContractDig(yearMonth: string) {
  const [contractRows, ruleRows] = await Promise.all([listContracts(yearMonth), listCalcRules()]);
  const rules = ruleRows.map(toCalcRule);
  return contractRows.map((row) => {
    const contract = toContract(row);
    const rule = pickRule(rules, contract.division, contract.modelKey);
    const totalDig = rule ? computeContractDig(contract, rule) : 0;
    const shares = ((row.assignment?.shares as unknown as AssignmentShare[]) ?? []);
    const perPerson = rule && shares.length
      ? splitDig(totalDig, { contractId: contract.id, source: "manual", shares })
      : [];
    return {
      contractId: contract.id,
      contractNo: contract.contractNo,
      customerName: contract.customerName,
      companyId: contract.companyId,
      division: contract.division,
      ruleName: rule?.name ?? null,
      source: row.assignment?.source ?? null,
      totalDig,
      shares,
      perPerson,
    };
  });
}

/** 契約の帰属（折半）を更新（後から修正可能・要件 F-3）。 */
export async function updateAssignment(contractId: string, shares: AssignmentShare[], actor: string) {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new NotFoundError("contract not found");
  await prisma.contractAssignment.upsert({
    where: { contractId },
    update: { source: "manual", shares: shares as unknown as Prisma.InputJsonValue },
    create: { contractId, source: "manual", shares: shares as unknown as Prisma.InputJsonValue },
  });
  await audit(actor, "assignment.update", "ContractAssignment", contractId, { shares: shares as unknown as Prisma.InputJsonValue });
  return { contractId, shares };
}

/** 契約Dig → 各従業員の成果Digへ反映し、月次評価を再計算（要件 F-3）。 */
export async function reflectContractDig(yearMonth: string, actor: string) {
  const [contractRows, ruleRows] = await Promise.all([listContracts(yearMonth), listCalcRules()]);
  const rules = ruleRows.map(toCalcRule);
  const results = contractRows.map((row) => {
    const contract = toContract(row);
    const rule = pickRule(rules, contract.division, contract.modelKey);
    const totalDig = rule ? computeContractDig(contract, rule) : 0;
    const shares = ((row.assignment?.shares as unknown as AssignmentShare[]) ?? []);
    const perPerson = rule && shares.length
      ? splitDig(totalDig, { contractId: contract.id, source: "manual", shares })
      : [];
    return { contractId: contract.id, totalDig, perPerson };
  });

  const seikaByPerson = aggregateSeikaDig(results);
  let updated = 0;
  for (const [personId, seika] of seikaByPerson) {
    const ev = await prisma.monthlyEvaluation.findUnique({
      where: { yearMonth_personId: { yearMonth, personId } },
    });
    if (!ev) continue;
    const bonus = ev.bonusDig.toNumber();
    const loan = ev.loanDig.toNumber();
    const monthlyBudget = ev.monthlyBudgetDig.toNumber();
    const cumBudget = ev.cumulativeBudgetDig.toNumber();
    const monthlyActual = seika + bonus + loan;
    const mRate = achievementRate(monthlyActual, monthlyBudget);
    const cRate = achievementRate(monthlyActual, cumBudget);
    await prisma.monthlyEvaluation.update({
      where: { yearMonth_personId: { yearMonth, personId } },
      data: {
        seikaDig: seika,
        monthlyActualDig: monthlyActual,
        monthlyRate: mRate,
        monthlyRank: evaluationRank(mRate),
        cumulativeActualDig: monthlyActual,
        cumulativeRate: cRate,
        cumulativeRank: evaluationRank(cRate),
      },
    });
    updated += 1;
  }
  await audit(actor, "contract.reflect", "MonthlyEvaluation", yearMonth, { updated, contracts: results.length });
  return { yearMonth, updated, contracts: results.length, perPerson: Object.fromEntries(seikaByPerson) };
}

// ─────────────────────────────────────────────
// マスタ編集（Member / BonusDigItem / Setting・要件 F-1,2,4）
// ─────────────────────────────────────────────
export async function upsertMember(input: {
  personId: string; name: string; division: string; position: string; jobType: string | null;
  employmentType: string; basePay: number; positionBase: number; joinedOn: string;
  evaluationCycle: string; status: string; actor: string;
}) {
  const data = {
    name: input.name, division: input.division,
    // 画面から事業部を編集した場合は個別指定として記録する。
    // これが無いと jinjer 同期／紐づけルールの再適用で元に戻ってしまう。
    divisionOverride: input.division || null,
    position: input.position as Prisma.MemberCreateInput["position"],
    jobType: input.jobType as Prisma.MemberCreateInput["jobType"],
    employmentType: input.employmentType as Prisma.MemberCreateInput["employmentType"],
    basePay: input.basePay, positionBase: input.positionBase,
    joinedOn: new Date(`${input.joinedOn}T00:00:00Z`),
    evaluationCycle: input.evaluationCycle as Prisma.MemberCreateInput["evaluationCycle"],
    status: input.status as Prisma.MemberCreateInput["status"],
  };
  const m = await prisma.member.upsert({ where: { personId: input.personId }, update: data, create: { personId: input.personId, ...data } });
  await audit(input.actor, "member.upsert", "Member", input.personId, { name: input.name });
  return m;
}

export async function deleteMember(personId: string, actor: string) {
  const ev = await prisma.monthlyEvaluation.count({ where: { personId } });
  if (ev > 0) throw new ConflictError("評価データが存在するため削除できません（退社ステータスに変更してください）");
  await prisma.member.delete({ where: { personId } });
  await audit(actor, "member.delete", "Member", personId, {});
  return { personId };
}

export async function upsertBonusItem(input: {
  itemId: string; category: string; name: string; grantDig: number; monthlyCapDig: number; description: string | null; enabled: boolean; actor: string;
}) {
  const data = { category: input.category, name: input.name, grantDig: input.grantDig, monthlyCapDig: input.monthlyCapDig, description: input.description, enabled: input.enabled };
  const it = await prisma.bonusDigItem.upsert({ where: { itemId: input.itemId }, update: data, create: { itemId: input.itemId, ...data } });
  await audit(input.actor, "bonusItem.upsert", "BonusDigItem", input.itemId, { name: input.name });
  return it;
}

export async function updateSetting(input: {
  yearMonth: string; budgetCoefficient: number; insuranceCoefficient: number; annualRatePct: number;
  initialLoanDefault: number; loanTermMonthsDefault: number; commonCostFulltime: number; commonCostParttime: number; actor: string;
}) {
  const s = await prisma.setting.update({
    where: { yearMonth: input.yearMonth },
    data: {
      budgetCoefficient: input.budgetCoefficient, insuranceCoefficient: input.insuranceCoefficient,
      annualRatePct: input.annualRatePct, initialLoanDefault: input.initialLoanDefault,
      loanTermMonthsDefault: input.loanTermMonthsDefault,
      commonCostFulltime: input.commonCostFulltime, commonCostParttime: input.commonCostParttime,
    },
  });
  await audit(input.actor, "setting.update", "Setting", input.yearMonth, {});
  return s;
}

/**
 * 借入の既定値（初回借入額・返済期間）を更新する。金融管理画面から編集する。
 * 金利は updateAnnualRate、予算指標は組織（事業部）側で持つ。
 */
export async function updateLoanDefaults(input: {
  yearMonth: string;
  initialLoanDefault?: number;
  loanTermMonthsDefault?: number;
  actor: string;
}) {
  const data: Prisma.SettingUpdateInput = {};
  if (input.initialLoanDefault !== undefined) data.initialLoanDefault = input.initialLoanDefault;
  if (input.loanTermMonthsDefault !== undefined)
    data.loanTermMonthsDefault = input.loanTermMonthsDefault;
  const s = await prisma.setting.update({ where: { yearMonth: input.yearMonth }, data });
  await audit(input.actor, "setting.loan.update", "Setting", input.yearMonth, {
    initialLoanDefault: input.initialLoanDefault ?? null,
    loanTermMonthsDefault: input.loanTermMonthsDefault ?? null,
  });
  return s;
}

// ─────────────────────────────────────────────
// アカウント・権限（RBAC）
// ─────────────────────────────────────────────
/**
 * アカウント一覧。従業員マスタの事業部を添えて返す（画面で対象事業部に絞るため）。
 * 従業員と紐付いていないアカウントの division は null。
 */
export async function listAccounts() {
  const [accounts, members] = await Promise.all([
    prisma.account.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.member.findMany({ select: { personId: true, division: true, status: true } }),
  ]);
  const byPerson = new Map(members.map((m) => [m.personId, m]));
  return accounts.map((a) => {
    const m = a.personId ? byPerson.get(a.personId) : undefined;
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      personId: a.personId,
      active: a.active,
      division: m?.division ?? null,
      memberStatus: m?.status ?? null,
      /** 会社メールが取れず従業員IDから生成した仮メールか */
      placeholderEmail: isPlaceholderEmail(a.email, a.personId),
      /** パスワード発行済みか（平文は返さない） */
      hasPassword: Boolean(a.passwordHash),
      mustChangePassword: a.mustChangePassword,
      lastLoginAt: a.lastLoginAt,
    };
  });
}

export async function upsertAccount(input: {
  id: string; email: string; name: string; role: string; personId: string | null; active: boolean; actor: string;
}) {
  const data = {
    email: input.email, name: input.name,
    role: input.role as Prisma.AccountCreateInput["role"],
    personId: input.personId, active: input.active,
  };
  const acc = await prisma.account.upsert({ where: { id: input.id }, update: data, create: { id: input.id, ...data } });
  await audit(input.actor, "account.upsert", "Account", input.id, { role: input.role });
  return acc;
}

export async function deleteAccount(id: string, actor: string) {
  await prisma.account.delete({ where: { id } });
  await audit(actor, "account.delete", "Account", id, {});
  return { id };
}

/** アカウント一括発行のメール既定ドメイン（jinjer にメールが無い人の補完用）。 */
const ACCOUNT_EMAIL_DOMAIN = process.env.ACCOUNT_EMAIL_DOMAIN ?? "dgloss.co.jp";

/** 会社メールが取れなかった人へ発行する仮メール（従業員ID@ドメイン）。 */
export function placeholderEmailFor(personId: string): string {
  return `${personId.toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`;
}

/** そのメールが仮メール（従業員IDから生成したもの）か。 */
export function isPlaceholderEmail(email: string, personId: string | null): boolean {
  if (!personId) return false;
  return email.trim().toLowerCase() === placeholderEmailFor(personId);
}

/** 氏名の突合用に空白（半角/全角）を除いて比較する。 */
const normalizeName = (s: string): string => s.replace(/[\s　]/g, "");

export interface SessionAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  personId: string | null;
  active: boolean;
  /** どの方法で従業員マスタと突合したか（画面の案内用） */
  matchedBy: "account" | "member-email" | "member-name" | "none";
}

function toSessionAccount(a: {
  id: string;
  email: string;
  name: string;
  role: string;
  personId: string | null;
  active: boolean;
}): Omit<SessionAccount, "matchedBy"> {
  return { id: a.id, email: a.email, name: a.name, role: a.role, personId: a.personId, active: a.active };
}

/**
 * サインインしたメールから利用アカウントを解決する（初回サインインで自動登録）。
 * 突合の優先順位:
 *   1. Account.email 一致 … 既存の権限をそのまま使う（ADMIN を降格させない）
 *   2. Member.email（会社メール）一致 … その personId に紐付ける
 *   3. Member.name 一致 … 氏名で紐付ける（会社メールが未登録の人向け・同姓同名は紐付けない）
 * 仮メール（従業員ID@ドメイン）で先に発行済みの行があれば、実メールへ差し替える。
 * どれにも当たらない場合は personId=null の USER として作り、管理画面で紐付け待ちにする。
 */
export async function resolveSessionAccount(
  email: string,
  displayName: string | null,
): Promise<SessionAccount> {
  const mail = email.trim().toLowerCase();

  // 1. 既存アカウント（メール一致）
  const byEmail = await prisma.account.findFirst({ where: { email: mail } });
  if (byEmail) {
    if (!byEmail.active) throw new ConflictError("このアカウントは無効化されています");
    return { ...toSessionAccount(byEmail), matchedBy: "account" };
  }

  // 2. 従業員マスタの会社メール一致
  let member = await prisma.member.findFirst({ where: { email: mail, status: "在籍" } });
  let matchedBy: SessionAccount["matchedBy"] = member ? "member-email" : "none";

  // 3. 氏名一致（会社メールが未登録の人向け）。同姓同名は自動で決められないため紐付けない。
  if (!member && displayName) {
    const target = normalizeName(displayName);
    const candidates = await prisma.member.findMany({
      where: { status: "在籍" },
      select: { personId: true, name: true },
    });
    const hits = candidates.filter((m) => normalizeName(m.name) === target);
    if (hits.length === 1) {
      member = await prisma.member.findUnique({ where: { personId: hits[0].personId } });
      matchedBy = "member-name";
    }
  }

  const name = member?.name ?? displayName ?? mail;

  if (member) {
    // 仮メールで発行済みの行があれば実メールへ差し替える（重複行を作らない）。
    const existing = await prisma.account.findFirst({ where: { personId: member.personId } });
    if (existing) {
      const updated = await prisma.account.update({
        where: { id: existing.id },
        data: { id: mail, email: mail, name, active: true },
      });
      await audit(mail, "account.login.relink", "Account", mail, {
        from: existing.email,
        personId: member.personId,
        matchedBy,
      });
      return { ...toSessionAccount(updated), matchedBy };
    }
    // 氏名突合で会社メールが未登録だった場合は、従業員マスタ側にも記録しておく。
    if (!member.email) {
      await prisma.member.update({ where: { personId: member.personId }, data: { email: mail } });
    }
  }

  const created = await prisma.account.create({
    data: { id: mail, email: mail, name, role: "USER", personId: member?.personId ?? null, active: true },
  });
  await audit(mail, "account.login.create", "Account", mail, {
    personId: member?.personId ?? null,
    matchedBy,
  });
  return { ...toSessionAccount(created), matchedBy };
}

/** 紐付け待ち（personId 未設定）のアカウント一覧。管理画面で従業員を選んで紐付ける。 */
export async function listUnlinkedAccounts() {
  return prisma.account.findMany({
    where: { personId: null },
    select: { id: true, email: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}

export interface ProvisionAccountsResult {
  /** 対象となった在籍メンバー数 */
  targets: number;
  created: number;
  /** 既にアカウントがあり、権限を維持したまま氏名・紐付けだけ更新した数 */
  updated: number;
  /** メールが確定できず発行できなかった人 */
  skipped: { personId: string; name: string; reason: string }[];
  /** jinjer のメールが無く personId から仮メールを生成した人（要修正） */
  placeholders: { personId: string; name: string; email: string }[];
  /** 仮メールから会社メールへ差し替えた人 */
  emailUpgraded: { personId: string; name: string; from: string; to: string }[];
  /**
   * 発行した仮パスワード（平文）。この応答でしか取得できない（DBにはハッシュのみ保存）。
   * 画面で一覧・CSV出力し、各自へ配布したら破棄する。
   */
  credentials: { personId: string; name: string; email: string; temporaryPassword: string }[];
}

/**
 * 在籍メンバーへ USER 権限のアカウントを一括発行する。
 * - メールは Member.email（jinjer 由来）を使い、無ければ `<personId小文字>@ACCOUNT_EMAIL_DOMAIN` を仮発行する
 *   （仮メールは placeholders として返し、画面で「要修正」と分かるようにする）
 * - 既存アカウントの role は変更しない（ADMIN / SUPER_ADMIN を降格させない）
 * - divisions を渡すとその事業部のみ、省略時は全在籍メンバーが対象
 */
export async function provisionMemberAccounts(input: {
  actor: string;
  divisions?: string[];
  role?: string;
  /** true なら jinjer にメールが無い人を仮メールで発行しない（skipped に回す） */
  requireRealEmail?: boolean;
  /** true なら各自の仮パスワードを生成する（既にパスワードがある人は再発行しない） */
  issuePasswords?: boolean;
  /** true なら既にパスワードがある人も仮パスワードを再発行する */
  resetExisting?: boolean;
}): Promise<ProvisionAccountsResult> {
  const role = (input.role ?? "USER") as Prisma.AccountCreateInput["role"];
  const members = await prisma.member.findMany({
    where: {
      status: "在籍",
      ...(input.divisions && input.divisions.length > 0 ? { division: { in: input.divisions } } : {}),
    },
    select: { personId: true, name: true, email: true },
    orderBy: { personId: "asc" },
  });

  const result: ProvisionAccountsResult = {
    targets: members.length,
    created: 0,
    updated: 0,
    skipped: [],
    placeholders: [],
    emailUpgraded: [],
    credentials: [],
  };

  // 既存アカウントを事前に一括取得する（1件ずつ問い合わせると往復が多く、
  // 人数が増えたときにサーバの実行時間制限に当たるため）。
  const allAccounts = await prisma.account.findMany({
    select: { id: true, email: true, personId: true, passwordHash: true },
  });
  const byPersonId = new Map(allAccounts.filter((a) => a.personId).map((a) => [a.personId as string, a]));
  const byEmail = new Map(allAccounts.map((a) => [a.email, a]));

  for (const m of members) {
    const real = (m.email ?? "").trim().toLowerCase();
    const email = real || `${m.personId.toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`;
    if (!real && input.requireRealEmail) {
      result.skipped.push({ personId: m.personId, name: m.name, reason: "jinjerにメールが無い" });
      continue;
    }
    if (!real) result.placeholders.push({ personId: m.personId, name: m.name, email });

    // 既存（personId 紐付け or 同一メール）があれば role は触らず紐付けと氏名だけ更新。
    const existing = byPersonId.get(m.personId) ?? byEmail.get(email);
    if (existing) {
      // パスワード未設定（または再発行指定）のときだけ仮パスワードを発行する。
      const needPassword =
        input.issuePasswords === true && (input.resetExisting === true || !existing.passwordHash);
      const temp = needPassword ? generateTemporaryPassword() : null;

      // 仮メールで作ったアカウントに、後から jinjer の会社メールが取れた場合は
      // 実メールへ差し替える（同期前に作ったアカウントが仮メールのまま残らないように）。
      const upgradeEmail =
        real !== "" &&
        existing.email !== real &&
        isPlaceholderEmail(existing.email, existing.personId ?? m.personId);
      if (upgradeEmail) {
        // 差し替え先が既に別アカウントで使われている場合は触らない（重複を作らない）。
        if (byEmail.has(real)) {
          result.skipped.push({
            personId: m.personId,
            name: m.name,
            reason: `会社メール ${real} が別のアカウントで使用中のため差し替えできません`,
          });
        }
      }
      const canUpgrade = upgradeEmail && !byEmail.has(real);

      const updated = await prisma.account.update({
        where: { id: existing.id },
        data: {
          name: m.name,
          personId: m.personId,
          active: true,
          ...(canUpgrade ? { id: real, email: real } : {}),
          ...(temp ? { passwordHash: hashPassword(temp), mustChangePassword: true } : {}),
        },
      });
      if (canUpgrade) {
        result.emailUpgraded.push({ personId: m.personId, name: m.name, from: existing.email, to: real });
        byEmail.delete(existing.email);
        byEmail.set(real, { ...existing, id: real, email: real });
        byPersonId.set(m.personId, { ...existing, id: real, email: real });
      }
      if (temp) {
        result.credentials.push({
          personId: m.personId,
          name: m.name,
          email: updated.email,
          temporaryPassword: temp,
        });
      }
      result.updated += 1;
      continue;
    }
    try {
      const temp = input.issuePasswords === true ? generateTemporaryPassword() : null;
      await prisma.account.create({
        data: {
          id: email,
          email,
          name: m.name,
          role,
          personId: m.personId,
          active: true,
          ...(temp ? { passwordHash: hashPassword(temp), mustChangePassword: true } : {}),
        },
      });
      if (temp) {
        result.credentials.push({ personId: m.personId, name: m.name, email, temporaryPassword: temp });
      }
      result.created += 1;
    } catch {
      // メール重複などで作れないケースはスキップして続行する。
      result.skipped.push({ personId: m.personId, name: m.name, reason: "アカウント作成に失敗（メール重複の可能性）" });
    }
  }

  await audit(input.actor, "account.provision", "Account", null, {
    divisions: input.divisions ?? "all",
    role,
    targets: result.targets,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped.length,
    placeholders: result.placeholders.length,
    emailUpgraded: result.emailUpgraded.length,
    // 平文は監査ログにも残さない（件数のみ）。
    passwordsIssued: result.credentials.length,
  });
  return result;
}

/**
 * 1アカウントの仮パスワードを再発行する（平文はこの戻り値のみ・DBはハッシュ）。
 * 次回ログイン時にパスワード変更を強制する。
 */
export async function issueTemporaryPassword(accountId: string, actor: string) {
  const acc = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acc) throw new NotFoundError("アカウントが見つかりません");
  const temp = generateTemporaryPassword();
  await prisma.account.update({
    where: { id: accountId },
    data: { passwordHash: hashPassword(temp), mustChangePassword: true },
  });
  await audit(actor, "account.password.issue", "Account", accountId, {});
  return { id: acc.id, email: acc.email, name: acc.name, temporaryPassword: temp };
}

/**
 * 指定したアカウントへ仮パスワードを発行する（分割実行用）。
 * 1リクエストの処理量を呼び出し側で制御できるようにし、件数が多くても
 * サーバの実行時間制限に当たらないようにする。
 * 既にパスワードがある人は resetExisting=true のときだけ再発行する。
 */
export async function issueTemporaryPasswords(
  ids: string[],
  actor: string,
  resetExisting = false,
) {
  const accounts = await prisma.account.findMany({ where: { id: { in: ids } } });
  const credentials: Array<{ id: string; name: string; email: string; temporaryPassword: string }> = [];
  let skipped = 0;

  for (const acc of accounts) {
    if (acc.passwordHash && !resetExisting) {
      skipped += 1; // 既に本人のパスワードがある人は触らない
      continue;
    }
    const temp = generateTemporaryPassword();
    await prisma.account.update({
      where: { id: acc.id },
      data: { passwordHash: hashPassword(temp), mustChangePassword: true },
    });
    credentials.push({ id: acc.id, name: acc.name, email: acc.email, temporaryPassword: temp });
  }

  // 平文は監査ログに残さない（件数のみ）。
  await audit(actor, "account.password.issue.bulk", "Account", null, {
    requested: ids.length,
    issued: credentials.length,
    skipped,
  });
  return { credentials, skipped, notFound: ids.length - accounts.length };
}

/**
 * メールアドレスとパスワードでログインを検証する。
 * 成功時は最終ログイン日時を更新し、セッションに載せる情報を返す。
 */
export async function verifyCredentials(email: string, password: string) {
  const mail = email.trim().toLowerCase();

  // 初期管理者の緊急ログイン。BOOTSTRAP_ADMIN_EMAIL と BOOTSTRAP_ADMIN_PASSWORD の
  // 両方が設定され、両方一致したときだけスーパーADMINとして入れる。
  // パスワードを持つアカウントが1つも無い状態（＝誰もログインできない）から
  // 抜け出すための出口。使い終わったら Vercel から2つの環境変数を削除する。
  const boot = await bootstrapAdminLogin(mail, password);
  if (boot) return boot;

  const acc = await prisma.account.findFirst({ where: { email: mail } });
  // 存在しない場合もダミー照合を行い、応答時間からアカウントの有無が分からないようにする。
  const ok = verifyPassword(password, acc?.passwordHash ?? null);
  if (!acc || !ok || !acc.active) return null;
  await prisma.account.update({ where: { id: acc.id }, data: { lastLoginAt: new Date() } });
  await audit(acc.id, "account.login.password", "Account", acc.id, {});
  return {
    id: acc.id,
    email: acc.email,
    name: acc.name,
    role: acc.role,
    personId: acc.personId,
    mustChangePassword: acc.mustChangePassword,
  };
}

/**
 * 初期管理者の緊急ログイン。環境変数で指定したメール・パスワードが一致した場合に
 * そのアカウントをスーパーADMINとして用意し、パスワード変更を要求する。
 * 環境変数は Vercel でしか設定できないため、外部から悪用される経路はない。
 */
async function bootstrapAdminLogin(mail: string, password: string) {
  const bootEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const bootPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!bootEmail || !bootPassword) return null;
  if (mail !== bootEmail) return null;
  // 総当たりでの推測を避けるため、長さが同じでも定数時間で比較する。
  if (!equalsConstantTime(password, bootPassword)) return null;

  const existing = await prisma.account.findFirst({ where: { email: mail } });
  const data = {
    email: mail,
    name: existing?.name ?? "初期管理者",
    role: "SUPER_ADMIN" as const,
    active: true,
    // 緊急ログイン後は必ず自分のパスワードへ変更させる。
    passwordHash: hashPassword(bootPassword),
    mustChangePassword: true,
    lastLoginAt: new Date(),
  };
  const acc = existing
    ? await prisma.account.update({ where: { id: existing.id }, data })
    : await prisma.account.create({ data: { id: mail, ...data, personId: null } });
  await audit(mail, "account.login.bootstrap", "Account", acc.id, { created: !existing });
  return {
    id: acc.id,
    email: acc.email,
    name: acc.name,
    role: acc.role,
    personId: acc.personId,
    mustChangePassword: true,
  };
}

/**
 * 本人がパスワードを変更する。仮パスワードの状態（mustChangePassword）でも
 * 現在のパスワードの入力を必須にする（他人が乗っ取れないようにする）。
 */
export async function changeOwnPassword(email: string, current: string, next: string) {
  const mail = email.trim().toLowerCase();
  const acc = await prisma.account.findFirst({ where: { email: mail } });
  if (!acc || !acc.active) throw new NotFoundError("アカウントが見つかりません");
  if (!verifyPassword(current, acc.passwordHash)) {
    throw new ConflictError("現在のパスワードが違います");
  }
  const invalid = validatePassword(next);
  if (invalid) throw new ConflictError(invalid);
  if (verifyPassword(next, acc.passwordHash)) {
    throw new ConflictError("現在と同じパスワードは使用できません");
  }
  await prisma.account.update({
    where: { id: acc.id },
    data: { passwordHash: hashPassword(next), mustChangePassword: false },
  });
  await audit(acc.id, "account.password.change", "Account", acc.id, {});
  return { id: acc.id };
}

// ─────────────────────────────────────────────
// SP_CRM 連携（企業ID→担当者→自動帰属）
// ─────────────────────────────────────────────
import { resolveAssigneesByCompany, spcrmConnected } from "./spcrm";

/** SP_CRM の担当者から契約の帰属(source=sfa)を自動生成（既存 manual は上書きしない）。 */
export async function assignFromSfa(yearMonth: string, actor: string) {
  const contracts = await prisma.contract.findMany({
    where: { yearMonth },
    include: { assignment: true },
  });
  const results: { contractId: string; applied: boolean; note: string }[] = [];
  for (const c of contracts) {
    if (c.assignment?.source === "manual") {
      results.push({ contractId: c.id, applied: false, note: "手動設定のためスキップ" });
      continue;
    }
    const { shares, note } = await resolveAssigneesByCompany({
      companyId: c.companyId,
      companyName: c.customerName, // ID整理までは企業名でマッチング（暫定）
    });
    if (!shares.length) {
      results.push({ contractId: c.id, applied: false, note });
      continue;
    }
    await prisma.contractAssignment.upsert({
      where: { contractId: c.id },
      update: { source: "sfa", shares: shares as unknown as Prisma.InputJsonValue },
      create: { contractId: c.id, source: "sfa", shares: shares as unknown as Prisma.InputJsonValue },
    });
    results.push({ contractId: c.id, applied: true, note });
  }
  const applied = results.filter((r) => r.applied).length;
  await audit(actor, "assignment.from_sfa", "ContractAssignment", yearMonth, { applied, spcrmConnected });
  return { yearMonth, applied, total: contracts.length, spcrmConnected, results };
}

// ─────────────────────────────────────────────
// 改善リクエスト
// ─────────────────────────────────────────────
export const listFeatureRequests = () =>
  prisma.featureRequest.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] });

export async function createFeatureRequest(input: {
  title: string; body: string | null; category: string; page: string | null; createdBy: string;
}) {
  const r = await prisma.featureRequest.create({
    data: { title: input.title, body: input.body, category: input.category, page: input.page, createdBy: input.createdBy, status: "未対応" },
  });
  return { id: r.id };
}

export async function updateRequestStatus(id: number, status: string, actor: string) {
  const r = await prisma.featureRequest.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("request not found");
  await prisma.featureRequest.update({ where: { id }, data: { status } });
  await audit(actor, "request.status", "FeatureRequest", String(id), { status });
  return { id, status };
}

// ─────────────────────────────────────────────
// 借入申請・承認チャット（会社/相対・添付・差し戻し・未読）
// ─────────────────────────────────────────────
import type { LoanApplication, LoanDecision } from "@dig/contracts";
import { COMPANY_LENDER, DECISION_TO_STATUS } from "@dig/contracts";

/** 借入申請を作成（会社=ディグロス金融 / 相対=メンバー）。初期メッセージ＋添付を登録。 */
export async function createLoanApplication(input: LoanApplication) {
  const borrower = await prisma.member.findUnique({ where: { personId: input.borrowerId } });
  if (!borrower) throw new NotFoundError("申請者(従業員)が見つかりません");
  const lender = input.lenderKind === "会社" ? COMPANY_LENDER : input.lenderPersonId;
  if (input.lenderKind === "相対") {
    if (!input.lenderPersonId) throw new NotFoundError("相対の貸し手を指定してください");
    const l = await prisma.member.findUnique({ where: { personId: input.lenderPersonId } });
    if (!l) throw new NotFoundError("貸し手(従業員)が見つかりません");
  }
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const loan = await prisma.loan.create({
    data: {
      yearMonth: ym,
      borrowerId: input.borrowerId,
      lender: lender!,
      loanType: "追加",
      status: "申請中",
      principal: input.principal,
      monthlyRate: 0.01,
      termMonths: input.termMonths,
      appliedOn: now,
      reason: input.reason,
      messages: {
        create: {
          authorId: input.applicantAccountId,
          authorName: input.applicantName,
          kind: "apply",
          body: `借入申請（${input.lenderKind}）: ${input.principal.toLocaleString()}Dig / ${input.termMonths}ヶ月\n用途: ${input.reason}`,
        },
      },
      attachments: {
        create: input.attachments.map((a) => ({
          fileName: a.fileName,
          category: a.category,
          note: a.note,
          uploadedBy: input.applicantName,
        })),
      },
    },
  });
  await audit(input.applicantAccountId, "loan.apply", "Loan", String(loan.id), {
    lenderKind: input.lenderKind,
    principal: input.principal,
  });
  return { id: loan.id };
}

export async function getLoanThread(loanId: number) {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!loan) throw new NotFoundError("借入が見つかりません");
  return loan;
}

export async function postLoanMessage(loanId: number, body: string, authorId: string, authorName: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new NotFoundError("借入が見つかりません");
  const m = await prisma.loanMessage.create({
    data: { loanId, authorId, authorName, kind: "comment", body },
  });
  return { id: m.id };
}

/** 承認/否決/差し戻し（コメント付き・チャットに記録）。 */
export async function decideLoanApplication(loanId: number, d: LoanDecision) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new NotFoundError("借入が見つかりません");
  if (loan.status !== "申請中" && loan.status !== "差し戻し")
    throw new ConflictError("申請中/差し戻し のみ処理できます");

  const status = DECISION_TO_STATUS[d.decision];
  await prisma.loan.update({
    where: { id: loanId },
    data: {
      status: status as Prisma.LoanUpdateInput["status"],
      approvedBy: d.decision === "承認" ? d.actorAccountId : null,
      approvedOn: d.decision === "承認" ? new Date() : null,
    },
  });
  await prisma.loanMessage.create({
    data: {
      loanId,
      authorId: d.actorAccountId,
      authorName: d.actorName,
      kind: d.decision === "承認" ? "approve" : d.decision === "否決" ? "reject" : "return",
      body: `【${d.decision}】${d.comment ?? ""}`.trim(),
    },
  });
  // Q12: 相対貸借の承認はゼロサム（貸し手→借り手の送金として記録）
  if (d.decision === "承認" && loan.lender !== COMPANY_LENDER) {
    await prisma.transaction.create({
      data: {
        yearMonth: loan.yearMonth,
        tradedOn: new Date(),
        payerId: loan.lender, // 貸し手（Dig減）
        payeeId: loan.borrowerId, // 借り手（Dig増）
        amount: loan.principal,
        description: "相対貸付（承認）",
        note: `Loan#${loanId}`,
      },
    });
  }

  await audit(d.actorAccountId, `loan.${d.decision}`, "Loan", String(loanId), { status });
  return { id: loanId, status };
}

/** 申請者が差し戻し後に再申請（申請中に戻す）。 */
export async function resubmitLoan(loanId: number, authorId: string, authorName: string, body: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new NotFoundError("借入が見つかりません");
  if (loan.status !== "差し戻し") throw new ConflictError("差し戻し のみ再申請できます");
  await prisma.loan.update({ where: { id: loanId }, data: { status: "申請中" } });
  await prisma.loanMessage.create({
    data: { loanId, authorId, authorName, kind: "comment", body: `【再申請】${body}`.trim() },
  });
  return { id: loanId, status: "申請中" };
}

export async function markThreadRead(loanId: number, accountId: string) {
  await prisma.loanRead.upsert({
    where: { loanId_accountId: { loanId, accountId } },
    update: { lastReadAt: new Date() },
    create: { loanId, accountId, lastReadAt: new Date() },
  });
  return { loanId };
}

/** 未読数（iPhoneバッジ風）。account が関与するスレッドの未読メッセージ合計と内訳。 */
export async function unreadCounts(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { total: 0, perLoan: {} as Record<number, number> };

  // 関与スレッド: 申請者(自分のpersonId) / 相対の貸し手 / 会社承認(SUPER_ADMIN)
  const or: Prisma.LoanWhereInput[] = [];
  if (account.personId) {
    or.push({ borrowerId: account.personId });
    or.push({ lender: account.personId });
  }
  if (account.role === "SUPER_ADMIN") or.push({ lender: COMPANY_LENDER });
  if (or.length === 0) return { total: 0, perLoan: {} };

  const loans = await prisma.loan.findMany({
    where: { OR: or },
    include: { messages: true, reads: { where: { accountId } } },
  });

  const perLoan: Record<number, number> = {};
  let total = 0;
  for (const loan of loans) {
    const lastRead = loan.reads[0]?.lastReadAt ?? new Date(0);
    const unread = loan.messages.filter(
      (m) => m.authorId !== accountId && m.createdAt > lastRead,
    ).length;
    if (unread > 0) {
      perLoan[loan.id] = unread;
      total += unread;
    }
  }
  return { total, perLoan };
}

// ─────────────────────────────────────────────
// 期末確定（Q8）: 評価を凍結し、インセン・昇降級を確定
// ─────────────────────────────────────────────
import { computeQuarterBalance, promotionRate, promotionStepDual } from "@dig/core";
import { INCENTIVE_RATE } from "@dig/contracts";
import { DEFAULT_SETTING } from "@dig/contracts";

/** 対象月の評価を確定（finalized=true）し、インセン・昇降級のスナップショットを返す（Q8）。 */
export async function finalizeMonth(yearMonth: string, actor: string) {
  const evals = await prisma.monthlyEvaluation.findMany({ where: { yearMonth } });
  // インセンティブの還元率は組織ごと（カスタマーグロースは5%・既定は20%）。
  const rates = await incentiveRateMap();
  // 昇降級のしきい値も事業部ごとに上書きできる（未設定は全社設定を継承）。
  const settingRow = await prisma.setting.findUnique({ where: { yearMonth } });
  const baseSetting = settingRow ? toSetting(settingRow) : DEFAULT_SETTING;
  const settings = await settingMap(baseSetting);
  const snapshot = evals.map((ev) => {
    const seika = ev.seikaDig.toNumber();
    const bonus = ev.bonusDig.toNumber();
    const loan = ev.loanDig.toNumber();
    const budget = ev.monthlyBudgetDig.toNumber();
    // Q2/Q5案2: インセン原資=成果+ボーナス（借入除外）
    const qb = computeQuarterBalance({
      personId: ev.personId,
      gross: seika,
      target: budget,
      bonus,
      incentiveRate: rates.get(ev.personId),
    });
    // Q1案1: 昇級=借入抜き / 降級=借入込み
    const step = promotionStepDual({
      actualRate: ev.monthlyRate.toNumber(),
      promoRate: promotionRate(seika, bonus, budget),
      setting: settings.get(ev.personId) ?? baseSetting,
    });
    return { personId: ev.personId, incentive: qb.incentive, balance: qb.balance, promotionStep: step, rank: ev.monthlyRank };
  });

  await prisma.monthlyEvaluation.updateMany({ where: { yearMonth }, data: { finalized: true } });
  await audit(actor, "evaluation.finalize", "MonthlyEvaluation", yearMonth, { count: evals.length });
  return { yearMonth, finalized: evals.length, snapshot };
}

// ─────────────────────────────────────────────
// 実運用: 対象月の評価台帳を実メンバーから生成（未作成分のみ）
// ─────────────────────────────────────────────
/** DB の Setting 行 → @dig/core が使う Setting 値オブジェクトへ変換。 */
function toSetting(row: DbSetting): Setting {
  return {
    insuranceCoefficient: row.insuranceCoefficient.toNumber(),
    budgetCoefficient: row.budgetCoefficient.toNumber(),
    annualRatePct: row.annualRatePct.toNumber(),
    initialLoanDefault: row.initialLoanDefault.toNumber(),
    loanTermMonthsDefault: row.loanTermMonthsDefault,
    commonCostFulltime: row.commonCostFulltime.toNumber(),
    commonCostParttime: row.commonCostParttime.toNumber(),
    promotion: {
      upTwo: row.promotionUpTwo.toNumber(),
      upOne: row.promotionUpOne.toNumber(),
      downOne: row.promotionDownOne.toNumber(),
      downTwo: row.promotionDownTwo.toNumber(),
    },
  };
}

// ─────────────────────────────────────────────
// Dig制度の対象事業部
// ─────────────────────────────────────────────
/** 対象事業部の一覧（空なら全事業部が対象）。 */
export async function listTargetDivisions(): Promise<string[]> {
  const rows = await prisma.targetDivision.findMany({ orderBy: { division: "asc" } });
  return rows.map((r) => r.division);
}

/** 対象事業部を設定し直す（差し替え）。 */
export async function setTargetDivisions(divisions: string[], actor: string) {
  const list = [...new Set(divisions.map((d) => d.trim()).filter(Boolean))];
  await prisma.targetDivision.deleteMany({});
  if (list.length > 0) {
    await prisma.targetDivision.createMany({ data: list.map((division) => ({ division })) });
  }
  await audit(actor, "target_division.set", "TargetDivision", null, { divisions: list });
  return { divisions: list };
}

/**
 * 対象外事業部の評価行を削除する（対象範囲を絞ったあとの整理用）。
 * 確定済みの行は残す。
 */
export async function pruneEvaluationsOutOfScope(yearMonth: string, actor: string) {
  const scopeIds = await targetPersonIds();
  const targets = scopeIds === null ? await listTargetDivisions() : [];
  if (scopeIds === null && targets.length === 0) return { deleted: 0 };
  const keep =
    scopeIds ??
    (
      await prisma.member.findMany({
        where: { status: "在籍", division: { in: targets } },
        select: { personId: true },
      })
    ).map((m) => m.personId);
  const res = await prisma.monthlyEvaluation.deleteMany({
    where: { yearMonth, finalized: false, personId: { notIn: keep } },
  });
  await audit(actor, "evaluation.prune", "MonthlyEvaluation", yearMonth, { deleted: res.count, targets });
  return { deleted: res.count };
}


/**
 * 予算Digの確定処理。
 * - 運用指定（BudgetOverride）があれば単月予算を上書き。
 * - 累計予算は要件Q7に従い「入社月の翌月から評価月まで（サイクル月数で上限）」で按分。
 *   例: 8月入社・四半期なら 8月時点の累計対象月数は0、9月で1ヶ月分。
 */
function applyBudgetOverride(
  ev: { monthlyBudgetDig: number; monthly: { actualDig: number }; cumulative: { actualDig: number } },
  override: number | undefined,
  cycle: EvaluationCycle,
  joinedYm: string,
  targetYm: string,
) {
  const cycleLen = cycle === "四半期" ? 3 : 6;
  const monthlyBudgetDig = typeof override === "number" ? override : ev.monthlyBudgetDig;
  const months = cumulativeMonths(joinedYm, targetYm, cycleLen);
  const cumulativeBudgetDig = cumulativeBudgetElapsed(monthlyBudgetDig, months);
  const monthlyRate = achievementRate(ev.monthly.actualDig, monthlyBudgetDig);
  const cumulativeRate = achievementRate(ev.cumulative.actualDig, cumulativeBudgetDig);
  return {
    monthlyBudgetDig,
    cumulativeBudgetDig,
    cumulativeMonths: months,
    monthlyRate,
    monthlyRank: evaluationRank(monthlyRate),
    cumulativeRate,
    cumulativeRank: evaluationRank(cumulativeRate),
  };
}

/**
 * グループ長の評価をグループ合計（自分＋配下）に更新する。
 * 配下の予算/実績を合算し、達成率・ランクを再計算する（Q9: 管理職はグループで評価）。
 */
async function aggregateGroupEvaluations(yearMonth: string) {
  const byLeader = new Map<string, string[]>();

  // ① 組織（グループ/チーム）に長が設定されていれば、その配下メンバーを合算対象にする。
  const [units, allMembers] = await Promise.all([
    prisma.orgUnit.findMany(),
    prisma.member.findMany({
      where: { status: "在籍" },
      select: { personId: true, orgUnitId: true, groupLeaderId: true, aggregateMode: true },
    }),
  ]);
  if (units.length > 0) {
    const childrenOf = new Map<number, number[]>();
    for (const u of units) {
      if (u.parentId !== null) childrenOf.set(u.parentId, [...(childrenOf.get(u.parentId) ?? []), u.id]);
    }
    const subtree = (id: number): number[] => {
      const out = [id];
      for (const c of childrenOf.get(id) ?? []) out.push(...subtree(c));
      return out;
    };
    for (const u of units) {
      if (!u.leaderId) continue;
      const ids = new Set(subtree(u.id));
      const subs = allMembers
        .filter((m) => m.orgUnitId !== null && ids.has(m.orgUnitId) && m.personId !== u.leaderId)
        .map((m) => m.personId);
      if (subs.length > 0) {
        byLeader.set(u.leaderId, [...new Set([...(byLeader.get(u.leaderId) ?? []), ...subs])]);
      }
    }
  }

  // ② 従業員ごとの個別指定（従来方式）も引き続き有効。
  for (const m of allMembers) {
    if (!m.groupLeaderId) continue;
    byLeader.set(m.groupLeaderId, [
      ...new Set([...(byLeader.get(m.groupLeaderId) ?? []), m.personId]),
    ]);
  }
  if (byLeader.size === 0) return { leaders: 0 };

  let leaders = 0;
  for (const [leaderId, subIds] of byLeader) {
    const rows = await prisma.monthlyEvaluation.findMany({
      where: { yearMonth, personId: { in: [leaderId, ...subIds] } },
    });
    const own = rows.find((r) => r.personId === leaderId);
    if (!own || own.finalized) continue;
    const subs = rows.filter((r) => r.personId !== leaderId);
    if (subs.length === 0) continue;

    // 合算方法は長本人の設定に従う（なし / 予算のみ / 予算と実績）。
    const mode = allMembers.find((x) => x.personId === leaderId)?.aggregateMode ?? "予算のみ";
    if (mode === "なし") continue;
    const monthlyBudget = rows.reduce((a, r) => a + r.monthlyBudgetDig.toNumber(), 0);
    const cumulativeBudget = rows.reduce((a, r) => a + r.cumulativeBudgetDig.toNumber(), 0);
    // 実績は「予算と実績」を選んだときだけ配下を足す。
    const monthlyActual =
      mode === "予算と実績"
        ? rows.reduce((a, r) => a + r.monthlyActualDig.toNumber(), 0)
        : own.monthlyActualDig.toNumber();
    const cumulativeActual =
      mode === "予算と実績"
        ? rows.reduce((a, r) => a + r.cumulativeActualDig.toNumber(), 0)
        : own.cumulativeActualDig.toNumber();
    const mRate = achievementRate(monthlyActual, monthlyBudget);
    const cRate = achievementRate(cumulativeActual, cumulativeBudget);
    await prisma.monthlyEvaluation.update({
      where: { yearMonth_personId: { yearMonth, personId: leaderId } },
      data: {
        monthlyBudgetDig: monthlyBudget,
        cumulativeBudgetDig: cumulativeBudget,
        monthlyActualDig: monthlyActual,
        cumulativeActualDig: cumulativeActual,
        monthlyRate: mRate,
        monthlyRank: evaluationRank(mRate),
        cumulativeRate: cRate,
        cumulativeRank: evaluationRank(cRate),
      },
    });
    leaders += 1;
  }
  return { leaders };
}



// ─────────────────────────────────────────────
// Dig申請（成果Digの申請・承認）
// ─────────────────────────────────────────────
import type { CalcRule as DbCalcRule } from "@prisma/client";
import { fetchMonthlyWorkHours } from "./jinjer";
import {
  findContractMasterByCustomer,
  isContractDbConfigured,
  resolveContractDivision,
} from "./contract-db";

/** 申請フォームへ渡す契約1件（契約DBキャッシュ／即時参照で共通の形）。 */
export interface ContractLookupHit {
  contractId: string;
  contractNo: string | null;
  companyId: string | null;
  companyName: string;
  division: string;
  productName: string;
  termMonths: number;
  contractSummary: string | null;
  startDate: string | null;
  baseAmount: number;
  status: string;
  suggestedDig: number;
  /** db=同期済みキャッシュ / live=契約管理DBを直接参照 */
  source: "db" | "live";
}

/**
 * 顧客ID（企業ID）から契約管理DBのキャッシュを引き、申請フォームの自動入力に使う。
 * キャッシュに無い場合は CONTRACT_DB_URL があれば契約管理DB（VIEW）を直接参照する。
 * どちらも見つからなければ空で返し、手入力に委ねる。
 */
export async function lookupContractsByCompany(companyId: string): Promise<ContractLookupHit[]> {
  const contracts = await prisma.contract.findMany({
    where: { OR: [{ companyId }, { id: companyId }, { contractNo: companyId }] },
    include: { assignment: true },
    orderBy: { startDate: "desc" },
  });
  const rules = await prisma.calcRule.findMany({ where: { active: true } });
  if (contracts.length === 0) return lookupContractsLive(companyId, rules);
  return contracts.map((c) => {
    const contract = {
      id: c.id,
      contractNo: c.contractNo,
      customerName: c.customerName,
      companyId: c.companyId,
      division: c.division,
      modelKey: c.modelKey,
      status: c.status,
      baseAmount: c.baseAmount.toNumber(),
      setupFee: c.setupFee.toNumber(),
      initialFee: c.initialFee.toNumber(),
      termMonths: c.termMonths,
      startDate: c.startDate ? c.startDate.toISOString().slice(0, 10) : null,
      lineItems: (c.lineItems as unknown as ContractLineItem[]) ?? [],
      yearMonth: c.yearMonth,
    } as unknown as Contract;
    return {
      contractId: c.id,
      contractNo: c.contractNo,
      companyId: c.companyId,
      companyName: c.customerName,
      division: c.division,
      productName: c.modelKey,
      termMonths: c.termMonths,
      contractSummary: c.termMonths > 0 ? `${c.termMonths}ヵ月プラン` : null,
      startDate: c.startDate ? c.startDate.toISOString().slice(0, 10) : null,
      baseAmount: c.baseAmount.toNumber(),
      status: c.status,
      suggestedDig: suggestDig(contract, c.division, rules),
      source: "db" as const,
    };
  });
}

/** 事業部の算定ルールから獲得Digの目安を出す（複数該当なら最大値・該当なしは0）。 */
function suggestDig(contract: Contract, division: string, rules: DbCalcRule[]): number {
  const suggested = rules
    .filter((r) => r.division === division)
    .map((r) =>
      computeContractDig(contract, {
        id: r.id,
        division: r.division,
        name: r.name,
        ruleType: r.ruleType as CalcRule["ruleType"],
        modelKeyFilter: r.modelKeyFilter,
        unitLine: r.unitLine.toNumber(),
        unitCall: r.unitCall.toNumber(),
        ratioPercent: r.ratioPercent.toNumber(),
        fixedDig: r.fixedDig.toNumber(),
        marginRatePct: r.marginRatePct.toNumber(),
        salesSharePct: r.salesSharePct.toNumber(),
        active: r.active,
      } as CalcRule),
    );
  return suggested.length > 0 ? Math.max(...suggested) : 0;
}

/**
 * キャッシュに無い顧客IDを契約管理DB（VIEW）から直接参照する。
 * CONTRACT_DB_URL 未設定なら空（手入力に委ねる）。読み取り専用で、こちらへは保存しない。
 */
async function lookupContractsLive(
  companyId: string,
  rules: DbCalcRule[],
): Promise<ContractLookupHit[]> {
  if (!isContractDbConfigured()) return [];
  const rows = await findContractMasterByCustomer(companyId);
  return rows.map((r, i) => {
    const division = resolveContractDivision(r);
    const startDate = (r.startDate ?? r.contractDate)?.slice(0, 10) ?? null;
    const termMonths = r.termMonths ?? 0;
    const contract = {
      id: r.contractId ?? r.contractNo ?? `${r.customerId}#${i}`,
      contractNo: r.contractNo,
      customerName: r.customerName,
      companyId: r.customerCode ?? r.customerId,
      division,
      modelKey: r.modelKey ?? r.plan ?? "unknown",
      status: r.status ?? "unknown",
      baseAmount: r.monthlyTotal ?? r.baseAmount ?? 0,
      setupFee: r.setupFee ?? 0,
      initialFee: r.initialFee ?? 0,
      termMonths,
      startDate,
      lineItems: [] as ContractLineItem[],
      yearMonth: (startDate ?? "").slice(0, 7),
    } as unknown as Contract;
    return {
      contractId: contract.id,
      contractNo: r.contractNo,
      companyId: r.customerCode ?? r.customerId,
      companyName: r.customerName,
      division,
      productName: r.modelKey ?? r.plan ?? "",
      termMonths,
      contractSummary: termMonths > 0 ? `${termMonths}ヵ月プラン` : (r.plan ?? null),
      startDate,
      baseAmount: r.monthlyTotal ?? r.baseAmount ?? 0,
      status: r.status ?? "unknown",
      suggestedDig: suggestDig(contract, division, rules),
      source: "live" as const,
    };
  });
}

export async function createDigApplication(input: {
  applicantId: string;
  companyId?: string | null;
  companyName: string;
  productName: string;
  contractSummary?: string | null;
  contractId?: string | null;
  grantedDig: number;
  splitDig?: number;
  splitPartnerId?: string | null;
  contractDate: string;
  note?: string | null;
}) {
  const row = await prisma.digApplication.create({
    data: {
      applicantId: input.applicantId,
      companyId: input.companyId ?? null,
      companyName: input.companyName,
      productName: input.productName,
      contractSummary: input.contractSummary ?? null,
      contractId: input.contractId ?? null,
      grantedDig: input.grantedDig,
      splitDig: input.splitDig ?? 0,
      splitPartnerId: input.splitPartnerId ?? null,
      contractDate: new Date(`${input.contractDate}T00:00:00Z`),
      note: input.note ?? null,
      status: "申請中",
    },
  });
  await audit(input.applicantId, "dig.application.create", "DigApplication", String(row.id), {
    companyName: input.companyName,
    grantedDig: input.grantedDig,
  });
  return row;
}

/** Dig申請の一覧。personId 指定なら本人分、未指定は全件（ADMIN以上）。 */
export async function listDigApplications(personId?: string) {
  const rows = await prisma.digApplication.findMany({
    where: personId ? { OR: [{ applicantId: personId }, { splitPartnerId: personId }] } : {},
    orderBy: [{ status: "asc" }, { contractDate: "desc" }],
    take: 300,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.applicantId, r.splitPartnerId].filter(Boolean) as string[]))];
  const members = await prisma.member.findMany({
    where: { personId: { in: ids } },
    select: { personId: true, name: true },
  });
  const nameOf = new Map(members.map((m) => [m.personId, m.name]));
  return rows.map((r) => ({
    id: r.id,
    applicantId: r.applicantId,
    applicantName: nameOf.get(r.applicantId) ?? r.applicantId,
    companyId: r.companyId,
    companyName: r.companyName,
    productName: r.productName,
    contractSummary: r.contractSummary,
    grantedDig: r.grantedDig.toNumber(),
    splitDig: r.splitDig.toNumber(),
    splitPartnerId: r.splitPartnerId,
    splitPartnerName: r.splitPartnerId ? (nameOf.get(r.splitPartnerId) ?? r.splitPartnerId) : null,
    contractDate: r.contractDate.toISOString().slice(0, 10),
    note: r.note,
    status: r.status,
    reviewedBy: r.reviewedBy,
    reviewedOn: r.reviewedOn ? r.reviewedOn.toISOString().slice(0, 10) : null,
    rejectReason: r.rejectReason,
  }));
}

/** 成果Digを加算し、実績・達成率・ランクを再計算する（評価行が無ければ何もしない）。 */
async function addSeikaDig(yearMonth: string, personId: string, amount: number, actor: string) {
  const ev = await prisma.monthlyEvaluation.findUnique({
    where: { yearMonth_personId: { yearMonth, personId } },
  });
  if (!ev) return false;
  if (ev.finalized) throw new ConflictError("確定済みの月のため加算できません");
  const seika = ev.seikaDig.toNumber() + amount;
  const bonus = ev.bonusDig.toNumber();
  const loan = ev.loanDig.toNumber();
  const actual = seika + bonus + loan;
  const mBudget = ev.monthlyBudgetDig.toNumber();
  const cBudget = ev.cumulativeBudgetDig.toNumber();
  const mRate = achievementRate(actual, mBudget);
  const cRate = achievementRate(actual, cBudget);
  await prisma.monthlyEvaluation.update({
    where: { yearMonth_personId: { yearMonth, personId } },
    data: {
      seikaDig: seika,
      monthlyActualDig: actual,
      monthlyRate: mRate,
      monthlyRank: evaluationRank(mRate),
      cumulativeActualDig: actual,
      cumulativeRate: cRate,
      cumulativeRank: evaluationRank(cRate),
    },
  });
  await audit(actor, "dig.seika.add", "MonthlyEvaluation", `${yearMonth}/${personId}`, { amount });
  return true;
}

/**
 * Dig申請の承認／却下（ADMIN以上）。
 * 承認時は契約日の年月の評価へ成果Digを加算する。
 * 折半がある場合、申請主は 獲得−折半、折半相手に 折半分を計上する。
 */
export async function decideDigApplication(
  id: number,
  approve: boolean,
  actor: string,
  rejectReason?: string,
) {
  const app = await prisma.digApplication.findUnique({ where: { id } });
  if (!app) throw new NotFoundError("申請が見つかりません");
  if (app.status !== "申請中") throw new ConflictError("既に処理済みの申請です");

  let applied = false;
  let partnerApplied = false;
  if (approve) {
    const ym = app.contractDate.toISOString().slice(0, 7);
    const granted = app.grantedDig.toNumber();
    const split = app.splitDig.toNumber();
    const ownShare = Math.max(0, granted - split);
    if (ownShare > 0) applied = await addSeikaDig(ym, app.applicantId, ownShare, actor);
    if (split > 0 && app.splitPartnerId) {
      partnerApplied = await addSeikaDig(ym, app.splitPartnerId, split, actor);
    }
  }

  const row = await prisma.digApplication.update({
    where: { id },
    data: {
      status: approve ? "承認済" : "却下",
      reviewedBy: actor,
      reviewedOn: new Date(),
      rejectReason: approve ? null : (rejectReason ?? null),
    },
  });
  await audit(actor, approve ? "dig.application.approve" : "dig.application.reject", "DigApplication", String(id), {
    grantedDig: app.grantedDig.toNumber(),
    applied,
    partnerApplied,
  });
  return { id: row.id, status: row.status, applied, partnerApplied };
}

// ─────────────────────────────────────────────
// マイページ（本人の実績・借入・ボーナス・インセン）
// ─────────────────────────────────────────────
/**
 * マイページ用データ。対象月リスト（四半期の各月）の評価推移、借入と返済予定、
 * ボーナスDig、インセンティブ見込みをまとめて返す。
 */
export async function getMyPageData(personId: string, yearMonths: string[]) {
  const member = await prisma.member.findUnique({ where: { personId } });
  if (!member) throw new NotFoundError("member not found");

  const [evals, loans, bonuses, group] = await Promise.all([
    prisma.monthlyEvaluation.findMany({
      where: { personId, yearMonth: { in: yearMonths } },
      orderBy: { yearMonth: "asc" },
    }),
    prisma.loan.findMany({ where: { borrowerId: personId }, orderBy: { appliedOn: "asc" } }),
    prisma.bonusDigRecord.findMany({
      where: { personId, yearMonth: { in: yearMonths } },
      orderBy: { recordedOn: "asc" },
    }),
    prisma.member.findMany({
      where: { groupLeaderId: personId, status: "在籍" },
      select: { personId: true, name: true },
    }),
  ]);

  // インセンティブの還元率は所属組織で決まる（カスタマーグロースは5%）。
  const incentiveRate = (await incentiveRateMap()).get(personId);

  // 月次推移＋インセンティブ見込み（原資=成果+ボーナス、借入は除外: Q2/Q5案2）。
  const months = yearMonths.map((ym) => {
    const e = evals.find((x) => x.yearMonth === ym);
    if (!e) {
      return {
        yearMonth: ym,
        monthlyBudgetDig: 0,
        monthlyActualDig: 0,
        monthlyRate: 0,
        monthlyRank: null as string | null,
        cumulativeBudgetDig: 0,
        cumulativeActualDig: 0,
        cumulativeRate: 0,
        seikaDig: 0,
        bonusDig: 0,
        loanDig: 0,
        incentive: 0,
        balance: 0,
        finalized: false,
      };
    }
    const seika = e.seikaDig.toNumber();
    const bonus = e.bonusDig.toNumber();
    const budget = e.monthlyBudgetDig.toNumber();
    const qb = computeQuarterBalance({ personId, gross: seika, target: budget, bonus, incentiveRate });
    return {
      yearMonth: ym,
      monthlyBudgetDig: budget,
      monthlyActualDig: e.monthlyActualDig.toNumber(),
      monthlyRate: e.monthlyRate.toNumber(),
      monthlyRank: e.monthlyRank as string,
      cumulativeBudgetDig: e.cumulativeBudgetDig.toNumber(),
      cumulativeActualDig: e.cumulativeActualDig.toNumber(),
      cumulativeRate: e.cumulativeRate.toNumber(),
      seikaDig: seika,
      bonusDig: bonus,
      loanDig: e.loanDig.toNumber(),
      incentive: qb.incentive,
      balance: qb.balance,
      finalized: e.finalized,
    };
  });

  // 借入ごとの返済予定と残高（元利均等・termMonths 回）。
  const loanViews = loans.map((l) => {
    const principal = l.principal.toNumber();
    const rate = l.monthlyRate.toNumber();
    const approved = l.status === "承認済" || l.status === "完済";
    const schedule = approved && l.termMonths > 0 ? loanSchedule(principal, rate, l.termMonths) : [];
    const totalRepayment = schedule.reduce((a, r) => a + r.repayment, 0);
    const totalInterest = schedule.reduce((a, r) => a + r.interest, 0);
    // 経過回数（承認月から現在まで）。返済済み回数の目安として残高を出す。
    const paidCount = approved ? elapsedRepayments(l.approvedOn ?? l.appliedOn, l.termMonths) : 0;
    const remaining = schedule.length > 0
      ? (paidCount >= schedule.length ? 0 : schedule[Math.max(0, paidCount - 1)]?.closingBalance ?? principal)
      : principal;
    return {
      id: l.id,
      yearMonth: l.yearMonth,
      lender: l.lender,
      loanType: l.loanType as string,
      status: l.status as string,
      principal,
      monthlyRatePct: rate * 100,
      termMonths: l.termMonths,
      appliedOn: l.appliedOn.toISOString().slice(0, 10),
      approvedOn: l.approvedOn ? l.approvedOn.toISOString().slice(0, 10) : null,
      totalRepayment,
      totalInterest,
      paidCount,
      remaining: Math.max(0, remaining),
      monthlyRepayment: schedule[0]?.repayment ?? 0,
      note: l.note,
    };
  });

  return {
    member: {
      personId: member.personId,
      name: member.name,
      division: member.division,
      position: member.position as string,
      employmentType: member.employmentType as string,
      evaluationCycle: member.evaluationCycle as string,
      joinedOn: member.joinedOn.toISOString().slice(0, 10),
      positionBase: member.positionBase.toNumber(),
      salaryGrade: member.salaryGrade,
    },
    months,
    loans: loanViews,
    bonuses: bonuses.map((b) => ({
      yearMonth: b.yearMonth,
      recordedOn: b.recordedOn.toISOString().slice(0, 10),
      itemId: b.itemId,
      grantedDig: b.grantedDig.toNumber(),
      note: b.note,
    })),
    group,
  };
}

/** 承認月から現在までの経過月数（返済回数の目安）。 */
function elapsedRepayments(from: Date, termMonths: number): number {
  const now = new Date();
  const months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + (now.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, Math.min(termMonths, months));
}

/** マイページのメンバー選択用（ADMIN以上）。 */
export async function listMembersForPicker() {
  return prisma.member.findMany({
    where: { status: "在籍" },
    select: { personId: true, name: true, division: true },
    orderBy: [{ division: "asc" }, { name: "asc" }],
  });
}

// 初回借入の運用開始日。これより前に入社した既存メンバーは対象外（運用方針）。
const INITIAL_LOAN_START_DATE = "2026-08-01";
// 初回借入額＝単月予算Digの何ヶ月分か（運用方針）。
const INITIAL_LOAN_BUDGET_MONTHS = 1.5;
// 自動生成した初回借入の識別用（手動申請と区別し、取り消し対象を限定する）。
const INITIAL_LOAN_NOTE = "入社時 必須初回借入（自動承認・予算1.5ヶ月分）";

/**
 * 入社時の必須初回借入（自動承認）を未作成のメンバーに作成する（要件 F-5・v1.2）。
 * 対象は評価対象事業部の在籍者。yearMonth は入社month（借入が計上される月）。
 * 既に「初回」借入があるメンバーはスキップ（冪等）。
 */
export async function ensureInitialLoans(actor: string) {
  const scopeIds = await targetPersonIds();
  const targets = scopeIds === null ? await listTargetDivisions() : [];
  const cutoff = new Date(`${INITIAL_LOAN_START_DATE}T00:00:00Z`);

  // 運用開始前に入社した既存メンバーは初回借入の対象外。
  // 過去に自動作成された分があれば取り消す（申請・承認履歴のない自動生成のみ）。
  const removed = await prisma.loan.deleteMany({
    where: {
      loanType: "初回",
      note: INITIAL_LOAN_NOTE,
      borrower: { joinedOn: { lt: cutoff } },
    },
  });

  const members = await prisma.member.findMany({
    where: {
      status: "在籍",
      joinedOn: { gte: cutoff },
      ...(scopeIds !== null
        ? { personId: { in: scopeIds } }
        : targets.length > 0
          ? { division: { in: targets } }
          : {}),
    },
    select: {
      personId: true,
      joinedOn: true,
      leftOn: true,
      positionBase: true,
      employmentType: true,
      evaluationCycle: true,
    },
  });
  const existing = new Set(
    (
      await prisma.loan.findMany({
        where: { loanType: "初回", borrowerId: { in: members.map((m) => m.personId) } },
        select: { borrowerId: true },
      })
    ).map((l) => l.borrowerId),
  );

  // 予算算定に使う係数は事業部（組織）ごと。借入の金利・期間は全社共通（金融管理）。
  const overrides = await orgOverrideMap();

  let created = 0;
  let skippedNoBudget = 0;
  for (const m of members) {
    if (existing.has(m.personId)) continue;
    const joinedOn = m.joinedOn.toISOString().slice(0, 10);
    const ym = joinedOn.slice(0, 7);
    // 借入時点の設定（無ければ既定）を使い、レートを固定保持する。
    const settingRow = await prisma.setting.findUnique({ where: { yearMonth: ym } });
    const setting = settingRow ? toSetting(settingRow) : DEFAULT_SETTING;
    const init = buildInitialLoan({
      id: `init-${m.personId}`,
      yearMonth: ym,
      borrowerId: m.personId,
      joinedOn,
      setting,
    });

    // 初回借入額＝入社月の単月予算Digの1.5ヶ月分（運用ルール）。
    // 予算の運用指定があればそれを、無ければ役職ベースから計算した値を使う。
    const override = await prisma.budgetOverride.findUnique({
      where: { yearMonth_personId: { yearMonth: ym, personId: m.personId } },
    });
    let monthlyBudget = override?.monthlyBudgetDig.toNumber() ?? 0;
    if (monthlyBudget <= 0) {
      monthlyBudget = evaluateMonthly({
        yearMonth: ym,
        personId: m.personId,
        employmentType: m.employmentType as EmploymentType,
        positionBase: m.positionBase.toNumber(),
        joinedOn,
        leftOn: m.leftOn ? m.leftOn.toISOString().slice(0, 10) : null,
        evaluationCycle: m.evaluationCycle as EvaluationCycle,
        seikaDig: 0,
        bonusDig: 0,
        loanDig: 0,
        setting: mergeSetting(setting, overrides.get(m.personId) ?? EMPTY_ORG_OVERRIDE),
      }).monthlyBudgetDig;
    }
    const principal = Math.round(monthlyBudget * INITIAL_LOAN_BUDGET_MONTHS);
    if (principal <= 0) {
      skippedNoBudget += 1;
      continue; // 予算が未確定（役職ベース未設定等）なら作らない
    }

    await prisma.loan.create({
      data: {
        yearMonth: init.yearMonth,
        borrowerId: init.borrowerId,
        lender: init.lender,
        loanType: init.loanType,
        status: init.status,
        principal,
        monthlyRate: init.monthlyRate,
        termMonths: init.termMonths,
        appliedOn: new Date(`${joinedOn}T00:00:00Z`),
        approvedBy: init.approvedBy ?? null,
        approvedOn: new Date(`${joinedOn}T00:00:00Z`),
        note: INITIAL_LOAN_NOTE,
      },
    });
    created += 1;
  }
  await audit(actor, "loan.initial.ensure", "Loan", null, {
    created,
    removed: removed.count,
    skippedNoBudget,
    total: members.length,
  });
  return { created, removed: removed.count, skippedNoBudget, total: members.length };
}

/** 対象月に計上される承認済借入の合計（社員別）。実績Digの借入分。 */
async function loanDigMapFor(yearMonth: string): Promise<Map<string, number>> {
  const loans = await prisma.loan.findMany({
    where: { yearMonth, status: { in: ["承認済", "完済"] } },
    select: { borrowerId: true, principal: true },
  });
  const map = new Map<string, number>();
  for (const l of loans) {
    map.set(l.borrowerId, (map.get(l.borrowerId) ?? 0) + l.principal.toNumber());
  }
  return map;
}

/**
 * 対象月の評価行を在籍メンバーから生成／再計算する。
 * - 未作成の personId は新規作成（成果Dig/ボーナス/借入は 0）。
 * - 既存かつ未確定の行は、現在のマスタ（役職ベース・雇用形態・入社日・
 *   サイクル）で予算側を再計算する。実績（成果Dig/ボーナス/借入）は保持。
 * - 確定済みの行は変更しない。
 * - Setting 未作成の月は DEFAULT_SETTING で作成する。
 */
export async function generateEvaluations(
  yearMonth: string,
  actor: string,
): Promise<{ created: number; recalculated: number; skipped: number; groupLeaders: number; total: number }> {
  const settingRow =
    (await prisma.setting.findUnique({ where: { yearMonth } })) ??
    (await prisma.setting.create({
      data: {
        yearMonth,
        insuranceCoefficient: DEFAULT_SETTING.insuranceCoefficient,
        budgetCoefficient: DEFAULT_SETTING.budgetCoefficient,
        annualRatePct: DEFAULT_SETTING.annualRatePct,
        initialLoanDefault: DEFAULT_SETTING.initialLoanDefault,
        loanTermMonthsDefault: DEFAULT_SETTING.loanTermMonthsDefault,
        commonCostFulltime: DEFAULT_SETTING.commonCostFulltime,
        commonCostParttime: DEFAULT_SETTING.commonCostParttime,
        promotionUpTwo: DEFAULT_SETTING.promotion.upTwo,
        promotionUpOne: DEFAULT_SETTING.promotion.upOne,
        promotionDownOne: DEFAULT_SETTING.promotion.downOne,
        promotionDownTwo: DEFAULT_SETTING.promotion.downTwo,
      },
    }));
  const setting = toSetting(settingRow);
  // 予算係数・保険係数・座席代・昇降級しきい値は事業部（組織）ごとに上書きできる。
  const settings = await settingMap(setting);
  const settingOf = (personId: string) => settings.get(personId) ?? setting;

  // 対象月に計上される承認済借入（入社時の初回借入を含む）を実績Digへ反映する。
  const loanMap = await loanDigMapFor(yearMonth);
  // アルバイトの予算Digは「実労働時間 × 時給」を役職ベース相当として算定する。
  const hoursMap = await workHoursMapFor(yearMonth);
  // 予算Digの月別上書き（運用指定があれば計算値より優先）。
  const overrides = new Map(
    (await prisma.budgetOverride.findMany({ where: { yearMonth } })).map((o) => [
      o.personId,
      o.monthlyBudgetDig.toNumber(),
    ]),
  );
  // 評価対象を絞る。組織が登録されていれば「対象に指定した組織とその配下」、
  // 未登録なら従来どおり対象事業部（未登録なら全員＝従来動作）。
  const scopeIds = await targetPersonIds();
  const targets = scopeIds === null ? await listTargetDivisions() : [];
  const members = await prisma.member.findMany({
    where: {
      status: "在籍",
      ...(scopeIds !== null
        ? { personId: { in: scopeIds } }
        : targets.length > 0
          ? { division: { in: targets } }
          : {}),
    },
    orderBy: [{ division: "asc" }, { personId: "asc" }],
  });
  // 既存行は「確定済みなら据え置き」「未確定なら現在のマスタで再計算」する。
  // 成果Dig/ボーナス/借入（実績）は保持し、予算側だけ計算し直す。
  const existingRows = await prisma.monthlyEvaluation.findMany({
    where: { yearMonth },
    select: {
      personId: true,
      finalized: true,
      seikaDig: true,
      bonusDig: true,
      loanDig: true,
      surplusChoice: true,
    },
  });
  const existing = new Map(existingRows.map((e) => [e.personId, e]));

  let created = 0;
  let recalculated = 0;
  for (const m of members) {
    const prev = existing.get(m.personId);
    if (prev?.finalized) continue; // 確定済みは触らない

    if (prev) {
      // 実績を保持したまま、役職ベース等の変更を反映して再計算。
      const seika = prev.seikaDig.toNumber();
      const bonus = prev.bonusDig.toNumber();
      // 借入は Loan テーブルを正とする（初回借入の自動計上に追随）。
      const loan = loanMap.get(m.personId) ?? prev.loanDig.toNumber();
      const ev = evaluateMonthly({
        yearMonth,
        personId: m.personId,
        employmentType: m.employmentType as EmploymentType,
        positionBase: baseAmountForBudget(
          {
            employmentType: m.employmentType as string,
            positionBase: m.positionBase.toNumber(),
            hourlyWage: m.hourlyWage ? m.hourlyWage.toNumber() : null,
          },
          hoursMap.get(m.personId),
        ),
        joinedOn: m.joinedOn.toISOString().slice(0, 10),
        leftOn: m.leftOn ? m.leftOn.toISOString().slice(0, 10) : null,
        evaluationCycle: m.evaluationCycle as EvaluationCycle,
        seikaDig: seika,
        bonusDig: bonus,
        loanDig: loan,
        setting: settingOf(m.personId),
      });
      const b = applyBudgetOverride(
        ev,
        overrides.get(m.personId),
        m.evaluationCycle as EvaluationCycle,
        m.joinedOn.toISOString().slice(0, 7),
        yearMonth,
      );
      await prisma.monthlyEvaluation.update({
        where: { yearMonth_personId: { yearMonth, personId: m.personId } },
        data: {
          division: m.division,
          employmentType: m.employmentType,
          positionBase: m.positionBase,
          joinedOn: m.joinedOn,
          leftOn: m.leftOn ?? null,
          residencyDays: ev.residencyDays,
          prorationCoefficient: ev.prorationCoefficient,
          seatCost: ev.seatCost,
          totalCost: ev.totalCost,
          monthlyBudgetDig: b.monthlyBudgetDig,
          cumulativeBudgetDig: b.cumulativeBudgetDig,
          monthlyActualDig: ev.monthly.actualDig,
          monthlyRate: b.monthlyRate,
          monthlyRank: b.monthlyRank,
          cumulativeActualDig: ev.cumulative.actualDig,
          cumulativeRate: b.cumulativeRate,
          cumulativeRank: b.cumulativeRank,
        },
      });
      recalculated += 1;
      continue;
    }

    const joinedOn = m.joinedOn.toISOString().slice(0, 10);
    const leftOn = m.leftOn ? m.leftOn.toISOString().slice(0, 10) : null;
    const ev = evaluateMonthly({
      yearMonth,
      personId: m.personId,
      employmentType: m.employmentType as EmploymentType,
      positionBase: m.positionBase.toNumber(),
      joinedOn,
      leftOn,
      evaluationCycle: m.evaluationCycle as EvaluationCycle,
      seikaDig: 0,
      bonusDig: 0,
      loanDig: loanMap.get(m.personId) ?? 0,
      setting: settingOf(m.personId),
    });
    const nb = applyBudgetOverride(
      ev,
      overrides.get(m.personId),
      m.evaluationCycle as EvaluationCycle,
      joinedOn.slice(0, 7),
      yearMonth,
    );
    await prisma.monthlyEvaluation.create({
      data: {
        yearMonth,
        personId: m.personId,
        division: m.division,
        employmentType: m.employmentType,
        positionBase: m.positionBase,
        joinedOn: m.joinedOn,
        leftOn: m.leftOn ?? null,
        residencyDays: ev.residencyDays,
        prorationCoefficient: ev.prorationCoefficient,
        seatCost: ev.seatCost,
        totalCost: ev.totalCost,
        monthlyBudgetDig: nb.monthlyBudgetDig,
        cumulativeBudgetDig: nb.cumulativeBudgetDig,
        seikaDig: ev.seikaDig,
        bonusDig: ev.bonusDig,
        loanDig: ev.loanDig,
        monthlyActualDig: ev.monthly.actualDig,
        monthlyRate: nb.monthlyRate,
        monthlyRank: nb.monthlyRank,
        cumulativeActualDig: ev.cumulative.actualDig,
        cumulativeRate: nb.cumulativeRate,
        cumulativeRank: nb.cumulativeRank,
        finalized: false,
      },
    });
    created++;
  }
  // グループ長は自分＋配下の合計で評価する（配下がいる場合のみ）。
  const grouped = await aggregateGroupEvaluations(yearMonth);
  // 触らなかった＝確定済み。
  const skipped = members.length - created - recalculated;
  await audit(actor, "evaluation.generate", "MonthlyEvaluation", yearMonth, {
    created,
    recalculated,
    skipped,
    groupLeaders: grouped.leaders,
    total: members.length,
  });
  return { created, recalculated, skipped, groupLeaders: grouped.leaders, total: members.length };
}

// ─────────────────────────────────────────────
// Q3: 超過分の持ち越し/インセン選択
// ─────────────────────────────────────────────
export async function setSurplusChoice(
  yearMonth: string,
  personId: string,
  choice: "incentive" | "carryover",
  actor: string,
) {
  const ev = await prisma.monthlyEvaluation.findUnique({
    where: { yearMonth_personId: { yearMonth, personId } },
  });
  if (!ev) throw new NotFoundError("評価が見つかりません");
  if (ev.finalized) throw new ConflictError("確定済みのため変更できません");
  await prisma.monthlyEvaluation.update({
    where: { yearMonth_personId: { yearMonth, personId } },
    data: { surplusChoice: choice },
  });
  await audit(actor, "surplus.choice", "MonthlyEvaluation", `${yearMonth}/${personId}`, { choice });
  return { yearMonth, personId, surplusChoice: choice };
}

// ─────────────────────────────────────────────
// Q13: 成果Dig手入力の承認フロー（最終承認=スーパーADMIN）
// ─────────────────────────────────────────────
/** 成果Digを手入力（例外）→ 未承認(draft)にして再計算。 */
export async function submitSeika(
  yearMonth: string,
  personId: string,
  seika: number,
  inputBy: string,
) {
  const ev = await prisma.monthlyEvaluation.findUnique({
    where: { yearMonth_personId: { yearMonth, personId } },
  });
  if (!ev) throw new NotFoundError("評価が見つかりません");
  if (ev.finalized) throw new ConflictError("確定済みのため変更できません");
  const bonus = ev.bonusDig.toNumber();
  const loan = ev.loanDig.toNumber();
  const budget = ev.monthlyBudgetDig.toNumber();
  const actual = seika + bonus + loan;
  await prisma.monthlyEvaluation.update({
    where: { yearMonth_personId: { yearMonth, personId } },
    data: {
      seikaDig: seika,
      monthlyActualDig: actual,
      monthlyRate: budget ? actual / budget : 0,
      monthlyRank: evaluationRank(budget ? actual / budget : 0),
      seikaApproved: false,
      seikaInputBy: inputBy,
      seikaApprovedBy: null,
    },
  });
  await audit(inputBy, "seika.submit", "MonthlyEvaluation", `${yearMonth}/${personId}`, { seika });
  return { yearMonth, personId, seikaApproved: false };
}

/** 手入力成果Digを承認（スーパーADMIN）。 */
export async function approveSeika(yearMonth: string, personId: string, approver: string) {
  const ev = await prisma.monthlyEvaluation.findUnique({
    where: { yearMonth_personId: { yearMonth, personId } },
  });
  if (!ev) throw new NotFoundError("評価が見つかりません");
  if (ev.seikaApproved) throw new ConflictError("既に承認済みです");
  await prisma.monthlyEvaluation.update({
    where: { yearMonth_personId: { yearMonth, personId } },
    data: { seikaApproved: true, seikaApprovedBy: approver },
  });
  await audit(approver, "seika.approve", "MonthlyEvaluation", `${yearMonth}/${personId}`, {});
  return { yearMonth, personId, seikaApproved: true };
}

export const listSeikaPending = () =>
  prisma.monthlyEvaluation.findMany({
    where: { seikaApproved: false },
    orderBy: { personId: "asc" },
  });

// ─────────────────────────────────────────────
// Q14: 退社時の借入残高精算（グループ負担割合・相殺）
// ─────────────────────────────────────────────
/** 退社者（status=退社）と会社借入残高（承認済ローン元本合計）。 */
export async function listRetirementCandidates() {
  const retired = await prisma.member.findMany({ where: { status: "退社" } });
  const out = [];
  for (const m of retired) {
    const loans = await prisma.loan.findMany({
      where: { borrowerId: m.personId, status: "承認済" },
    });
    const balance = loans.reduce((s, l) => s + l.principal.toNumber(), 0);
    const existing = await prisma.retirementSettlement.findFirst({ where: { personId: m.personId } });
    out.push({
      personId: m.personId,
      name: m.name,
      division: m.division,
      groupLeaderId: m.groupLeaderId,
      loanBalance: balance,
      settled: Boolean(existing),
    });
  }
  return out;
}

/** グループ内の負担配分を登録（Q14案1）。合計が残高と一致することを検証。 */
export async function settleRetirement(input: {
  personId: string;
  yearMonth: string;
  loanBalance: number;
  shares: { personId: string; amount: number }[];
  note: string | null;
  actor: string;
}) {
  const sum = input.shares.reduce((s, x) => s + x.amount, 0);
  if (Math.round(sum) !== Math.round(input.loanBalance)) {
    throw new ConflictError(`負担合計(${sum})が借入残高(${input.loanBalance})と一致しません`);
  }
  const rec = await prisma.retirementSettlement.create({
    data: {
      personId: input.personId,
      yearMonth: input.yearMonth,
      loanBalance: input.loanBalance,
      shares: input.shares as unknown as Prisma.InputJsonValue,
      note: input.note,
      settledBy: input.actor,
    },
  });
  await audit(input.actor, "retirement.settle", "RetirementSettlement", String(rec.id), {
    personId: input.personId,
    loanBalance: input.loanBalance,
  });
  return { id: rec.id };
}

// ─────────────────────────────────────────────
// jinjer（勤怠）連携: 従業員マスタ自動同期
// ─────────────────────────────────────────────
import {
  EXCLUDED_DIVISIONS,
  fetchDepartmentTree,
  fetchEmployeesForSync,
  fetchEnrichPage,
  fetchOrgSalaryMaps,
  type EnrichKind,
} from "./jinjer";

/** jinjerから従業員を取り込み Member へ upsert（CRM事業部・管理本部は除外）。給与は既存を保持。 */
export async function syncFromJinjer(actor: string) {
  const {
    employees,
    excluded,
    connected,
    fetched,
    parsed,
    activeCount,
    retiredCount,
    executiveCount,
    inactivePersonIds,
    departmentCounts,
    rawSampleKeys,
    rawSample,
  } = await fetchEmployeesForSync();
  // 万一の誤上書きに備え、同期前の手入力項目を監査ログへ退避する（「手入力項目を復元」で戻せる）。
  await snapshotManualFields(actor);
  let created = 0;
  let updated = 0;
  for (const e of employees) {
    const existing = await prisma.member.findUnique({ where: { personId: e.personId } });
    const joinedOn = new Date(`${e.joinedOn}T00:00:00Z`);
    if (existing) {
      // jinjer が正の項目だけ更新する。以下は Dig評価側の設定を正とするため**上書きしない**:
      //   division / divisionOverride（事業部の紐づけ）, position（役職の手入力）,
      //   salaryGrade / salaryRow / positionBase（役職ベース）, evaluationCycle, groupLeaderId
      // 基本給は jinjer から取れた場合のみ反映（0は既存維持）。
      await prisma.member.update({
        where: { personId: e.personId },
        data: {
          name: e.name,
          employmentType: e.employmentType as Prisma.MemberUpdateInput["employmentType"],
          joinedOn,
          status: "在籍",
          ...(e.basePay > 0 ? { basePay: e.basePay } : {}),
          ...(e.email ? { email: e.email } : {}),
          // jinjer 側の所属名は「紐づけの原本」としてのみ保持し、division は後段でルール再適用する。
          ...(e.division ? { jinjerTeam: e.division } : {}),
          // 役職名の生値は紐付けの原本として保持する。
          ...(e.positionRaw ? { jinjerPosition: e.positionRaw } : {}),
          // 役職は jinjer に既知の値がある場合のみ反映（手入力した人は上書きしない）。
          ...(e.position && !existing.positionManual
            ? { position: e.position as Prisma.MemberUpdateInput["position"] }
            : {}),
        },
      });
      updated += 1;
    } else {
      await prisma.member.create({
        data: {
          personId: e.personId,
          name: e.name,
          email: e.email || null,
          division: e.division,
          jinjerTeam: e.division || null,
          jinjerPosition: e.positionRaw || null,
          position: (e.position ?? "メンバー") as Prisma.MemberCreateInput["position"],
          jobType: null,
          employmentType: e.employmentType as Prisma.MemberCreateInput["employmentType"],
          basePay: e.basePay,
          positionBase: 0,
          joinedOn,
          evaluationCycle: "四半期",
          status: "在籍",
        },
      });
      created += 1;
    }
  }
  // 評価対象外（退職・役員）が既にマスタに居れば「退社」にして一覧から外す。
  let retiredInDb = 0;
  if (inactivePersonIds.length > 0) {
    const res = await prisma.member.updateMany({
      where: { personId: { in: inactivePersonIds }, status: "在籍" },
      data: { status: "退社" },
    });
    retiredInDb = res.count;
  }

  // 事業部は個別指定 → 紐づけルール の順で復元する（同期で失われないようにする）。
  const divisionsRestored = await reapplyDivisionRules(actor);

  await audit(actor, "member.sync.jinjer", "Member", null, {
    connected,
    fetched,
    parsed,
    created,
    updated,
    executiveCount,
    retiredInDb,
    excluded: excluded.length,
    divisionsRestored: divisionsRestored.restored,
    divisionsReapplied: divisionsRestored.updated,
  });
  return {
    connected,
    fetched,
    parsed,
    activeCount,
    retiredCount,
    executiveCount,
    retiredInDb,
    departmentCounts,
    created,
    updated,
    // 事業部の復元内訳（個別指定の復元／紐づけルールの再適用）
    divisionsRestored: divisionsRestored.restored,
    divisionsReapplied: divisionsRestored.updated,
    synced: employees.length,
    excludedDivisions: EXCLUDED_DIVISIONS,
    excludedCount: excluded.length,
    // マッピング診断用（取込0名時の原因特定）。parsed=0 のときのみ本文/キーを載せる。
    rawSampleKeys,
    rawSample: parsed === 0 ? rawSample : null,
  };
}

/** 手入力で管理している項目（同期で上書きしてはいけないもの）。 */
interface ManualFieldsRow {
  personId: string;
  name: string;
  division: string;
  divisionOverride: string | null;
  jinjerTeam: string | null;
  position: string;
  salaryGrade: string | null;
  salaryRow: number | null;
  positionBase: number;
  evaluationCycle: string;
  groupLeaderId: string | null;
}

/**
 * 手入力項目のスナップショットを監査ログへ保存する（誤上書きからの復旧用）。
 * jinjer 同期の直前に自動で呼ばれる。
 */
export async function snapshotManualFields(actor: string) {
  const members = await prisma.member.findMany({
    where: { status: "在籍" },
    select: {
      personId: true, name: true, division: true, divisionOverride: true, jinjerTeam: true,
      position: true, salaryGrade: true, salaryRow: true, positionBase: true,
      evaluationCycle: true, groupLeaderId: true,
    },
    orderBy: { personId: "asc" },
  });
  const rows: ManualFieldsRow[] = members.map((m) => ({
    personId: m.personId,
    name: m.name,
    division: m.division,
    divisionOverride: m.divisionOverride,
    jinjerTeam: m.jinjerTeam,
    position: m.position,
    salaryGrade: m.salaryGrade,
    salaryRow: m.salaryRow,
    positionBase: m.positionBase.toNumber(),
    evaluationCycle: m.evaluationCycle,
    groupLeaderId: m.groupLeaderId,
  }));
  await audit(actor, "member.manual.snapshot", "Member", null, {
    count: rows.length,
    rows: rows as unknown as Prisma.InputJsonValue,
  });
  return { count: rows.length };
}

/**
 * 直近のスナップショットから手入力項目（事業部・役職・レンジ・役職ベース・サイクル・グループ）を
 * 復元する。誤って同期で上書きしてしまった場合の巻き戻しに使う。
 */
export async function restoreManualFields(actor: string) {
  const log = await prisma.auditLog.findFirst({
    where: { action: "member.manual.snapshot" },
    orderBy: { id: "desc" },
  });
  const detail = log?.detail as { rows?: ManualFieldsRow[] } | null;
  const rows = detail?.rows ?? [];
  if (rows.length === 0) throw new NotFoundError("復元できるスナップショットがありません");

  let restored = 0;
  let missing = 0;
  for (const r of rows) {
    const exists = await prisma.member.findUnique({
      where: { personId: r.personId },
      select: { personId: true },
    });
    if (!exists) {
      missing += 1;
      continue;
    }
    await prisma.member.update({
      where: { personId: r.personId },
      data: {
        division: r.division,
        divisionOverride: r.divisionOverride,
        jinjerTeam: r.jinjerTeam,
        position: r.position as Prisma.MemberUpdateInput["position"],
        salaryGrade: r.salaryGrade,
        salaryRow: r.salaryRow,
        positionBase: r.positionBase,
        evaluationCycle: r.evaluationCycle as Prisma.MemberUpdateInput["evaluationCycle"],
        groupLeaderId: r.groupLeaderId,
      },
    });
    restored += 1;
  }
  await audit(actor, "member.manual.restore", "Member", null, {
    snapshotAt: log?.createdAt ?? null,
    restored,
    missing,
  });
  return { restored, missing, total: rows.length, snapshotAt: log?.createdAt ?? null };
}

/**
 * 所属/給与を「1ページ分だけ」取り込んで在籍メンバーへ反映する（タイムアウト回避）。
 * クライアントが page を進めながら繰り返し呼ぶ。DB更新は自社メンバーのみ（退職者は無視）。
 */
export async function enrichMembersPage(
  actor: string,
  kind: EnrichKind,
  page: number,
): Promise<{ kind: EnrichKind; page: number; fetched: number; updated: number; done: boolean; error?: string }> {
  const r = await fetchEnrichPage(kind, page);
  if (!r.ok) {
    return { kind, page, fetched: 0, updated: 0, done: false, error: r.error ?? `HTTP ${r.status}` };
  }
  if (r.count === 0) return { kind, page, fetched: 0, updated: 0, done: true };

  // 自社の在籍メンバーだけを対象に更新（jin側は退職者含む全件のため）。
  const ids = r.rows.map((x) => x.personId);
  const targets = await prisma.member.findMany({
    where: { personId: { in: ids }, status: "在籍" },
    select: { personId: true, divisionOverride: true },
  });
  const targetSet = new Set(targets.map((t) => t.personId));
  // 個別指定がある人は事業部を上書きしない。
  const overridden = new Set(targets.filter((t) => t.divisionOverride).map((t) => t.personId));
  // 所属は紐づけルール（jinjer所属名 → dgloss事業部）を優先して適用する。
  const rules = kind === "affiliations" ? await listDivisionRules() : [];

  let updated = 0;
  for (const row of r.rows) {
    if (!targetSet.has(row.personId)) continue;
    const data: Prisma.MemberUpdateInput = {};
    if (row.division) {
      const team = row.teamName ?? row.division;
      data.jinjerTeam = team; // 再適用の原本として保持
      if (!overridden.has(row.personId)) {
        data.division = applyDivisionRules(team, rules, row.division);
      }
    }
    if (row.basePay && row.basePay > 0) data.basePay = row.basePay;
    if (row.hourlyWage && row.hourlyWage > 0) data.hourlyWage = row.hourlyWage;
    if (Object.keys(data).length === 0) continue;
    await prisma.member.update({ where: { personId: row.personId }, data });
    updated += 1;
  }
  if (updated > 0) {
    await audit(actor, `member.enrich.${kind}`, "Member", null, { page, updated });
  }
  return { kind, page, fetched: r.count, updated, done: false };
}



// ─────────────────────────────────────────────
// 実労働時間（アルバイトの予算Dig算定）
// ─────────────────────────────────────────────
/** 対象月の実労働時間を jinjer から取り込む。 */
export async function syncWorkHours(yearMonth: string, actor: string) {
  const rows = await fetchMonthlyWorkHours(yearMonth);
  if (rows.length === 0) {
    return { fetched: 0, updated: 0, matched: 0, note: "勤怠の実績を取得できませんでした" };
  }
  // 自社の在籍メンバーのみ保存する（jinjer 側は退職者も含むため）。
  const members = await prisma.member.findMany({
    where: { status: "在籍" },
    select: { personId: true },
  });
  const known = new Set(members.map((m) => m.personId));
  let updated = 0;
  for (const r of rows) {
    if (!known.has(r.personId)) continue;
    await prisma.workHours.upsert({
      where: { yearMonth_personId: { yearMonth, personId: r.personId } },
      update: { hours: r.hours },
      create: { yearMonth, personId: r.personId, hours: r.hours },
    });
    updated += 1;
  }
  await audit(actor, "workhours.sync", "WorkHours", yearMonth, { fetched: rows.length, updated });
  return { fetched: rows.length, updated, matched: updated, note: null as string | null };
}

/** 対象月の実労働時間（personId → 時間）。 */
async function workHoursMapFor(yearMonth: string): Promise<Map<string, number>> {
  const rows = await prisma.workHours.findMany({ where: { yearMonth } });
  return new Map(rows.map((r) => [r.personId, r.hours.toNumber()]));
}

/**
 * 予算Digの算定に使う「役職ベース相当額」。
 * アルバイトは その月の実労働時間 × 時給（社員と同じ係数を後段で掛ける）。
 * 実労働時間が取れない月は登録済みの役職ベースにフォールバックする。
 */
export function baseAmountForBudget(
  m: { employmentType: string; positionBase: number; hourlyWage: number | null },
  workHours: number | undefined,
): number {
  if (m.employmentType === "アルバイト" && m.hourlyWage && m.hourlyWage > 0 && workHours && workHours > 0) {
    return Math.round(workHours * m.hourlyWage);
  }
  return m.positionBase;
}

// ─────────────────────────────────────────────
// 組織（事業部 > グループ > チーム）
// ─────────────────────────────────────────────
export const ORG_LEVELS = ["事業部", "グループ", "チーム"] as const;
export type OrgLevel = (typeof ORG_LEVELS)[number];

interface OrgNode {
  id: number;
  name: string;
  level: string;
  parentId: number | null;
  leaderId: string | null;
  isTarget: boolean;
  active: boolean;
  incentiveRatePct: number | null;
}

/** インセンティブ還元率（%）。自分→祖先の順に探し、無ければ既定20%。 */
function incentiveRateOf(id: number | null, byId: Map<number, OrgNode>): number {
  let cur = id === null ? undefined : byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (typeof cur.incentiveRatePct === "number") return cur.incentiveRatePct / 100;
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return INCENTIVE_RATE;
}

/** personId → インセンティブ還元率 のマップ（組織未設定は既定20%）。 */
export async function incentiveRateMap(): Promise<Map<string, number>> {
  const [units, members] = await Promise.all([
    prisma.orgUnit.findMany(),
    prisma.member.findMany({ where: { status: "在籍" }, select: { personId: true, orgUnitId: true } }),
  ]);
  const byId = new Map(units.map((u) => [u.id, u as OrgNode]));
  return new Map(members.map((m) => [m.personId, incentiveRateOf(m.orgUnitId, byId)]));
}

// ─────────────────────────────────────────────
// 事業部別の Dig予算設定（旧「設定タブ」の指標をここへ集約）
// ─────────────────────────────────────────────
/** Prisma の Decimal? を number|null へ。 */
function decOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number((v as { toString(): string }).toString());
  return Number.isFinite(n) ? n : null;
}

/** Prisma の OrgUnit 行 → 継承をたどるためのノードへ。 */
function toSettingNode(u: Record<string, unknown>): OrgSettingNode {
  const node = { id: u.id as number, parentId: (u.parentId ?? null) as number | null } as OrgSettingNode;
  for (const k of ORG_SETTING_KEYS) node[k] = decOrNull(u[k]);
  return node;
}

/** personId → 所属組織から継承した上書き のマップ（組織未設定なら全項目 null）。 */
export async function orgOverrideMap(): Promise<Map<string, OrgSettingOverride>> {
  const [units, members] = await Promise.all([
    prisma.orgUnit.findMany(),
    prisma.member.findMany({ select: { personId: true, orgUnitId: true } }),
  ]);
  const byId = new Map(units.map((u) => [u.id, toSettingNode(u as unknown as Record<string, unknown>)]));
  // 同じ組織の人が何度も祖先をたどらないよう、組織単位でキャッシュする。
  const cache = new Map<number | null, OrgSettingOverride>();
  const overrideFor = (orgUnitId: number | null) => {
    const hit = cache.get(orgUnitId);
    if (hit) return hit;
    const ov = inheritedOverride(orgUnitId, byId);
    cache.set(orgUnitId, ov);
    return ov;
  };
  return new Map(members.map((m) => [m.personId, overrideFor(m.orgUnitId)]));
}

/**
 * personId → その人に適用される Setting のマップ。
 * 所属組織（自分→祖先）の上書きを全社設定に重ねる。組織未設定なら全社設定そのまま。
 */
export async function settingMap(base: Setting): Promise<Map<string, Setting>> {
  const overrides = await orgOverrideMap();
  return new Map([...overrides].map(([personId, ov]) => [personId, mergeSetting(base, ov)]));
}

/** 祖先をたどって事業部の名前を返す（自分が事業部ならその名前）。 */
function divisionNameOf(id: number | null, byId: Map<number, OrgNode>): string | null {
  let cur = id === null ? undefined : byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.level === "事業部") return cur.name;
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return null;
}

/** 「事業部 > グループ > チーム」の表示用パス。 */
function pathOf(id: number, byId: Map<number, OrgNode>): string {
  const parts: string[] = [];
  let cur: OrgNode | undefined = byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return parts.join(" > ");
}

/** 自分または祖先が評価対象に指定されているか。 */
function inTargetScope(id: number | null, byId: Map<number, OrgNode>): boolean {
  let cur = id === null ? undefined : byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.isTarget) return true;
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return false;
}

/** 組織一覧（階層パス・所属人数・長の氏名つき）。 */
export async function listOrgUnits() {
  const [units, members] = await Promise.all([
    prisma.orgUnit.findMany({ orderBy: [{ level: "asc" }, { name: "asc" }] }),
    prisma.member.findMany({
      where: { status: "在籍" },
      select: { personId: true, name: true, orgUnitId: true },
    }),
  ]);
  const byId = new Map(units.map((u) => [u.id, u as OrgNode]));
  // 事業部別の予算設定は「自分に入っている値」と「継承後の実効値」の両方を返す。
  const settingById = new Map(
    units.map((u) => [u.id, toSettingNode(u as unknown as Record<string, unknown>)]),
  );
  const nameOf = new Map(members.map((m) => [m.personId, m.name]));
  const directCount = new Map<number, number>();
  for (const m of members) {
    if (m.orgUnitId !== null) directCount.set(m.orgUnitId, (directCount.get(m.orgUnitId) ?? 0) + 1);
  }
  // 配下（子孫）まで含めた人数。
  const descendants = (id: number): number => {
    let n = directCount.get(id) ?? 0;
    for (const u of units) if (u.parentId === id) n += descendants(u.id);
    return n;
  };
  return units.map((u) => ({
    id: u.id,
    name: u.name,
    level: u.level,
    parentId: u.parentId,
    leaderId: u.leaderId,
    leaderName: u.leaderId ? (nameOf.get(u.leaderId) ?? u.leaderId) : null,
    isTarget: u.isTarget,
    active: u.active,
    incentiveRatePct: u.incentiveRatePct,
    /** 実際に適用される還元率(%)。未設定なら祖先→既定20 */
    effectiveIncentiveRatePct: Math.round(incentiveRateOf(u.id, byId) * 100),
    path: pathOf(u.id, byId),
    division: divisionNameOf(u.id, byId),
    /** 評価対象か（自分または祖先の指定を含む） */
    inTargetScope: inTargetScope(u.id, byId),
    directMembers: directCount.get(u.id) ?? 0,
    totalMembers: descendants(u.id),
    /** この組織に直接入っている上書き（null は上位を継承） */
    setting: settingById.get(u.id) as OrgSettingOverride,
    /** 継承を解決したあと、全社設定に重ねた実効値 */
    effectiveSetting: mergeSetting(DEFAULT_SETTING, inheritedOverride(u.id, settingById)),
  }));
}

export async function createOrgUnit(input: {
  name: string;
  level: string;
  parentId: number | null;
  actor: string;
}) {
  const name = input.name.trim();
  if (!name) throw new ConflictError("組織名を入力してください");
  if (!ORG_LEVELS.includes(input.level as OrgLevel)) throw new ConflictError("階層が不正です");
  if (input.level === "事業部" && input.parentId !== null) {
    throw new ConflictError("事業部は最上位のため親を指定できません");
  }
  if (input.level !== "事業部" && input.parentId === null) {
    throw new ConflictError("グループ・チームは親組織を選択してください");
  }
  const dup = await prisma.orgUnit.findFirst({ where: { name, parentId: input.parentId } });
  if (dup) throw new ConflictError("同じ親の下に同名の組織があります");
  const created = await prisma.orgUnit.create({
    data: { name, level: input.level, parentId: input.parentId },
  });
  await audit(input.actor, "org.create", "OrgUnit", String(created.id), {
    name,
    level: input.level,
    parentId: input.parentId,
  });
  return created;
}

export async function updateOrgUnit(
  id: number,
  patch: {
    name?: string;
    leaderId?: string | null;
    isTarget?: boolean;
    active?: boolean;
    incentiveRatePct?: number | null;
  } & Partial<OrgSettingOverride>,
  actor: string,
) {
  const unit = await prisma.orgUnit.findUnique({ where: { id } });
  if (!unit) throw new NotFoundError("組織が見つかりません");
  const data: Prisma.OrgUnitUpdateInput = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ConflictError("組織名を入力してください");
    const dup = await prisma.orgUnit.findFirst({
      where: { name, parentId: unit.parentId, id: { not: id } },
    });
    if (dup) throw new ConflictError("同じ親の下に同名の組織があります");
    data.name = name;
  }
  if (patch.leaderId !== undefined) data.leaderId = patch.leaderId || null;
  if (patch.isTarget !== undefined) data.isTarget = patch.isTarget;
  if (patch.incentiveRatePct !== undefined) data.incentiveRatePct = patch.incentiveRatePct;
  if (patch.active !== undefined) data.active = patch.active;
  // 事業部別の予算指標・昇降級しきい値。null を渡すと「上位を継承」に戻る。
  for (const k of ORG_SETTING_KEYS) {
    if (patch[k] !== undefined) data[k] = patch[k];
  }
  const updated = await prisma.orgUnit.update({ where: { id }, data });
  // 事業部名を変えたら、配下メンバーの division 表記も追随させる。
  if (patch.name !== undefined) await syncMemberDivisions(actor);
  await audit(actor, "org.update", "OrgUnit", String(id), patch as Prisma.InputJsonValue);
  return updated;
}

export async function deleteOrgUnit(id: number, actor: string) {
  const [children, members] = await Promise.all([
    prisma.orgUnit.count({ where: { parentId: id } }),
    prisma.member.count({ where: { orgUnitId: id } }),
  ]);
  if (children > 0) throw new ConflictError("配下の組織があるため削除できません");
  if (members > 0) throw new ConflictError(`所属メンバーが ${members} 名いるため削除できません`);
  await prisma.orgUnit.delete({ where: { id } });
  await audit(actor, "org.delete", "OrgUnit", String(id), {});
  return { id };
}

/** メンバーの所属組織を設定する（null で未所属に戻す）。division は事業部祖先へ追随。 */
export async function setMemberOrgUnit(personId: string, orgUnitId: number | null, actor: string) {
  const units = await prisma.orgUnit.findMany();
  const byId = new Map(units.map((u) => [u.id, u as OrgNode]));
  if (orgUnitId !== null && !byId.has(orgUnitId)) throw new NotFoundError("組織が見つかりません");
  const division = orgUnitId === null ? null : divisionNameOf(orgUnitId, byId);
  await prisma.member.update({
    where: { personId },
    data: {
      orgUnitId,
      // 事業部名は評価台帳・集計で使うため、組織から導出して保持する。
      ...(division ? { division, divisionOverride: division } : {}),
    },
  });
  await audit(actor, "member.org.set", "Member", personId, { orgUnitId, division });
  return { personId, orgUnitId, division };
}

/** 組織から導出される事業部名を全メンバーへ反映する（組織名変更時など）。 */
export async function syncMemberDivisions(actor: string) {
  const [units, members] = await Promise.all([
    prisma.orgUnit.findMany(),
    prisma.member.findMany({
      where: { orgUnitId: { not: null } },
      select: { personId: true, orgUnitId: true, division: true },
    }),
  ]);
  const byId = new Map(units.map((u) => [u.id, u as OrgNode]));
  let updated = 0;
  for (const m of members) {
    const division = divisionNameOf(m.orgUnitId, byId);
    if (division && division !== m.division) {
      await prisma.member.update({
        where: { personId: m.personId },
        data: { division, divisionOverride: division },
      });
      updated += 1;
    }
  }
  if (updated > 0) await audit(actor, "member.division.sync", "Member", null, { updated });
  return { updated };
}

/**
 * 評価対象の personId 一覧。
 * 組織が登録されていれば「自分または祖先が対象に指定された組織の所属者」、
 * 組織が未登録なら従来どおり対象事業部（TargetDivision）で判定する。
 */
export async function targetPersonIds(): Promise<string[] | null> {
  const units = await prisma.orgUnit.findMany();
  if (units.length === 0) return null; // 従来動作（TargetDivision）にフォールバック
  const byId = new Map(units.map((u) => [u.id, u as OrgNode]));
  const targetIds = new Set(units.filter((u) => inTargetScope(u.id, byId)).map((u) => u.id));
  if (targetIds.size === 0) return null;
  const members = await prisma.member.findMany({
    where: { status: "在籍", orgUnitId: { in: [...targetIds] } },
    select: { personId: true },
  });
  return members.map((m) => m.personId);
}

// ─────────────────────────────────────────────
// 役職の紐付け（jinjer の役職名 → Dig評価の役職）
// ─────────────────────────────────────────────
export const listPositionRules = () =>
  prisma.positionRule.findMany({ orderBy: { pattern: "asc" } });

export async function upsertPositionRule(pattern: string, position: string, actor: string) {
  const p = pattern.trim();
  if (!p) throw new ConflictError("jinjer の役職名を入力してください");
  const rule = await prisma.positionRule.upsert({
    where: { pattern: p },
    update: { position: position as Prisma.PositionRuleUpdateInput["position"] },
    create: { pattern: p, position: position as Prisma.PositionRuleCreateInput["position"] },
  });
  await audit(actor, "position.rule.upsert", "PositionRule", String(rule.id), { pattern: p, position });
  return rule;
}

export async function deletePositionRule(id: number, actor: string) {
  await prisma.positionRule.delete({ where: { id } });
  await audit(actor, "position.rule.delete", "PositionRule", String(id), {});
  return { id };
}

/**
 * 紐付けルールを全在籍メンバーへ適用する（jinjerPosition → position）。
 * 一覧で手入力した人（positionManual）は上書きしない。
 */
export async function applyPositionRules(actor: string) {
  const rules = await prisma.positionRule.findMany();
  const map = new Map(rules.map((r) => [r.pattern, r.position]));
  const members = await prisma.member.findMany({
    where: { status: "在籍", positionManual: false, jinjerPosition: { not: null } },
    select: { personId: true, jinjerPosition: true, position: true },
  });
  let updated = 0;
  for (const m of members) {
    const next = map.get(m.jinjerPosition ?? "");
    if (next && next !== m.position) {
      await prisma.member.update({ where: { personId: m.personId }, data: { position: next } });
      updated += 1;
    }
  }
  await audit(actor, "position.rule.apply", "Member", null, { updated, rules: rules.length });
  return { updated, total: members.length, rules: rules.length };
}

/** jinjer から取得した役職名の一覧（紐付け画面の候補）。 */
export async function listJinjerPositions() {
  const rows = await prisma.member.groupBy({
    by: ["jinjerPosition"],
    where: { status: "在籍", jinjerPosition: { not: null } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ name: r.jinjerPosition as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────
// 部署の紐づけ（jinjer 所属名 → dgloss 事業部）
// ─────────────────────────────────────────────
/** ルール一覧（前方一致は長いパターン優先で評価するため長さ降順）。 */
export const listDivisionRules = () =>
  prisma.divisionRule.findMany({ orderBy: [{ division: "asc" }, { pattern: "asc" }] });

/** ルールを適用して事業部名を決める。該当なしは fallback をそのまま返す。 */
export function applyDivisionRules(
  team: string,
  rules: Array<{ pattern: string; division: string }>,
  fallback: string,
): string {
  if (!team) return fallback;
  // 前方一致。より長い（具体的な）パターンを優先。
  const hit = rules
    .filter((r) => r.pattern && team.startsWith(r.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return hit ? hit.division : fallback;
}

export async function upsertDivisionRule(pattern: string, division: string, actor: string) {
  const row = await prisma.divisionRule.upsert({
    where: { pattern },
    update: { division },
    create: { pattern, division },
  });
  await audit(actor, "division.rule.upsert", "DivisionRule", String(row.id), { pattern, division });
  return row;
}

export async function deleteDivisionRule(id: number, actor: string) {
  const row = await prisma.divisionRule.delete({ where: { id } });
  await audit(actor, "division.rule.delete", "DivisionRule", String(id), { pattern: row.pattern });
  return { ok: true };
}

/**
 * 保存済みルールを全在籍メンバーへ再適用する（jinjer へは問い合わせない）。
 * jinjerTeam（末端所属の原本）を元に division を再計算するため高速。
 */
export async function reapplyDivisionRules(actor: string) {
  const rules = await listDivisionRules();
  const members = await prisma.member.findMany({
    where: { status: "在籍" },
    select: { personId: true, division: true, jinjerTeam: true, divisionOverride: true },
  });
  let updated = 0;
  let restored = 0;
  for (const m of members) {
    // 個別指定がある人は、その値を division へ確実に戻す（同期等でズレても復元できるように）。
    if (m.divisionOverride) {
      if (m.divisionOverride !== m.division) {
        await prisma.member.update({
          where: { personId: m.personId },
          data: { division: m.divisionOverride },
        });
        restored += 1;
      }
      continue;
    }
    const team = m.jinjerTeam ?? m.division;
    const next = applyDivisionRules(team, rules, m.division);
    if (next && next !== m.division) {
      await prisma.member.update({ where: { personId: m.personId }, data: { division: next } });
      updated += 1;
    }
  }
  await audit(actor, "division.rule.reapply", "Member", null, { updated, restored, rules: rules.length });
  return { updated, restored, total: members.length, rules: rules.length };
}

/**
 * メンバー個別に事業部を指定する（同期・ルール適用より優先される）。
 * 同一 jinjer 所属でも人によって事業部が異なるケースに対応する。
 * division を空にすると個別指定を解除し、ルール/同期の値に戻る。
 */
export async function setMemberDivision(personId: string, division: string, actor: string) {
  const value = division.trim();
  if (value) {
    await prisma.member.update({
      where: { personId },
      data: { divisionOverride: value, division: value },
    });
  } else {
    // 解除: ルールを再適用して元の値に戻す。
    const m = await prisma.member.findUnique({ where: { personId } });
    if (!m) throw new NotFoundError("member not found");
    const rules = await listDivisionRules();
    const team = m.jinjerTeam ?? m.division;
    await prisma.member.update({
      where: { personId },
      data: { divisionOverride: null, division: applyDivisionRules(team, rules, team) },
    });
  }
  await audit(actor, "member.division.override", "Member", personId, { division: value || null });
  return { personId, division: value || null };
}

/** 事業部で絞った在籍メンバー（役職ベース入力画面用）。 */
export async function listMembersByDivision(division?: string) {
  return prisma.member.findMany({
    where: { status: "在籍", ...(division ? { division } : {}) },
    select: {
      personId: true,
      name: true,
      division: true,
      position: true,
      employmentType: true,
      basePay: true,
      hourlyWage: true,
      positionBase: true,
      evaluationCycle: true,
      salaryGrade: true,
      joinedOn: true,
    },
    orderBy: [{ division: "asc" }, { personId: "asc" }],
  });
}

/** 在籍メンバーの事業部一覧（絞り込み用）。 */
export async function listDivisions(): Promise<string[]> {
  const rows = await prisma.member.findMany({
    where: { status: "在籍" },
    select: { division: true },
    distinct: ["division"],
    orderBy: { division: "asc" },
  });
  return rows.map((r) => r.division).filter(Boolean);
}

// ─────────────────────────────────────────────
// 給与レンジ表（役職 × A/B/C → 金額）。役職ベースの参照元（要件 F-1）
// ─────────────────────────────────────────────
/** 給与レンジ表を {役職: {A|B|C: 金額}} の形で取得。 */
export async function getSalaryRangeMap(): Promise<Record<string, Record<string, number>>> {
  const rows = await prisma.salaryRange.findMany();
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    map[r.position] ??= {};
    map[r.position][r.grade] = r.amount.toNumber();
  }
  return map;
}

export const listSalaryRanges = () =>
  prisma.salaryRange.findMany({ orderBy: [{ position: "asc" }, { grade: "asc" }] });

/** 実際の給与（月額）に最も近いレンジ(A/B/C)を選ぶ。 */
export function nearestRange(
  ranges: Record<string, number> | undefined,
  monthlySalary: number,
): { grade: string; amount: number } | null {
  if (!ranges) return null;
  const entries = Object.entries(ranges);
  if (entries.length === 0) return null;
  if (monthlySalary <= 0) return null;
  let best = entries[0];
  for (const e of entries) {
    if (Math.abs(e[1] - monthlySalary) < Math.abs(best[1] - monthlySalary)) best = e;
  }
  return { grade: best[0], amount: best[1] };
}

/** 給与（月額）。正社員は基本給、時給者は 時給×160h を目安に月額換算。 */
function monthlySalaryOf(m: { basePay: Prisma.Decimal; hourlyWage: Prisma.Decimal | null }): number {
  const base = m.basePay.toNumber();
  if (base > 0) return base;
  const hourly = m.hourlyWage ? m.hourlyWage.toNumber() : 0;
  return hourly > 0 ? Math.round(hourly * 160) : 0;
}

/**
 * 対象メンバーのレンジ(A/B/C)を実際の給与から自動判定し、役職ベースを設定する。
 * 既にレンジが設定されている人も、給与に最も近いレンジで再判定する。
 */
export async function autoAssignSalaryRanges(division: string | undefined, actor: string) {
  const rangeMap = await getSalaryRangeMap();
  const members = await prisma.member.findMany({
    // 一覧で金額を手入力した人は自動判定で上書きしない。
    where: { status: "在籍", positionBaseManual: false, ...(division ? { division } : {}) },
  });
  let updated = 0;
  let skipped = 0;
  for (const m of members) {
    const salary = monthlySalaryOf(m);
    const hit = nearestRange(rangeMap[m.position], salary);
    if (!hit) {
      skipped += 1; // 給与未取得・レンジ表未整備
      continue;
    }
    await prisma.member.update({
      where: { personId: m.personId },
      data: { salaryGrade: hit.grade, positionBase: hit.amount },
    });
    updated += 1;
  }
  await audit(actor, "member.salary_range.auto", "Member", null, { updated, skipped, division: division ?? null });
  return { updated, skipped, total: members.length };
}

/**
 * 役職・レンジ・役職ベース・評価サイクルの一括更新。
 * レンジ(A/B/C)が指定されていれば、給与レンジ表の該当額を役職ベースに設定する
 * （要件 F-1: 役職×A/B/C の金額表を参照）。
 */
export async function bulkUpdatePositionBase(
  rows: Array<{
    personId: string;
    position?: string;
    positionBase?: number;
    evaluationCycle?: string;
    salaryGrade?: string;
    aggregateMode?: string;
  }>,
  actor: string,
) {
  const rangeMap = await getSalaryRangeMap();
  let updated = 0;
  for (const r of rows) {
    const data: Prisma.MemberUpdateInput = {};
    // 役職を手入力したら、以降は jinjer の紐付けルールで上書きしない。
    if (r.position) {
      data.position = r.position as Prisma.MemberUpdateInput["position"];
      data.positionManual = true;
    }
    if (r.evaluationCycle) data.evaluationCycle = r.evaluationCycle as Prisma.MemberUpdateInput["evaluationCycle"];
    if (r.aggregateMode) data.aggregateMode = r.aggregateMode;
    if (r.salaryGrade) data.salaryGrade = r.salaryGrade;

    // レンジが決まっていれば給与レンジ表の金額を役職ベースにする（手入力より優先）。
    const current = await prisma.member.findUnique({
      where: { personId: r.personId },
      select: { position: true, salaryGrade: true },
    });
    const position = r.position ?? current?.position;
    const grade = r.salaryGrade ?? current?.salaryGrade ?? undefined;
    const fromRange = position && grade ? rangeMap[position]?.[grade] : undefined;
    // 金額を直接入力した場合は、それを優先して手入力扱いにする（自動判定で上書きしない）。
    // レンジを選び直した場合はレンジの金額を採用し、自動判定の対象に戻す。
    if (typeof r.positionBase === "number" && r.positionBase >= 0 && r.salaryGrade === undefined) {
      data.positionBase = r.positionBase;
      data.positionBaseManual = true;
    } else if (typeof fromRange === "number") {
      data.positionBase = fromRange;
      data.positionBaseManual = false;
    } else if (typeof r.positionBase === "number" && r.positionBase >= 0) {
      data.positionBase = r.positionBase;
      data.positionBaseManual = true;
    }

    if (Object.keys(data).length === 0) continue;
    await prisma.member.update({ where: { personId: r.personId }, data });
    updated += 1;
  }
  await audit(actor, "member.position_base.bulk", "Member", null, { updated, count: rows.length });
  return { updated, total: rows.length };
}

/** 紐づけ画面用: jinjer 所属（末端）別の人数と、現在の事業部。 */
export async function listTeamMappings(): Promise<
  Array<{
    team: string;
    division: string;
    count: number;
    members: Array<{ personId: string; name: string; division: string; overridden: boolean }>;
  }>
> {
  const members = await prisma.member.findMany({
    where: { status: "在籍" },
    select: { personId: true, name: true, division: true, jinjerTeam: true, divisionOverride: true },
    orderBy: { personId: "asc" },
  });
  const map = new Map<
    string,
    {
      team: string;
      division: string;
      count: number;
      members: Array<{ personId: string; name: string; division: string; overridden: boolean }>;
    }
  >();
  for (const m of members) {
    const team = m.jinjerTeam ?? m.division ?? "";
    const key = team || "(所属なし)";
    const cur = map.get(key) ?? { team: key, division: m.division ?? "", count: 0, members: [] };
    cur.count += 1;
    cur.members.push({
      personId: m.personId,
      name: m.name,
      division: m.division ?? "",
      overridden: !!m.divisionOverride,
    });
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * 部署ツリーの正規化プレビュー（末端所属 → 事業部 の対応を確認する診断）。
 * 反映せずに、所属1ページ目から「末端名 → 正規化後の事業部名」を返す。
 */
export async function previewDivisionMapping(): Promise<{
  sample: Array<{ personId: string; team: string; division: string }>;
  treeSize: number;
}> {
  const tree = await fetchDepartmentTree();
  const r = await fetchEnrichPage("affiliations", 1);
  const sample = r.rows.slice(0, 40).map((x) => ({
    personId: x.personId,
    team: x.teamName ?? "",
    division: x.division ?? "",
  }));
  return { sample, treeSize: tree.size };
}

/** 在籍メンバーの部署別人数（反映結果の確認用）。 */
export async function getDepartmentCounts(): Promise<Record<string, number>> {
  const members = await prisma.member.findMany({ where: { status: "在籍" }, select: { division: true } });
  const counts: Record<string, number> = {};
  for (const m of members) {
    const key = m.division || "(部署なし)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * 既存の在籍メンバーに jinjer の所属(部署)と基本給を反映する（一括版・小規模向け）。
 * 大量件数ではタイムアウトするため、通常は enrichMembersPage を使う。
 */
export async function enrichMembersFromJinjer(actor: string) {
  const { affMap, salMap } = await fetchOrgSalaryMaps();
  const members = await prisma.member.findMany({ where: { status: "在籍" } });
  let updatedDivision = 0;
  let updatedSalary = 0;
  const departmentCounts: Record<string, number> = {};
  for (const m of members) {
    const dept = affMap.get(m.personId);
    const bp = salMap.get(m.personId);
    const data: Prisma.MemberUpdateInput = {};
    if (dept) data.division = dept;
    if (bp && bp > 0) data.basePay = bp;
    if (Object.keys(data).length > 0) {
      await prisma.member.update({ where: { personId: m.personId }, data });
      if (data.division !== undefined) updatedDivision += 1;
      if (data.basePay !== undefined) updatedSalary += 1;
    }
    const key = (dept ?? m.division) || "(部署なし)";
    departmentCounts[key] = (departmentCounts[key] ?? 0) + 1;
  }
  await audit(actor, "member.enrich.jinjer", "Member", null, {
    affCount: affMap.size,
    salCount: salMap.size,
    updatedDivision,
    updatedSalary,
    total: members.length,
  });
  return {
    affCount: affMap.size,
    salCount: salMap.size,
    updatedDivision,
    updatedSalary,
    total: members.length,
    departmentCounts,
  };
}
