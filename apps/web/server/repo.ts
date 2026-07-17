/**
 * データアクセス層（Prisma）。API Route Handlers から利用。
 * rawSQL 不使用（CONVENTIONS）。変更系は監査ログを残す。
 */
import { Prisma } from "@prisma/client";
import type {
  AssignmentShare,
  CalcRule,
  Contract,
  ContractLineItem,
} from "@dig/contracts";
import {
  achievementRate,
  aggregateSeikaDig,
  computeContractDig,
  evaluationRank,
  splitDig,
} from "@dig/core";
import { prisma } from "./db";

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
  unitLine: Prisma.Decimal; unitCall: Prisma.Decimal; ratioPercent: Prisma.Decimal; fixedDig: Prisma.Decimal; active: boolean;
}): CalcRule {
  return {
    id: row.id, division: row.division, name: row.name,
    ruleType: row.ruleType as CalcRule["ruleType"], modelKeyFilter: row.modelKeyFilter,
    unitLine: row.unitLine.toNumber(), unitCall: row.unitCall.toNumber(),
    ratioPercent: row.ratioPercent.toNumber(), fixedDig: row.fixedDig.toNumber(), active: row.active,
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

// ─────────────────────────────────────────────
// アカウント・権限（RBAC）
// ─────────────────────────────────────────────
export const listAccounts = () =>
  prisma.account.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });

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
