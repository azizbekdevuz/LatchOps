import type { DbClient } from './types.js';

export async function linkSnapshotsToIncident(
  tx: DbClient,
  gitSessionId: string,
  incidentId: string,
): Promise<number> {
  const result = await tx.snapshot.updateMany({
    where: { gitSessionId, incidentId: null },
    data: { incidentId },
  });
  await tx.snapshot.updateMany({
    where: { gitSessionId, incidentId: { not: incidentId } },
    data: { incidentId },
  });
  return result.count;
}
