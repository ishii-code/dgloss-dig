/**
 * データアクセス層（Prisma）。API Route Handlers から利用。
 * rawSQL 不使用（CONVENTIONS）。変更系は監査ログを残す。
 */
import { Prisma } from "@prisma/client";
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
