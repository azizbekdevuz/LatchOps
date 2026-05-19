import { z } from 'zod';
import { SnapshotV1Schema, type SnapshotV1 } from './snapshot.js';
import { PlanV1Schema, type PlanV1, VerificationResultSchema, type VerificationResult } from './plan.js';
import { SignalsSchema, type Signals } from './signals.js';

// ==========================================
// Session API Types
// ==========================================

// POST /api/sessions - Create new session
export const CreateSessionRequestSchema = z.object({
  snapshot: SnapshotV1Schema,
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
});

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

// GET /api/sessions/[id] - Get session details
export const TraceOutputSchema = z.object({
  stage: z.string(),
  output: z.unknown(),
  createdAt: z.string(),
  durationMs: z.number().nullable(),
});

export type TraceOutput = z.infer<typeof TraceOutputSchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const GetSessionResponseSchema = z.object({
  session: SessionSummarySchema,
  snapshot: SnapshotV1Schema,
  signals: SignalsSchema.nullable(),
  plan: PlanV1Schema.nullable(),
  traces: z.array(TraceOutputSchema),
});

export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

// ==========================================
// Plan API Types
// ==========================================

// POST /api/sessions/[id]/plan - Generate plan
export const GeneratePlanRequestSchema = z.object({
  dangerousAllowed: z.boolean().optional().default(false),
});

export type GeneratePlanRequest = z.infer<typeof GeneratePlanRequestSchema>;

export const GeneratePlanResponseSchema = z.object({
  plan: PlanV1Schema,
});

export type GeneratePlanResponse = z.infer<typeof GeneratePlanResponseSchema>;

// ==========================================
// Verify API Types
// ==========================================

// POST /api/sessions/[id]/verify - Verify progress
export const VerifyProgressRequestSchema = z.object({
  snapshot: SnapshotV1Schema,
});

export type VerifyProgressRequest = z.infer<typeof VerifyProgressRequestSchema>;

export const VerifyProgressResponseSchema = VerificationResultSchema;

export type VerifyProgressResponse = VerificationResult;

// ==========================================
// Explain API Types
// ==========================================

// POST /api/sessions/[id]/explain - Get AI explanation
export const ExplainConflictRequestSchema = z.object({
  type: z.literal('conflict'),
  fileIndex: z.number(),
  blockIndex: z.number(),
});

export const ExplainStateRequestSchema = z.object({
  type: z.literal('state'),
});

export const ExplainRequestSchema = z.discriminatedUnion('type', [
  ExplainConflictRequestSchema,
  ExplainStateRequestSchema,
]);

export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

// Conflict explanation response
export const ConflictExplanationSchema = z.object({
  summary: z.string(),
  oursInterpretation: z.string(),
  theirsInterpretation: z.string(),
  suggestedResolution: z.string(),
  riskNotes: z.string().optional(),
});

export type ConflictExplanation = z.infer<typeof ConflictExplanationSchema>;

// State explanation response
export const StateExplanationSchema = z.object({
  summary: z.string(),
  howItHappened: z.string(),
  currentPosition: z.string(),
  safeNextSteps: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});

export type StateExplanation = z.infer<typeof StateExplanationSchema>;

export const ExplainResponseSchema = z.object({
  explanation: z.union([ConflictExplanationSchema, StateExplanationSchema]),
});

export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

// ==========================================
// Auth API Types
// ==========================================

// POST /api/auth/register - Register new user
export const RegisterRequestSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
  }),
});

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

// ==========================================
// Error Response
// ==========================================

export const ApiErrorSchema = z.object({
  error: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// ==========================================
// History Types (for session list page)
// ==========================================

export const SessionListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
  os: z.string().nullable(),
  hasPlan: z.boolean(),
  issueType: z.string().nullable(),
  risk: z.string().nullable(),
});

export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;
