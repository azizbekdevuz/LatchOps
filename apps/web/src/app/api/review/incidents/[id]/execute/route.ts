import { actorOf, handle } from '@/lib/review/http';
import { executeReview } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await params;
    const result = await executeReview(actorOf(request), id);
    return { id: result.id, authorized: result.authorized, verdict: result.verdict, reasons: result.reasons };
  });
}
