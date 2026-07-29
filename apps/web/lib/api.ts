/** レスポンスをJSONとして安全に読む。非JSON（タイムアウト等のエラーページ）は明示エラーに。 */
async function readJson(res: Response, path: string): Promise<{ data?: unknown; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { data?: unknown; error?: string };
  } catch {
    // Vercel のタイムアウト/エラーページ等、非JSONが返るケースを分かりやすく通知。
    if (res.status === 504 || /timeout/i.test(text)) {
      throw new Error(`サーバー処理がタイムアウトしました（${path}）。時間をおいて再試行してください。`);
    }
    throw new Error(`サーバー応答が不正です（HTTP ${res.status} ${path}）。時間をおいて再試行してください。`);
  }
}

/** クライアント側 API ラッパー（失敗時は呼び出し側でモックにフォールバック）。 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await readJson(res, path);
  if (!res.ok) throw new Error(json.error ?? `GET ${path} ${res.status}`);
  return json.data as T;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await readJson(res, path);
  if (!res.ok) throw new Error(json.error ?? `${method} ${path} ${res.status}`);
  return json.data as T;
}
