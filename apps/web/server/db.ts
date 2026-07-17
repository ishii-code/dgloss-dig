import { PrismaClient } from "@prisma/client";

// PrismaClient シングルトン（開発時のHMRで多重生成しない）
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** DB接続文字列が無ければ false（UIはモックにフォールバック） */
export const hasDatabase = Boolean(
  process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL,
);
