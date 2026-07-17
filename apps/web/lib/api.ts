/** クライアント側 API ラッパー（失敗時は呼び出し側でモックにフォールバック）。 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
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
  const json = (await res.json()) as { data?: T; error?: string };
  if (!res.ok) throw new Error(json.error ?? `${method} ${path} ${res.status}`);
  return json.data as T;
}
