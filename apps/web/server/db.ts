import { PrismaClient } from "@prisma/client";

// PrismaClient シングルトン（開発時のHMRで多重生成しない）
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** DATABASE_URL 未設定なら false（UIはモックにフォールバック） */
export const hasDatabase = Boolean(process.env.DATABASE_URL);
