import { publicActors, usingDemoActors } from '@/lib/review/actors';
import { handle } from '@/lib/review/http';
import { ollamaProvider } from '@/lib/review/llm';
import { REVIEW_SCENARIOS } from '@/lib/review/scenarios';
import { listReviews } from '@/lib/review/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function modelStatus(baseUrl: string, model: string): Promise<{ reachable: boolean; modelPresent: boolean }> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { reachable: false, modelPresent: false };
    const json = (await response.json()) as { models?: Array<{ name: string }> };
    return { reachable: true, modelPresent: (json.models ?? []).some((m) => m.name === model) };
  } catch {
    return { reachable: false, modelPresent: false };
  }
}

export async function GET(request: Request) {
  return handle(request, async () => {
    const provider = ollamaProvider();
    const baseUrl = (process.env.REVIEW_OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    const reviews = await listReviews();
    return {
      actors: publicActors(),
      demoActors: usingDemoActors(),
      provider: { id: provider.id, model: provider.model, local: provider.local, ...(await modelStatus(baseUrl, provider.model)) },
      scenarios: REVIEW_SCENARIOS.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        category: s.category,
        selectedAlternativeId: s.selectedAlternativeId,
        expectedVerdict: s.expected.verdict,
      })),
      reviews: reviews.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        source: r.source,
        requestedBy: r.requestedBy,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
