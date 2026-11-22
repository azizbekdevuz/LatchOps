/**
 * Secret / PII redaction for evidence that may leave the deterministic core.
 * Originals are never stored: only the finding type and count are kept.
 */

interface Rule {
  type: string;
  pattern: RegExp;
  /** Replacement; `$1` keeps a non-secret prefix such as the key name. */
  replace: string;
}

// Order matters: specific token formats first, generic assignments last.
const RULES: Rule[] = [
  {
    type: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: '[REDACTED:private_key]',
  },
  { type: 'aws_access_key_id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: '[REDACTED:aws_access_key_id]' },
  { type: 'github_token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g, replace: '[REDACTED:github_token]' },
  { type: 'slack_token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: '[REDACTED:slack_token]' },
  { type: 'openai_style_key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, replace: '[REDACTED:api_key]' },
  { type: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: '[REDACTED:google_api_key]' },
  { type: 'nosana_key', pattern: /\bnos_[A-Za-z0-9_-]{12,}\b/g, replace: '[REDACTED:api_key]' },
  {
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: '[REDACTED:jwt]',
  },
  {
    type: 'url_credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s/@]+@/gi,
    replace: '$1[REDACTED:credentials]@',
  },
  {
    type: 'bearer_token',
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/g,
    replace: '$1[REDACTED:token]',
  },
  {
    type: 'secret_assignment',
    pattern:
      /\b((?:[A-Za-z0-9_]*?)(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential)s?[A-Za-z0-9_]*\s*[=:]\s*["']?)(?!\[REDACTED)[^\s"',;]{4,}/gi,
    replace: '$1[REDACTED:secret]',
  },
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: '[email]' },
  {
    type: 'home_path',
    pattern: /(?:[A-Za-z]:\\Users\\|\/(?:Users|home)\/)[^\s\\/]+/g,
    replace: '[home]',
  },
];

export interface RedactResult {
  text: string;
  counts: Record<string, number>;
}

export function redactText(input: string): RedactResult {
  let text = input;
  const counts: Record<string, number> = {};
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      counts[rule.type] = (counts[rule.type] ?? 0) + 1;
      const groups = args.slice(1, -2) as Array<string | undefined>;
      return rule.replace.replace(/\$(\d)/g, (_, n: string) => groups[Number(n) - 1] ?? '');
    });
  }
  return { text, counts };
}

/**
 * Returns the secret types still detectable in `text`. Emails and home paths
 * are PII hygiene, not secrets, so they never block a model call.
 */
export function detectSecrets(text: string): string[] {
  const found = new Set<string>();
  for (const rule of RULES) {
    if (rule.type === 'email' || rule.type === 'home_path') continue;
    const matches = text.match(rule.pattern) ?? [];
    for (const match of matches) {
      if (!match.includes('[REDACTED')) found.add(rule.type);
    }
  }
  return [...found];
}
