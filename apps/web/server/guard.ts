import { auth } from "@/auth";
import { authEnabled } from "@/auth.config";
import { ROLE_LEVEL, type Role } from "@dig/contracts";

export class ForbiddenError extends Error {}

export interface Viewer {
  email: string;
  role: Role;
  personId: string | null;
}

/**
 * サインイン中の利用者を返す。認証が未設定（env未設定）の場合は null を返し、
 * 呼び出し側は従来どおり制限なしで動作する（本番を壊さないための移行措置）。
 */
export async function viewer(): Promise<Viewer | null> {
  if (!authEnabled) return null;
  const session = await auth();
  const u = session?.user;
  if (!u?.email) return null;
  return {
    email: u.email,
    role: ((u.role as Role) ?? "USER") as Role,
    personId: u.personId ?? null,
  };
}

/** ADMIN 以上か。 */
export function isAdmin(v: Viewer | null): boolean {
  return v !== null && ROLE_LEVEL[v.role] >= ROLE_LEVEL.ADMIN;
}

/** ADMIN 以上を要求する（認証未設定時は素通り）。 */
export async function requireAdmin(): Promise<Viewer | null> {
  const v = await viewer();
  if (v === null) return null; // 認証未設定
  if (!isAdmin(v)) throw new ForbiddenError("この操作には ADMIN 以上の権限が必要です");
  return v;
}

/**
 * 本人（または ADMIN 以上）であることを要求する。
 * 他人の実績・借入・申請を覗けないようにするため、個人データのAPIで使う。
 */
export async function requireSelfOrAdmin(personId: string): Promise<Viewer | null> {
  const v = await viewer();
  if (v === null) return null; // 認証未設定
  if (isAdmin(v)) return v;
  if (v.personId && v.personId === personId) return v;
  throw new ForbiddenError("自分以外のデータは参照できません");
}
