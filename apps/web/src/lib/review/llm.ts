import { OUTPUT_JSON_SCHEMA, type BuiltPrompt } from './prompt';

export interface LlmResult {
  provider: string;
  model: string;
  raw: string;
  promptTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface LlmProvider {
  id: string;
  model: string;
  /** True when the endpoint is on this machine; recorded on the consent. */
  local: boolean;
  complete(prompt: BuiltPrompt): Promise<LlmResult>;
}

const DEFAULT_TIMEOUT_MS = 600_000;
/** Caps runaway generations; a valid explanation is far below this. */
const MAX_OUTPUT_TOKENS = 1200;

export function ollamaProvider(opts: { baseUrl?: string; model?: string; timeoutMs?: number } = {}): LlmProvider {
  const baseUrl = (opts.baseUrl ?? process.env.REVIEW_OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = opts.model ?? process.env.REVIEW_OLLAMA_MODEL ?? 'qwen2.5:3b';
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.REVIEW_OLLAMA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const host = new URL(baseUrl).hostname;
  return {
    id: 'ollama',
    model,
    local: host === '127.0.0.1' || host === 'localhost' || host === '::1',
    async complete(prompt) {
      const result = await ollamaChat({ baseUrl, model, timeoutMs, system: prompt.system, user: prompt.user, format: OUTPUT_JSON_SCHEMA });
      return { provider: 'ollama', model, ...result };
    },
  };
}

/** One deterministic (temperature 0, seed 7) chat call against a local Ollama runtime. */
export async function ollamaChat(input: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  format: unknown;
  timeoutMs?: number;
}): Promise<Pick<LlmResult, 'raw' | 'promptTokens' | 'outputTokens' | 'latencyMs'>> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        // Streaming keeps headers flowing; a blocking call on CPU can exceed undici's 300 s header timeout.
        stream: true,
        format: input.format,
        options: { temperature: 0, seed: 7, num_ctx: 8192, num_predict: MAX_OUTPUT_TOKENS },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const { content, final } = await readOllamaStream(response);
    return {
      raw: content,
      promptTokens: final?.prompt_eval_count ?? null,
      outputTokens: final?.eval_count ?? null,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

async function readOllamaStream(response: Response): Promise<{ content: string; final: OllamaChunk | null }> {
  if (!response.body) throw new Error('Ollama returned no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let final: OllamaChunk | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as OllamaChunk;
    if (chunk.error) throw new Error(`Ollama error: ${chunk.error.slice(0, 200)}`);
    content += chunk.message?.content ?? '';
    if (chunk.done) final = chunk;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      consume(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  consume(buffer + decoder.decode());
  return { content, final };
}

/**
 * Replays fixed model outputs. Used by tests and the offline demo; results are
 * always labelled provider "fixture" so they cannot be mistaken for a model run.
 */
export function fixtureProvider(respond: (prompt: BuiltPrompt) => string, model = 'fixture'): LlmProvider {
  return {
    id: 'fixture',
    model,
    local: true,
    async complete(prompt) {
      const started = Date.now();
      const raw = respond(prompt);
      return {
        provider: 'fixture',
        model,
        raw,
        promptTokens: estimateTokens(prompt.system + prompt.user),
        outputTokens: estimateTokens(raw),
        latencyMs: Date.now() - started,
      };
    },
  };
}

/** Rough chars/4 estimate, used only where the runtime reports no token count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function defaultProvider(): LlmProvider {
  return ollamaProvider();
}
