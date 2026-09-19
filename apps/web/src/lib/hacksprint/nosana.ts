import { z } from 'zod';
import { boundText } from './quote';
import { parseNosanaExplanation, scrub, type RedactedEvidence } from './redaction';
import type { NosanaExplanation, NosanaStatus } from './types';

const NOSANA_BASE = 'https://inference.nosana.com/v1';
const FETCH_MS = 60_000;

const ModelSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  owned_by: z.string().optional(),
  type: z.string().optional(),
  model_type: z.string().optional(),
});

const ModelsSchema = z.object({
  data: z.array(ModelSchema).min(1),
});

const ChatSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

export function nosanaKeyPresent(): boolean {
  return Boolean(process.env.NOSANA_API_KEY?.trim());
}

export interface NosanaResult {
  status: NosanaStatus;
  explanation: NosanaExplanation | null;
}

export interface NosanaModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
  type?: string;
  model_type?: string;
}

const NON_CHAT_RE = /embed|embedding|whisper|tts|dall-?e|image|moderation|audio|rerank|codec/;
const CHAT_HINT_RE = /chat|instruct|llama|qwen|mistral|gemma|phi|deepseek|gpt|claude|nemotron(?!-?3-embed)/i;

export function selectChatModel(models: NosanaModelInfo[]): string {
  const ranked = models
    .map((model) => ({ id: model.id, score: chatCapabilityScore(model) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (ranked[0]) return ranked[0].id;
  if (!models[0]?.id) throw new Error('Nosana /models returned no usable model id');
  return models[0].id;
}

function chatCapabilityScore(model: NosanaModelInfo): number {
  const id = model.id.toLowerCase();
  const kind = `${model.object ?? ''} ${model.type ?? ''} ${model.model_type ?? ''}`.toLowerCase();
  if (NON_CHAT_RE.test(id) || NON_CHAT_RE.test(kind)) return -1;
  if (kind.includes('chat')) return 3;
  if (CHAT_HINT_RE.test(model.id)) return 2;
  return 1;
}

function sanitizeNosanaText(value: string, max = 200): string {
  return boundText(scrub(value).replace(/nos_[A-Za-z0-9_-]+/g, '[redacted]'), max);
}

export function formatNosanaHttpError(status: number, rawBody: string, source = 'chat/completions'): string {
  const body = sanitizeNosanaText(rawBody, 400);
  let code: string | null = null;
  let param: string | null = null;
  let message = body;

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const err =
      parsed.error && typeof parsed.error === 'object'
        ? (parsed.error as Record<string, unknown>)
        : parsed;
    if (typeof err.code === 'string') code = err.code;
    else if (typeof err.type === 'string') code = err.type;
    if (typeof err.param === 'string') param = err.param;
    if (typeof err.message === 'string') message = sanitizeNosanaText(err.message);
    else if (typeof parsed.detail === 'string') message = sanitizeNosanaText(parsed.detail);
  } catch {
    /* keep clipped body */
  }

  const kind = classifyNosanaFailure(status, code, param, message);
  const parts = [`Nosana ${source} HTTP ${status}`, kind];
  if (code) parts.push(`code=${code}`);
  if (param) parts.push(`param=${param}`);
  if (message) parts.push(message);
  return parts.join(' · ');
}

export function classifyNosanaFailure(
  status: number,
  code: string | null,
  param: string | null,
  message: string,
): string {
  const hay = `${code ?? ''} ${param ?? ''} ${message}`.toLowerCase();
  if (
    /credit|balance|quota|billing|payment|insufficient/.test(hay) ||
    status === 402 ||
    status === 429
  ) {
    return 'insufficient credits';
  }
  if (/model|not found|unknown model|does not exist/.test(hay) || status === 404) {
    return 'invalid model';
  }
  if (/param|unsupported|unknown field|temperature|max_tokens|response_format/.test(hay)) {
    return 'unsupported request parameter';
  }
  return 'request rejected';
}

export async function explainWithNosana(evidence: RedactedEvidence): Promise<NosanaResult> {
  const apiKey = process.env.NOSANA_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: {
        status: 'missing',
        model: null,
        message: 'NOSANA_API_KEY is not set',
      },
      explanation: null,
    };
  }

  let model: string | null = null;
  try {
    model = await discoverModel(apiKey);
    const explanation = await requestExplanation(apiKey, model, evidence);
    if (!explanation) {
      return {
        status: {
          status: 'unavailable',
          model,
          message: 'Nosana unavailable — response was not a valid explanation',
        },
        explanation: null,
      };
    }
    return {
      status: {
        status: 'live',
        model,
        message: `Nosana explained evidence with ${model}`,
      },
      explanation,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Nosana request timed out after ${FETCH_MS}ms`
        : error instanceof Error
          ? error.message
          : 'Nosana unavailable';
    console.error('[hacksprint/nosana]', message);
    return {
      status: {
        status: 'unavailable',
        model,
        message,
      },
      explanation: null,
    };
  }
}

async function discoverModel(apiKey: string): Promise<string> {
  const response = await fetchWithTimeout(`${NOSANA_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    const body = await readBoundedBody(response);
    throw new Error(formatNosanaHttpError(response.status, body, '/models'));
  }
  const parsed = ModelsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Nosana /models returned no usable model id');
  }
  return selectChatModel(parsed.data.data);
}

async function requestExplanation(
  apiKey: string,
  model: string,
  evidence: RedactedEvidence,
): Promise<NosanaExplanation | null> {
  const response = await fetchWithTimeout(`${NOSANA_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You explain LatchOps recovery evidence. You do not decide VERIFIED or FAILED, invent git commands, or classify git state. Return JSON only with keys: whatWasBroken, whatWasAttempted, checksPassed, checksFailed, whyItMatters.',
        },
        {
          role: 'user',
          content: JSON.stringify(evidence),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await readBoundedBody(response);
    throw new Error(formatNosanaHttpError(response.status, body));
  }

  const parsed = ChatSchema.safeParse(await response.json());
  if (!parsed.success) return null;
  const content = parsed.data.choices[0].message.content.trim();
  const json = extractJson(content);
  return parseNosanaExplanation(json);
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  try {
    return boundText(await response.text(), 800);
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
