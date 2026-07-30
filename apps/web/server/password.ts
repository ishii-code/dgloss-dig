import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * パスワードのハッシュ化と照合（Node 標準の scrypt のみ・外部依存なし）。
 * 保存形式: scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 * 平文パスワードは保存も記録もしない。
 */
const N = 16384; // CPU/メモリコスト
const R = 8;
const P = 1;
const KEYLEN = 32;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/** 保存済みハッシュと平文を照合する（タイミング差を作らない比較）。 */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(plain.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// 紛らわしい文字（0/O/1/l/I）を除いた文字集合。仮パスワードは口頭・チャットで
// 伝えることがあるため、読み間違いが起きない字だけを使う。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 仮パスワードを生成する（既定12文字）。 */
export function generateTemporaryPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** パスワードの強度チェック（最低8文字・英字と数字を含む）。 */
export function validatePassword(plain: string): string | null {
  const p = plain.normalize("NFKC");
  if (p.length < 8) return "パスワードは8文字以上にしてください";
  if (p.length > 128) return "パスワードが長すぎます";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "英字と数字をそれぞれ1文字以上含めてください";
  return null;
}
