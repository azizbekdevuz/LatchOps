import { actorOf, handle, readJson } from '@/lib/review/http';
import { recordDecision } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await params;
    const body = await readJson(request);
    return {
      id: await recordDecision(actorOf(request), id, {
        decision: body.decision,
        alternativeId: body.alternativeId,
        reason: body.reason,
        explanationId: body.explanationId,
      }),
    };
  });
}
