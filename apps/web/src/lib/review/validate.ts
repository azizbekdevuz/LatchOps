import type { RecoveryPlanV1, RepoSignalsV1 } from '@latchops/schema';
import type { BuiltPrompt } from './prompt';
import {
  ExplanationOutputSchema,
  type ClaimCheck,
  type EvidenceItem,
  type ExplanationClaim,
  type ExplanationOutput,
  type KnowledgeChunk,
  type ValidationReport,
} from './types';

export interface ValidationContext {
  prompt: Pick<BuiltPrompt, 'contextIds'>;
  items: EvidenceItem[];
  knowledge: KnowledgeChunk[];
  plan: RecoveryPlanV1;
  signals: RepoSignalsV1;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const PATH_RE =
  /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]*[A-Za-z0-9_-]|\b[A-Za-z0-9_-]+\.(?:env|ya?ml|json|tsx?|jsx?|md|txt|toml|ini|cfg|conf|py|go|java|sql|lock|properties|xml|sh)\b/g;
const OID_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
const ASSIGN_RE = /\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s,;)'"`]+/g;
const SNAKE_KEY_RE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;
const COUNT_RE = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:conflicted|unmerged|conflicting)\s+(?:files?|paths?)\b/gi;
const BIG_NUMBER_RE = /(?<![\w./=-])\d{2,}(?![\w./-])/g;
const ALT_RE = /\b[a-z]+_merge\b/g;

const WORD_PAIRS = new Set(['and/or', 'ours/theirs', 'theirs/ours', 'either/or', 'yes/no', 'true/false', 'input/output', 'read/write']);

const GIT_CMD_RE = /\bgit\s+[a-z][a-z-]*/gi;
const DANGER_GIT_RE = /\bgit\s+(?:push|clean|filter-branch|update-ref|gc|prune)\b|\bgit\s+reset\s+--hard\b|\bgit\s+branch\s+-D\b/i;
const IMPERATIVE_BEFORE_RE = /(?:\brun|\bexecute|\buse|\btype|\btry|\benter|\bissue|`)\s*:?\s*$/i;
const SHELL_RE = /(\brm\s+-rf\b|\bsudo\s|\bcurl\s|\bwget\s|\|\s*(?:ba)?sh\b|--force\b)/i;
const VERDICT_RE = /\b(?:is|was|has been|been|now|already) (?:verified|approved)\b|\b(?:is )?safe to (?:push|merge|deploy|proceed)\b|\bready to (?:push|deploy)\b/gi;
const VERDICT_CAPS_RE = /\bVERIFIED\b/g;
const NO_REVIEW_RE = /\bno (?:human )?(?:review|approval|decision) (?:is )?(?:needed|required)\b/i;
const NEGATION_RE = /\b(not|no|never|cannot|can't|isn't|until|before|without|whether|if|yet to)\b[^.]*$/i;

function normalizeAssign(value: string): string {
  return value.replace(/\s*=\s*/, '=').replace(/[.:!?]+$/, '').toLowerCase();
}

export function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.match(PATH_RE) ?? []) {
    if (/^https?:/i.test(m) || m.includes('://') || WORD_PAIRS.has(m.toLowerCase())) continue;
    found.add(m.replace(/[.]+$/, ''));
  }
  for (const m of text.match(OID_RE) ?? []) found.add(m);
  for (const m of text.match(ASSIGN_RE) ?? []) found.add(normalizeAssign(m));
  for (const m of text.match(SNAKE_KEY_RE) ?? []) found.add(m);
  for (const m of text.match(BIG_NUMBER_RE) ?? []) found.add(m);
  return [...found];
}

function corpusOf(ids: string[], ctx: ValidationContext): string {
  const parts: string[] = [];
  for (const id of ids) {
    const item = ctx.items.find((e) => e.id === id);
    if (item) parts.push(item.label, item.text);
    const chunk = ctx.knowledge.find((k) => k.id === id);
    if (chunk) parts.push(chunk.title, chunk.text);
  }
  const joined = parts.join('\n');
  return `${joined}\n${joined.replace(/\s*=\s*/g, '=')}`.toLowerCase();
}

function checkClaim(claim: ExplanationClaim, ctx: ValidationContext): ClaimCheck {
  const reasons: string[] = [];
  const allowed = new Set(ctx.prompt.contextIds);
  const invalidCitations = claim.citations.filter((id) => !allowed.has(id));
  const validCitations = claim.citations.filter((id) => allowed.has(id));
  const evidenceCitations = validCitations.filter((id) => id.startsWith('E'));

  if (claim.citations.length === 0) reasons.push('no citations');
  if (invalidCitations.length > 0) reasons.push(`cites IDs not in the provided context: ${invalidCitations.join(', ')}`);
  if ((claim.key || claim.type === 'state') && evidenceCitations.length === 0) {
    reasons.push('repository claim cites no repository evidence (E#)');
  }

  const corpus = corpusOf(validCitations, ctx);
  const missingEntities = extractEntities(claim.text).filter((entity) => !corpus.includes(entity.toLowerCase()));
  if (missingEntities.length > 0) reasons.push(`not found in cited items: ${missingEntities.join(', ')}`);

  for (const m of claim.text.matchAll(COUNT_RE)) {
    const raw = m[1].toLowerCase();
    const n = NUMBER_WORDS[raw] ?? Number(raw);
    if (n !== ctx.signals.worktree.conflicted) {
      reasons.push(`states ${n} conflicted path(s); evidence says ${ctx.signals.worktree.conflicted}`);
    }
  }

  const altIds = new Set(ctx.plan.alternatives.map((alt) => alt.id));
  for (const m of claim.text.match(ALT_RE) ?? []) {
    if (!altIds.has(m)) reasons.push(`unknown alternative ${m}`);
  }

  return {
    claimId: claim.id,
    key: claim.key,
    support: reasons.length === 0 ? 'supported' : 'unsupported',
    reasons,
    missingEntities,
    invalidCitations,
  };
}

/** Policy violations anywhere in the output. Any hit rejects the explanation. */
export function findForbidden(output: ExplanationOutput, plan: RecoveryPlanV1): string[] {
  return findForbiddenInTexts(
    [output.summary, output.humanDecisionNeeded, ...output.uncertainties, ...output.claims.map((claim) => claim.text)],
    plan,
  );
}

export function findForbiddenInTexts(texts: string[], plan: RecoveryPlanV1): string[] {
  const displays = [
    ...plan.steps.flatMap((step) => step.commands.map((cmd) => cmd.display)),
    ...plan.alternatives.flatMap((alt) => alt.steps.flatMap((step) => step.commands.map((cmd) => cmd.display))),
  ];
  const problems = new Set<string>();
  for (const text of texts) {
    const danger = text.match(DANGER_GIT_RE);
    if (danger) problems.add(`dangerous git command: "${danger[0]}"`);
    for (const m of text.matchAll(GIT_CMD_RE)) {
      const at = m.index ?? 0;
      const rest = text.slice(at);
      const commandLike = IMPERATIVE_BEFORE_RE.test(text.slice(Math.max(0, at - 12), at)) || /^git\s+[a-z-]+\s+-/i.test(rest);
      if (commandLike && !displays.some((display) => rest.startsWith(display))) {
        problems.add(`command not in deterministic plan: "${rest.slice(0, 40)}"`);
      }
    }
    const shell = text.match(SHELL_RE);
    if (shell) problems.add(`dangerous shell/force content: "${shell[0]}"`);
    for (const m of [...text.matchAll(VERDICT_RE), ...text.matchAll(VERDICT_CAPS_RE)]) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      if (!NEGATION_RE.test(before)) problems.add(`asserts an outcome or approval: "${m[0]}"`);
    }
    if (NO_REVIEW_RE.test(text)) problems.add('claims human review is unnecessary');
  }
  return [...problems];
}

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  return JSON.parse(body);
}

export function emptyReport(reason: string): ValidationReport {
  return {
    status: 'rejected',
    schemaValid: false,
    schemaErrors: [reason],
    forbidden: [],
    claimChecks: [],
    keyClaims: 0,
    unsupportedKeyClaims: 0,
    totalClaims: 0,
    unsupportedClaims: 0,
    warnings: [],
    rejectionReasons: [reason],
  };
}

/**
 * Fail-closed: the explanation is accepted only when it parses, breaks no
 * policy, and every key claim is supported by the items it cites.
 */
export function validateExplanation(
  raw: string,
  ctx: ValidationContext,
): { report: ValidationReport; output: ExplanationOutput | null } {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    return { report: emptyReport('model output is not valid JSON'), output: null };
  }
  const normalizations = normalizeScalars(parsed);
  const result = ExplanationOutputSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return {
      report: { ...emptyReport('output does not match the explanation schema'), schemaErrors: errors, normalizations },
      output: null,
    };
  }

  const output = result.data;
  const forbidden = findForbidden(output, ctx.plan);
  const warnings: string[] = [];
  const rejectionReasons: string[] = [];

  const altIds = ctx.plan.alternatives.map((alt) => alt.id);
  if (output.recommendedAlternativeId !== null && !altIds.includes(output.recommendedAlternativeId)) {
    forbidden.push(`recommendedAlternativeId "${output.recommendedAlternativeId}" is not a plan alternative`);
  }
  const engineChoice = ctx.plan.alternatives.find((alt) => alt.recommended)?.id ?? null;
  if (output.recommendedAlternativeId && engineChoice && output.recommendedAlternativeId !== engineChoice) {
    warnings.push(`model leans to ${output.recommendedAlternativeId}; deterministic engine recommends ${engineChoice}`);
  }

  const claimChecks = output.claims.map((claim) => checkClaim(claim, ctx));
  const keyClaims = claimChecks.filter((c) => c.key).length;
  const unsupportedKeyClaims = claimChecks.filter((c) => c.key && c.support === 'unsupported').length;
  const unsupportedClaims = claimChecks.filter((c) => c.support === 'unsupported').length;

  if (forbidden.length > 0) rejectionReasons.push(`policy violations: ${forbidden.length}`);
  if (keyClaims === 0) rejectionReasons.push('no key claims marked');
  if (unsupportedKeyClaims > 0) rejectionReasons.push(`${unsupportedKeyClaims} key claim(s) not supported by cited evidence`);
  if (unsupportedClaims > unsupportedKeyClaims) {
    warnings.push(`${unsupportedClaims - unsupportedKeyClaims} non-key claim(s) hidden as unsupported`);
  }

  return {
    report: {
      status: rejectionReasons.length === 0 ? 'accepted' : 'rejected',
      schemaValid: true,
      schemaErrors: [],
      forbidden,
      claimChecks,
      keyClaims,
      unsupportedKeyClaims,
      totalClaims: claimChecks.length,
      unsupportedClaims,
      warnings,
      rejectionReasons,
      normalizations,
    },
    output,
  };
}

const BOOL_STRINGS: Record<string, boolean> = { true: true, false: false };

/**
 * Small local models often emit `"true"` / `"null"` as strings even under a JSON
 * schema. Only these exact scalar spellings in typed fields are converted, in place;
 * every conversion is reported so it stays visible in the audit trail.
 */
export function normalizeScalars(parsed: unknown): string[] {
  const notes: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return notes;
  const root = parsed as Record<string, unknown>;
  const toBool = (obj: Record<string, unknown>, key: string, path: string) => {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().toLowerCase() in BOOL_STRINGS) {
      obj[key] = BOOL_STRINGS[value.trim().toLowerCase()];
      notes.push(`${path}: "${value}" -> ${obj[key]}`);
    }
  };
  const rec = root.recommendedAlternativeId;
  if (typeof rec === 'string' && ['null', 'none', ''].includes(rec.trim().toLowerCase())) {
    root.recommendedAlternativeId = null;
    notes.push(`recommendedAlternativeId: "${rec}" -> null`);
  }
  if (Array.isArray(root.claims)) {
    root.claims.forEach((claim, index) => {
      if (claim && typeof claim === 'object') toBool(claim as Record<string, unknown>, 'key', `claims.${index}.key`);
    });
  }
  return notes;
}
