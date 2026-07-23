/**
 * Prisma client singleton — platform DB (PostgreSQL).
 * Lazy init so `import './db'` never constructs a client before
 * `prisma generate` engines exist (Cloud Run boot).
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'error', 'warn'] : ['error'],
  });
}

/** Lazily constructed — first property access runs `prisma generate` engines. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!globalForPrisma.prisma) {
      try {
        globalForPrisma.prisma = createClient();
      } catch (err: any) {
        const msg = err?.message || String(err);
        throw new Error(
          `[db] PrismaClient init failed: ${msg}. Image must run \`prisma generate\` (see Dockerfile).`
        );
      }
    }
    const value = Reflect.get(globalForPrisma.prisma as object, prop, receiver);
    return typeof value === 'function' ? value.bind(globalForPrisma.prisma) : value;
  },
});

export async function connectDb(): Promise<void> {
  await prisma.$connect();
  console.log('[db] PostgreSQL connected');
}

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
  }
}
