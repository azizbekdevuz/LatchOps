import { actorOf, handle, readJson } from '@/lib/review/http';
import { defaultProvider } from '@/lib/review/llm';
import { grantConsent, revokeConsent, ReviewError } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await params;
    const body = await readJson(request);
    if (body.action === 'grant') {
      await grantConsent(actorOf(request), id, defaultProvider().id);
      return { ok: true };
    }
    if (body.action === 'revoke') {
      await revokeConsent(actorOf(request), id);
      return { ok: true };
    }
    throw new ReviewError('action must be grant or revoke', 400);
  });
}
