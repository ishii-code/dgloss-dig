import { handlers } from "@/auth";

export const runtime = "nodejs";

// Auth.js のエンドポイント（/api/auth/signin, /api/auth/callback/google 等）。
export const { GET, POST } = handlers;
