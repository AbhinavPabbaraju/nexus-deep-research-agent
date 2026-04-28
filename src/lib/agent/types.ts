// ─── src/lib/agent/types.ts ────────────────────────────────────────────────────
// Single source of truth for all agent interfaces. Zod schemas enforce
// these at runtime on every LLM response.

import { z } from 'zod';

// ── Provider types ──────────────────────────────────────────────────────────
export type Provider = 'anthropic' | 'openai' | 'gemini' | 'nvidia';
export type ToolName = 'search' | 'retrieve' | 'reason' | 'compute' | 'critique' | 'synthesize';
export type ResearchDepth = 'quick' | 'standard' | 'deep' | 'exhaustive';
export type QueryIntent = 'factual' | 'analytical' | 'comparative' | 'predictive' | 'creative';
export type AgentAction = 'CONTINUE' | 'DONE' | 'PIVOT' | 'EXPAND' | 'FALLBACK';
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

// ── Zod Schemas (runtime validation) ───────────────────────────────────────

export const SubQuerySchema = z.object({
  id: z.string(),
  subQuery: z.string().min(5),
  rationale: z.string().min(10),
  priority: z.number().int().min(1).max(10),
});

export const ToolCallSchema = z.object({
  name: z.enum(['search', 'retrieve', 'reason', 'compute', 'critique', 'synthesize']),
  args: z.record(z.unknown()),
  priority: z.number().int().min(1).max(10),
  canParallelize: z.boolean().default(false),
  dependsOn: z.array(z.string()).default([]),
});

export const PlanResultSchema = z.object({
  intent: z.enum(['factual', 'analytical', 'comparative', 'predictive', 'creative']),
  complexity: z.enum(['low', 'medium', 'high']),
  decomposition: z.array(SubQuerySchema).min(1).max(8),
  toolSequence: z.array(ToolCallSchema).min(1).max(12),
  maxSteps: z.number().int().min(2).max(12),
  targetConfidence: z.number().min(0.5).max(0.98),
  fallbackProviders: z.array(z.enum(['anthropic', 'openai', 'gemini', 'nvidia'])).min(1),
  reasoning: z.string().min(20),
  estimatedTokens: z.number().int().optional(),
});

export const EvalResultSchema = z.object({
  confidence: z.number().min(0).max(1),
  gaps: z.array(z.string()),
  strengths: z.array(z.string()),
  action: z.enum(['CONTINUE', 'DONE', 'PIVOT', 'EXPAND', 'FALLBACK']),
  revisedPlan: PlanResultSchema.partial().optional(),
  newTools: z.array(ToolCallSchema).optional(),
  critique: z.string().min(10),
  evidenceQuality: z.enum(['poor', 'fair', 'good', 'excellent']),
});

export const SynthesisResultSchema = z.object({
  answer: z.string().min(100),
  summary: z.string().max(500),
  keyFindings: z.array(z.string()).min(1).max(8),
  limitations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.object({
    title: z.string(),
    relevance: z.number().min(0).max(1),
    excerpt: z.string().optional(),
  })).optional(),
});

// ── TypeScript Interfaces (derived from Zod) ────────────────────────────────

export type SubQuery = z.infer<typeof SubQuerySchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type PlanResult = z.infer<typeof PlanResultSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
export type SynthesisResult = z.infer<typeof SynthesisResultSchema>;

// ── Runtime state (mutable during agent loop) ───────────────────────────────

export interface StepResult {
  stepId: string;
  tool: ToolName;
  input: Record<string, unknown>;
  output: string;
  tokensUsed: number;
  latencyMs: number;
  provider: Provider;
  model: string;
  status: StepStatus;
  error?: string;
  retryCount: number;
  timestamp: number;
}

export interface AgentState {
  runId: string;
  query: string;
  depth: ResearchDepth;
  plan: PlanResult | null;
  steps: StepResult[];
  evaluations: EvalResult[];
  loopCount: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  startTime: number;
  memory: MemoryContext[];
  ragChunks: string[];
  primaryProvider: Provider;
  model: string;
  abortSignal?: AbortSignal;
}

export interface AgentInput {
  query: string;
  depth: ResearchDepth;
  provider: Provider;
  model: string;
  maxTokens: number;
  temperature: number;
  userId: string;
  memoryContextIds?: string[];
  documentIds?: string[];
  abortSignal?: AbortSignal;
}

export interface AgentResult {
  runId: string;
  query: string;
  answer: string;
  summary: string;
  keyFindings: string[];
  limitations: string[];
  confidence: number;
  stepsExecuted: number;
  loopCount: number;
  totalTokens: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  provider: Provider;
  model: string;
  depth: ResearchDepth;
  trace: StepResult[];
  timestamp: number;
}

// ── SSE Event types (streamed to client) ────────────────────────────────────

export type SSEEventType =
  | 'start'
  | 'plan'
  | 'step_start'
  | 'step_done'
  | 'step_error'
  | 'eval'
  | 'token'
  | 'loop_start'
  | 'done'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  timestamp: number;
  data?: unknown;
  error?: string;
}

// ── Memory / RAG types ───────────────────────────────────────────────────────

export interface MemoryContext {
  id: string;
  userId: string;
  query: string;
  answer: string;
  summary: string;
  provider: Provider;
  model: string;
  confidence: number;
  embedding?: number[];
  createdAt: string;
}

export interface DocumentChunk {
  id: string;
  docId: string;
  userId: string;
  content: string;
  chunkIndex: number;
  embedding?: number[];
  metadata: {
    filename: string;
    fileType: string;
    pageNumber?: number;
    section?: string;
  };
}

// ── Normalized provider response ─────────────────────────────────────────────

export interface NormalizedResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error' | 'tool_call';
  latencyMs: number;
  model: string;
  provider: Provider;
  costUsd: number;
}

// ── Agent callbacks (for streaming) ─────────────────────────────────────────

export interface AgentCallbacks {
  onStart?: (runId: string) => void;
  onPlanReady?: (plan: PlanResult) => void;
  onLoopStart?: (loopCount: number) => void;
  onStepStart?: (step: Partial<StepResult>) => void;
  onStepDone?: (step: StepResult) => void;
  onStepError?: (stepId: string, error: string) => void;
  onEval?: (eval_: EvalResult) => void;
  onToken?: (token: string) => void;
  onDone?: (result: AgentResult) => void;
  onError?: (error: string) => void;
}
