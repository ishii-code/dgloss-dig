import { NextResponse } from "next/server";
import { z } from "zod";
import { ConflictError, NotFoundError } from "./repo";

function isDecimal(v: unknown): v is { toNumber: () => number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { toNumber?: unknown }).toNumber === "function"
  );
}

/**
 * Prisma Decimal → number / Date → ISO文字列 へ再帰変換（レスポンス整形）。
 * ※ JSON.stringify の replacer は Decimal.toJSON() の後に呼ばれ文字列化されるため、
 *   stringify 前に自前で走査する。
 */
export function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (isDecimal(value)) return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

export const ok = (data: unknown) => NextResponse.json({ data: serialize(data) });

export const created = (data: unknown) =>
  NextResponse.json({ data: serialize(data) }, { status: 201 });

export const error = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

/** ルートハンドラ共通のエラー処理（スタックトレースは返さない・CONVENTIONS） */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError) return error(400, e.issues.map((i) => i.message).join(", "));
    if (e instanceof NotFoundError) return error(404, e.message);
    if (e instanceof ConflictError) return error(409, e.message);
    console.error(e); // サーバ側のみ
    return error(500, "内部エラーが発生しました");
  }
}
