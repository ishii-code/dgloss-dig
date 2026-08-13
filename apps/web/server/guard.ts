import { auth } from "@/auth";
import { authEnabled } from "@/auth.config";
import { accountManageDenial, ROLE_LEVEL, type Role } from "@dig/contracts";

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

/**
 * サインイン済みであることを要求する（認証未設定時は素通り）。
 * 認証が有効なのにセッションが無い場合は 403 にする（未ログインを「素通り」にしない）。
 */
export async function requireSignedIn(): Promise<Viewer | null> {
  if (!authEnabled) return null; // 認証未設定＝従来どおり制限なし
  const v = await viewer();
  if (!v) throw new ForbiddenError("ログインが必要です");
  return v;
}

/** 指定レベル以上の権限を要求する（認証未設定時は素通り）。 */
async function requireLevel(need: number, label: string): Promise<Viewer | null> {
  const v = await requireSignedIn();
  if (v === null) return null;
  if (ROLE_LEVEL[v.role] < need) throw new ForbiddenError(`この操作には ${label} 権限が必要です`);
  return v;
}

/** ADMIN 以上を要求する。 */
export const requireAdmin = () => requireLevel(ROLE_LEVEL.ADMIN, "ADMIN 以上の");

/** スーパーADMIN のみを許可する（従業員マスタ・金融承認）。 */
export const requireSuperAdmin = () => requireLevel(ROLE_LEVEL.SUPER_ADMIN, "スーパーADMIN の");

/** スーパーADMIN か。 */
export function isSuperAdmin(v: Viewer | null): boolean {
  return v !== null && ROLE_LEVEL[v.role] >= ROLE_LEVEL.SUPER_ADMIN;
}

/**
 * アカウントを操作してよいかを検査する（アカウント管理は ADMIN 以上に開放済み）。
 * 判定そのものは contracts の accountManageDenial が持つ（純粋関数・テスト対象）。
 *
 * @param v          操作している人（認証未設定なら null＝従来どおり素通り）
 * @param targetRole 操作対象アカウントの現在のロール（新規作成なら undefined）
 * @param nextRole   付与しようとしているロール（変更しないなら undefined）
 */
export function assertCanManageAccount(
  v: Viewer | null,
  targetRole?: string | null,
  nextRole?: string | null,
): void {
  if (v === null) return; // 認証未設定＝従来どおり制限なし
  const denial = accountManageDenial(v.role, targetRole, nextRole);
  if (denial) throw new ForbiddenError(denial);
}

/**
 * 本人（または ADMIN 以上）であることを要求する。
 * 他人の実績・借入・申請を覗けないようにするため、個人データのAPIで使う。
 */
export async function requireSelfOrAdmin(personId: string): Promise<Viewer | null> {
  const v = await requireSignedIn();
  if (v === null) return null; // 認証未設定
  if (isAdmin(v)) return v;
  if (v.personId && v.personId === personId) return v;
  throw new ForbiddenError("自分以外のデータは参照できません");
}
