import { actorOf, handle, readJson } from '@/lib/review/http';
import { generateExplanation, ReviewError } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await params;
    const body = await readJson(request);
    if (body.mode !== 'direct' && body.mode !== 'rag') throw new ReviewError('mode must be direct or rag', 400);
    return generateExplanation(actorOf(request), id, body.mode);
  });
}
