/**
 * 実データ（DB）→ 画面表示用 MemberRow への変換。
 * トップの「予実モニター」「メンバー評価」を mock ではなく
 * /api/evaluations + /api/members の実データで描画するために使う。
 */
import type { EvaluationCycle, Rank } from "@dig/contracts";
import { computeQuarterBalance } from "@dig/core";
import type { MemberRow } from "./mock";

/** /api/evaluations の 1 行（http.ts の serialize 済み: Decimal→number, Date→ISO）。 */
export interface EvaluationDto {
  yearMonth: string;
  personId: string;
  division: string;
  positionBase: number; // 予算Dig の計算元（0だと座席コスト分だけになる）
  residencyDays: number;
  prorationCoefficient: number;
  monthlyBudgetDig: number;
  cumulativeBudgetDig: number;
  seikaDig: number;
  bonusDig: number;
  loanDig: number;
  monthlyActualDig: number;
  monthlyRate: number;
  monthlyRank: Rank;
  cumulativeActualDig: number;
  cumulativeRate: number;
  cumulativeRank: Rank;
}

/** /api/members の 1 行（本変換で必要な項目のみ）。 */
export interface MemberDto {
  personId: string;
  name: string;
  division: string;
  evaluationCycle: EvaluationCycle;
}

/**
 * 評価行（DB）とメンバーマスタ（氏名・サイクル）を突き合わせて MemberRow[] を作る。
 * 氏名・サイクルはメンバーマスタ優先。マスタに無い場合は personId/半期でフォールバック。
 */
export function buildMembersFromDb(
  evaluations: EvaluationDto[],
  members: MemberDto[],
): MemberRow[] {
  const byId = new Map(members.map((m) => [m.personId, m]));
  return evaluations.map((e) => {
    const meta = byId.get(e.personId);
    const qb = computeQuarterBalance({
      personId: e.personId,
      gross: e.seikaDig,
      target: e.monthlyBudgetDig,
      bonus: e.bonusDig,
    });
    return {
      personId: e.personId,
      name: meta?.name ?? e.personId,
      division: meta?.division ?? e.division,
      cycle: meta?.evaluationCycle ?? "半期",
      eval: {
        yearMonth: e.yearMonth,
        personId: e.personId,
        residencyDays: e.residencyDays ?? 0,
        prorationCoefficient: e.prorationCoefficient ?? 0,
        seatCost: 0,
        totalCost: 0,
        monthlyBudgetDig: e.monthlyBudgetDig,
        cumulativeBudgetDig: e.cumulativeBudgetDig,
        seikaDig: e.seikaDig,
        bonusDig: e.bonusDig,
        loanDig: e.loanDig,
        monthly: {
          actualDig: e.monthlyActualDig,
          achievementRate: e.monthlyRate,
          rank: e.monthlyRank,
        },
        cumulative: {
          actualDig: e.cumulativeActualDig,
          achievementRate: e.cumulativeRate,
          rank: e.cumulativeRank,
        },
      },
      incentive: qb.incentive,
      positionBase: e.positionBase,
    };
  });
}
