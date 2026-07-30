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
  computeContractDig,
  cumulativeBudgetElapsed,
  cumulativeMonths,
  evaluateMonthly,
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
import { DEFAULT_SETTING } from "@dig/contracts";

/** 対象月の評価を確定（finalized=true）し、インセン・昇降級のスナップショットを返す（Q8）。 */
export async function finalizeMonth(yearMonth: string, actor: string) {
  const evals = await prisma.monthlyEvaluation.findMany({ where: { yearMonth } });
  const snapshot = evals.map((ev) => {
    const seika = ev.seikaDig.toNumber();
    const bonus = ev.bonusDig.toNumber();
    const loan = ev.loanDig.toNumber();
    const budget = ev.monthlyBudgetDig.toNumber();
    // Q2/Q5案2: インセン原資=成果+ボーナス（借入除外）
    const qb = computeQuarterBalance({ personId: ev.personId, gross: seika, target: budget, bonus });
    // Q1案1: 昇級=借入抜き / 降級=借入込み
    const step = promotionStepDual({
      actualRate: ev.monthlyRate.toNumber(),
      promoRate: promotionRate(seika, bonus, budget),
      setting: DEFAULT_SETTING,
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
  const targets = await listTargetDivisions();
  if (targets.length === 0) return { deleted: 0 };
  const inScope = await prisma.member.findMany({
    where: { status: "在籍", division: { in: targets } },
    select: { personId: true },
  });
  const keep = inScope.map((m) => m.personId);
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
  const members = await prisma.member.findMany({
    where: { status: "在籍", groupLeaderId: { not: null } },
    select: { personId: true, groupLeaderId: true },
  });
  if (members.length === 0) return { leaders: 0 };
  const byLeader = new Map<string, string[]>();
  for (const m of members) {
    const leader = m.groupLeaderId!;
    byLeader.set(leader, [...(byLeader.get(leader) ?? []), m.personId]);
  }

  let leaders = 0;
  for (const [leaderId, subIds] of byLeader) {
    const rows = await prisma.monthlyEvaluation.findMany({
      where: { yearMonth, personId: { in: [leaderId, ...subIds] } },
    });
    const own = rows.find((r) => r.personId === leaderId);
    if (!own || own.finalized) continue;
    const subs = rows.filter((r) => r.personId !== leaderId);
    if (subs.length === 0) continue;

    const monthlyBudget = rows.reduce((a, r) => a + r.monthlyBudgetDig.toNumber(), 0);
    const cumulativeBudget = rows.reduce((a, r) => a + r.cumulativeBudgetDig.toNumber(), 0);
    const monthlyActual = rows.reduce((a, r) => a + r.monthlyActualDig.toNumber(), 0);
    const cumulativeActual = rows.reduce((a, r) => a + r.cumulativeActualDig.toNumber(), 0);
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
  const targets = await listTargetDivisions();
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
      ...(targets.length > 0 ? { division: { in: targets } } : {}),
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
        setting,
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

  // 対象月に計上される承認済借入（入社時の初回借入を含む）を実績Digへ反映する。
  const loanMap = await loanDigMapFor(yearMonth);
  // 予算Digの月別上書き（運用指定があれば計算値より優先）。
  const overrides = new Map(
    (await prisma.budgetOverride.findMany({ where: { yearMonth } })).map((o) => [
      o.personId,
      o.monthlyBudgetDig.toNumber(),
    ]),
  );
  // Dig制度の対象事業部に限定（未登録なら全事業部を対象＝従来動作）。
  const targets = await listTargetDivisions();
  const members = await prisma.member.findMany({
    where: { status: "在籍", ...(targets.length > 0 ? { division: { in: targets } } : {}) },
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
        positionBase: m.positionBase.toNumber(),
        joinedOn: m.joinedOn.toISOString().slice(0, 10),
        leftOn: m.leftOn ? m.leftOn.toISOString().slice(0, 10) : null,
        evaluationCycle: m.evaluationCycle as EvaluationCycle,
        seikaDig: seika,
        bonusDig: bonus,
        loanDig: loan,
        setting,
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
      setting,
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
  let created = 0;
  let updated = 0;
  for (const e of employees) {
    const existing = await prisma.member.findUnique({ where: { personId: e.personId } });
    const joinedOn = new Date(`${e.joinedOn}T00:00:00Z`);
    if (existing) {
      // 勤怠/所属由来の項目を更新。基本給は jinjer から取れた場合のみ反映（0は既存維持）。
      await prisma.member.update({
        where: { personId: e.personId },
        data: {
          name: e.name,
          division: e.division,
          position: e.position as Prisma.MemberUpdateInput["position"],
          employmentType: e.employmentType as Prisma.MemberUpdateInput["employmentType"],
          joinedOn,
          status: "在籍",
          ...(e.basePay > 0 ? { basePay: e.basePay } : {}),
        },
      });
      updated += 1;
    } else {
      await prisma.member.create({
        data: {
          personId: e.personId,
          name: e.name,
          division: e.division,
          position: e.position as Prisma.MemberCreateInput["position"],
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

  await audit(actor, "member.sync.jinjer", "Member", null, {
    connected,
    fetched,
    parsed,
    created,
    updated,
    executiveCount,
    retiredInDb,
    excluded: excluded.length,
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
    synced: employees.length,
    excludedDivisions: EXCLUDED_DIVISIONS,
    excludedCount: excluded.length,
    // マッピング診断用（取込0名時の原因特定）。parsed=0 のときのみ本文/キーを載せる。
    rawSampleKeys,
    rawSample: parsed === 0 ? rawSample : null,
  };
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
  for (const m of members) {
    if (m.divisionOverride) continue; // 個別指定は保持
    const team = m.jinjerTeam ?? m.division;
    const next = applyDivisionRules(team, rules, m.division);
    if (next && next !== m.division) {
      await prisma.member.update({ where: { personId: m.personId }, data: { division: next } });
      updated += 1;
    }
  }
  await audit(actor, "division.rule.reapply", "Member", null, { updated, rules: rules.length });
  return { updated, total: members.length, rules: rules.length };
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
    where: { status: "在籍", ...(division ? { division } : {}) },
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
  }>,
  actor: string,
) {
  const rangeMap = await getSalaryRangeMap();
  let updated = 0;
  for (const r of rows) {
    const data: Prisma.MemberUpdateInput = {};
    if (r.position) data.position = r.position as Prisma.MemberUpdateInput["position"];
    if (r.evaluationCycle) data.evaluationCycle = r.evaluationCycle as Prisma.MemberUpdateInput["evaluationCycle"];
    if (r.salaryGrade) data.salaryGrade = r.salaryGrade;

    // レンジが決まっていれば給与レンジ表の金額を役職ベースにする（手入力より優先）。
    const current = await prisma.member.findUnique({
      where: { personId: r.personId },
      select: { position: true, salaryGrade: true },
    });
    const position = r.position ?? current?.position;
    const grade = r.salaryGrade ?? current?.salaryGrade ?? undefined;
    const fromRange = position && grade ? rangeMap[position]?.[grade] : undefined;
    if (typeof fromRange === "number") {
      data.positionBase = fromRange;
    } else if (typeof r.positionBase === "number" && r.positionBase >= 0) {
      data.positionBase = r.positionBase;
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
