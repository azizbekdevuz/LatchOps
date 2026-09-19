import type { PrismaClient } from '@prisma/client';
import { backfillOwnedSession, FailFastError } from './backfill-incidents.js';
import {
  acquireBackfillLock,
  applySwitchConstraints,
  loadCheckpoint,
  releaseBackfillLock,
  saveCheckpoint,
} from './checkpoint.js';
import { formatReconcileReport, ownedDeltasZero, reconcile } from './reconcile.js';
import {
  BATCH_SIZE,
  emptyStats,
  type BackfillCliOptions,
  type BackfillStats,
} from './types.js';

class DryRunRollback extends Error {
  constructor() {
    super('dry-run rollback');
    this.name = 'DryRunRollback';
  }
}

export async function runPhase4Migration(db: PrismaClient, options: BackfillCliOptions): Promise<{
  stats: BackfillStats;
  exitCode: number;
}> {
  await acquireBackfillLock(db);
  try {
    if (options.reconcileOnly) {
      const counts = await reconcile(db);
      console.log(formatReconcileReport({ counts }));
      return { stats: emptyStats(), exitCode: ownedDeltasZero(counts) ? 0 : 1 };
    }

    const stats = emptyStats();
    stats.skippedAnonymous = await db.gitSession.count({ where: { userId: null } });

    if (options.gitSessionId) {
      await processOne(db, options.gitSessionId, options, stats);
    } else {
      await processBatches(db, options, stats);
    }

    if (options.apply) {
      await saveCheckpoint(db, {
        lastProcessedGitSessionId: undefined,
        mode: 'apply',
        stats,
      });
    }

    const counts = await reconcile(db);
    console.log(formatReconcileReport({ stats, counts }));

    if (options.apply && ownedDeltasZero(counts)) {
      await applySwitchConstraints(db);
      console.log('Applied Snapshot parent CHECK and composite snapshot FKs.');
    }

    const exitCode = options.apply && !ownedDeltasZero(counts) ? 1 : 0;
    return { stats, exitCode };
  } finally {
    await releaseBackfillLock(db);
  }
}

async function processBatches(db: PrismaClient, options: BackfillCliOptions, stats: BackfillStats) {
  const checkpoint = options.resume ? await loadCheckpoint(db) : null;
  let cursor = options.resume ? checkpoint?.lastProcessedGitSessionId ?? undefined : undefined;
  let remaining = options.limit;

  for (;;) {
    const take = Math.min(BATCH_SIZE, remaining ?? BATCH_SIZE);
    const sessions = await db.gitSession.findMany({
      where: {
        userId: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    });
    if (sessions.length === 0) break;

    for (const session of sessions) {
      await processOne(db, session.id, options, stats);
      cursor = session.id;
      if (options.apply) {
        await saveCheckpoint(db, {
          lastProcessedGitSessionId: session.id,
          mode: 'apply',
          stats,
        });
      }
      if (remaining !== undefined) {
        remaining -= 1;
        if (remaining <= 0) return;
      }
    }
  }
}

async function processOne(
  db: PrismaClient,
  gitSessionId: string,
  options: BackfillCliOptions,
  stats: BackfillStats,
) {
  const persistErrors = options.apply;
  try {
    if (options.dryRun) {
      try {
        await db.$transaction(async (tx) => {
          await backfillOwnedSession(tx, {
            gitSessionId,
            forceRepair: options.forceRepair,
            failFast: options.failFast,
            persistErrors: false,
            stats,
          });
          throw new DryRunRollback();
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'DryRunRollback' || (error instanceof DryRunRollback)) return;
        throw error;
      }
      return;
    }

    await db.$transaction(async (tx) => {
      await backfillOwnedSession(tx, {
        gitSessionId,
        forceRepair: options.forceRepair,
        failFast: options.failFast,
        persistErrors,
        stats,
      });
    });
  } catch (error) {
    if (error instanceof FailFastError) throw error;
    stats.errors += 1;
    if (options.verbose) {
      console.error(`backfill failed for GitSession ${gitSessionId}:`, error);
    }
    if (options.failFast) throw error;
  }
}

export function parseArgs(argv: string[]): BackfillCliOptions {
  const args = new Set(argv);
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const apply = args.has('--apply');
  const reconcileOnly = args.has('--reconcile') && !apply && !args.has('--dry-run');
  return {
    dryRun: !apply,
    apply,
    reconcile: args.has('--reconcile') || apply || !reconcileOnly,
    reconcileOnly,
    resume: args.has('--resume'),
    failFast: args.has('--fail-fast'),
    forceRepair: args.has('--force-repair'),
    applySwitchConstraints: args.has('--apply-switch-constraints'),
    verbose: args.has('--verbose'),
    limit: get('--limit') ? Number(get('--limit')) : undefined,
    gitSessionId: get('--git-session-id'),
  };
}

export function assertApplyConfirmed(apply: boolean): void {
  if (!apply) return;
  if (process.env.CONFIRM_PHASE4_BACKFILL !== 'yes') {
    throw new Error('Refusing --apply without CONFIRM_PHASE4_BACKFILL=yes');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertApplyConfirmed(options.apply);
  const { default: prisma } = await import('../../src/lib/prisma');
  const result = await runPhase4Migration(prisma, options);
  await prisma.$disconnect();
  process.exit(result.exitCode);
}

const invoked = process.argv[1]?.includes('migrate-phase4');
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
