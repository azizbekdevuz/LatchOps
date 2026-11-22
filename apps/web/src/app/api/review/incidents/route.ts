import { actorOf, handle, readJson } from '@/lib/review/http';
import { createScenarioReview, importCliSnapshot, ReviewError } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  return handle(request, async () => {
    const actor = actorOf(request);
    const body = await readJson(request);
    if (typeof body.scenarioId === 'string') {
      return { id: await createScenarioReview(actor, body.scenarioId) };
    }
    if (body.snapshot && typeof body.snapshot === 'object') {
      return { id: await importCliSnapshot(actor, body.snapshot, typeof body.title === 'string' ? body.title : undefined) };
    }
    throw new ReviewError('Provide scenarioId or snapshot', 400);
  });
}
