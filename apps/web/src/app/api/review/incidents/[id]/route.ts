import { actorOf, handle } from '@/lib/review/http';
import { getReview, ReviewError } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    if (!actorOf(request)) throw new ReviewError('A valid actor token is required', 401);
    const { id } = await params;
    return getReview(id);
  });
}
