import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/review-client';

function defaultUrl(): string {
  const dir = join(process.cwd(), '.review-data');
  mkdirSync(dir, { recursive: true });
  return `file:${join(dir, 'review.db').replace(/\\/g, '/')}`;
}

const globalForReview = globalThis as unknown as {
  reviewDb?: PrismaClient;
  reviewDbReady?: Promise<void>;
};

function migrationSql(): string {
  const path = join(process.cwd(), 'prisma', 'review-migrations', '0001_init.sql');
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

async function ensureSchema(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ReviewIncident'",
  );
  if (rows.length > 0) return;
  const statements = migrationSql()
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const statement of statements) await db.$executeRawUnsafe(statement);
}

/** Local SQLite client. Creates tables on first use so setup is one command. */
export async function reviewDb(): Promise<PrismaClient> {
  if (!process.env.REVIEW_DATABASE_URL) process.env.REVIEW_DATABASE_URL = defaultUrl();
  if (!globalForReview.reviewDb) {
    globalForReview.reviewDb = new PrismaClient({ datasourceUrl: process.env.REVIEW_DATABASE_URL });
  }
  const db = globalForReview.reviewDb;
  if (!globalForReview.reviewDbReady) {
    globalForReview.reviewDbReady = ensureSchema(db).catch((error) => {
      globalForReview.reviewDbReady = undefined;
      throw error;
    });
  }
  await globalForReview.reviewDbReady;
  return db;
}

/** Test helper: point at a different database file. */
export async function resetReviewDbForTests(url: string): Promise<PrismaClient> {
  if (globalForReview.reviewDb) await globalForReview.reviewDb.$disconnect();
  globalForReview.reviewDb = undefined;
  globalForReview.reviewDbReady = undefined;
  process.env.REVIEW_DATABASE_URL = url;
  return reviewDb();
}
