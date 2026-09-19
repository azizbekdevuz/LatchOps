import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainWithNosana, formatNosanaHttpError, selectChatModel } from './nosana';
import type { RedactedEvidence } from './redaction';

const evidence: RedactedEvidence = {
  incidentType: 'merge_conflict',
  summary: 'Merge in progress',
  risk: 'medium',
  selectedAlternativeId: 'complete_merge',
  beforeState: 'merge_conflict',
  afterState: 'clean',
  verificationStatus: 'succeeded',
  verificationReasons: ['MERGE_HEAD removed'],
  remainingIssues: [],
  changedSignals: [],
  conflict: { path: 'deploy.env', ours: '3000', theirs: '8080' },
  executed: [],
  isolation: 'local',
};

afterEach(() => {
  delete process.env.NOSANA_API_KEY;
  vi.unstubAllGlobals();
});

describe('explainWithNosana', () => {
  it('returns missing when the key is absent', async () => {
    delete process.env.NOSANA_API_KEY;
    const result = await explainWithNosana(evidence);
    expect(result.status.status).toBe('missing');
    expect(result.explanation).toBeNull();
  });

  it('discovers a chat-capable model and parses a structured explanation', async () => {
    process.env.NOSANA_API_KEY = 'test-nosana';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/models')) {
          return new Response(
            JSON.stringify({
              data: [{ id: 'nvidia/nemotron-3-embed-1b' }, { id: 'qwen/qwen3.8-27b' }],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    whatWasBroken: 'conflict on deploy.env',
                    whatWasAttempted: 'complete merge',
                    checksPassed: ['no MERGE_HEAD'],
                    checksFailed: [],
                    whyItMatters: 'safe to continue',
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await explainWithNosana(evidence);
    expect(result.status.status).toBe('live');
    expect(result.status.model).toBe('qwen/qwen3.8-27b');
    expect(result.explanation?.whatWasBroken).toContain('deploy.env');
  });

  it('surfaces a sanitized 400 without leaking secrets', async () => {
    process.env.NOSANA_API_KEY = 'test-nosana';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            error: {
              message: 'Unsupported value: temperature Authorization: Bearer nos_secretkey',
              code: 'unsupported_parameter',
              param: 'temperature',
            },
          }),
          { status: 400 },
        );
      }),
    );
    const result = await explainWithNosana(evidence);
    expect(result.status.status).toBe('unavailable');
    expect(result.status.model).toBe('qwen/qwen3.8-27b');
    expect(result.status.message).toContain('HTTP 400');
    expect(result.status.message).toContain('unsupported request parameter');
    expect(result.status.message).toContain('param=temperature');
    expect(result.status.message).not.toMatch(/nos_secretkey|Bearer nos_/);
  });

  it('is unavailable when /models fails', async () => {
    process.env.NOSANA_API_KEY = 'test-nosana';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
    const result = await explainWithNosana(evidence);
    expect(result.status.status).toBe('unavailable');
    expect(result.explanation).toBeNull();
  });
});

describe('selectChatModel', () => {
  it('skips embedding models and prefers a chat-capable id', () => {
    expect(
      selectChatModel([
        { id: 'nvidia/nemotron-3-embed-1b' },
        { id: 'qwen/qwen3.8-27b' },
      ]),
    ).toBe('qwen/qwen3.8-27b');
  });
});

describe('formatNosanaHttpError', () => {
  it('classifies credits, model, and parameter failures', () => {
    expect(
      formatNosanaHttpError(402, JSON.stringify({ error: { message: 'insufficient credits', code: 'billing' } })),
    ).toContain('insufficient credits');
    expect(formatNosanaHttpError(404, JSON.stringify({ detail: 'Not Found' }))).toContain('invalid model');
    expect(
      formatNosanaHttpError(
        400,
        JSON.stringify({ error: { message: 'bad field', code: 'unsupported_parameter', param: 'max_tokens' } }),
      ),
    ).toMatch(/unsupported request parameter[\s\S]*param=max_tokens/);
  });
});

