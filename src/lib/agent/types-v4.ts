// ─── src/lib/agent/types-v4.ts ────────────────────────────────────────────────
// Extended types for v4: multi-agent roles, DAG execution, circuit breakers,
// evaluation framework, domain modes, and self-improvement.

import { z } from 'zod';
import type { Provider, ResearchDepth as BaseResearchDepth, ToolName as BaseToolName } from './types';

export type ResearchDepth = BaseResearchDepth;
export type ToolName = BaseToolName | 'web_search' | 'rerank' | 'compress' | 'memory_lookup';

// ── Agent Roles ───────────────────────────────────────────────────────────────
export type AgentRole =
  | 'planner'
  | 'retriever'
  | 'memory'
  | 'researcher'
  | 'critic'
  | 'verifier'
  | 'synthesizer';

export const AgentRoleSchema = z.enum([
  'planner',
  'retriever',
  'memory',
  'researcher',
  'critic',
  'verifier',
  'synthesizer',
]);

// ── Domain Modes ─────────────────────────────────────────────────────────────
export type DomainMode =
  | 'general'
  | 'finance'
  | 'technical'
  | 'medical'
  | 'legal'
  | 'scientific';

export const DOMAIN_CONFIGS: Record<DomainMode, {
  label: string;
  icon: string;
  color: string;
  systemHint: string;
  preferredTools: string[];
  confidenceThresholdBoost: number;
}> = {
  general:    { label: 'General',    icon: '◎', color: '#6366f1', systemHint: 'Balanced research across all domains.', preferredTools: ['search','reason','synthesize'], confidenceThresholdBoost: 0 },
  finance:    { label: 'Finance',    icon: '₿', color: '#f59e0b', systemHint: 'Focus on quantitative accuracy, market data, risk. Cite figures precisely.', preferredTools: ['compute','search','critique'], confidenceThresholdBoost: 0.05 },
  technical:  { label: 'Technical',  icon: '⌥', color: '#06b6d4', systemHint: 'Emphasize implementation details, code correctness, system design trade-offs.', preferredTools: ['reason','compute','critique'], confidenceThresholdBoost: 0.03 },
  medical:    { label: 'Medical',    icon: '⊕', color: '#10b981', systemHint: 'Prioritize clinical evidence, RCT data. Always note evidence grade. Never replace professional advice.', preferredTools: ['retrieve','reason','critique'], confidenceThresholdBoost: 0.07 },
  legal:      { label: 'Legal',      icon: '§',  color: '#8b5cf6', systemHint: 'Cite jurisdiction, statute, case law. Note jurisdictional variance. This is not legal advice.', preferredTools: ['retrieve','reason','critique'], confidenceThresholdBoost: 0.06 },
  scientific: { label: 'Scientific', icon: '⬡', color: '#ec4899', systemHint: 'Prioritize peer-reviewed sources, statistical significance, reproducibility.', preferredTools: ['search','compute','critique'], confidenceThresholdBoost: 0.04 },
};

// ── DAG Node ──────────────────────────────────────────────────────────────────
export const DAGNodeStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'done',
  'error',
  'skipped',
  'degraded',
  'retrying',
]);
export type DAGNodeStatus = z.infer<typeof DAGNodeStatusSchema>;

export type FailureCode =
  | 'SCHEMA_VALIDATION_FAILED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMIT'
  | 'CIRCUIT_OPEN'
  | 'TOOL_FAILURE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONTRADICTION_DETECTED'
  | 'FATAL';

export interface AgentFailure {
  code: FailureCode;
  message: string;
  recoverable: boolean;
  raw?: unknown;
}

export interface StepMetrics {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cacheHit: boolean;
  provider?: Provider;
  model?: string;
}

export interface SourceRef {
  documentId?: string;
  url?: string;
  chunkId?: string;
  title?: string;
  quote?: string;
  relevanceScore: number;
}

export interface VerifiedClaim {
  claim: string;
  verdict: 'supported' | 'unsupported' | 'contradicted' | 'uncertain';
  confidence: number;
  reasoning: string;
  sources: SourceRef[];
}

export interface ToolPlan {
  name: ToolName;
  purpose: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  timeoutMs: number;
}

export interface PlannerOutput {
  objective: string;
  assumptions: string[];
  tasks: Array<{
    id: string;
    agent: AgentRole;
    instruction: string;
    dependencies: string[];
    requiredTools: ToolPlan[];
    expectedSchema: string;
  }>;
  successCriteria: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ResearchOutput {
  findings: Array<{
    claim: string;
    confidence: number;
    evidence: SourceRef[];
    uncertainty: string;
  }>;
  quantitativeData: string[];
  counterpoints: string[];
  gaps: string[];
  recommendedNextSteps: string[];
}

export interface CritiqueOutput {
  criticalFlaws: string[];
  unsupportedClaims: string[];
  alternativeInterpretations: string[];
  severity: 'minor' | 'major' | 'critical';
}

export interface SynthesisOutput {
  answer: string;
  summary: string;
  keyFindings: string[];
  limitations: string[];
  sources: SourceRef[];
  confidence: number;
}

export interface DAGNode {
  id: string;
  role: AgentRole;
  label: string;
  dependsOn: string[];        // node IDs that must complete first
  status: DAGNodeStatus;
  startTime?: number;
  endTime?: number;
  output?: string;
  error?: string;
  tokensUsed?: number;
  confidence?: number;
  failure?: AgentFailure;
  metrics?: StepMetrics;
  requiredTools: ToolPlan[];
  schemaName: string;
  timeoutMs: number;
  retryCount: number;
  canParallelize: boolean;
}

export interface DAGEdge {
  from: string;
  to: string;
  label?: string;
  type: 'sequential' | 'parallel' | 'conditional' | 'feedback';
}

export interface ExecutionDAG {
  nodes: DAGNode[];
  edges: DAGEdge[];
  criticalPath: string[];
  estimatedDurationMs: number;
}

// ── Multi-Agent Message ───────────────────────────────────────────────────────
export interface AgentMessage {
  fromRole: AgentRole;
  toRole: AgentRole;
  content: string;
  messageType: 'output' | 'challenge' | 'verification' | 'correction';
  timestamp: number;
  confidence: number;
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  provider: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  nextRetryTime: number;
  successCount: number;
  threshold: number;     // failures before open
  resetTimeout: number;  // ms before half-open
}

// ── Evaluation ────────────────────────────────────────────────────────────────
export interface EvaluationResult {
  runId: string;
  query: string;
  domain: DomainMode;
  factualAccuracy: number;       // 0-1
  completeness: number;          // 0-1
  coherence: number;             // 0-1
  citationQuality: number;       // 0-1
  overallScore: number;          // weighted composite
  calibrationError: number;      // |predicted_conf - actual_accuracy|
  regressionVsBaseline: number;  // positive = improvement
  issues: string[];
  timestamp: number;
}

// ── Self-Improvement ──────────────────────────────────────────────────────────
export interface ImprovementRecord {
  id: string;
  pattern: string;              // what query pattern this applies to
  failureMode: string;          // what went wrong
  correction: string;           // what to do differently
  domain: DomainMode;
  appliedCount: number;
  successRate: number;
  createdAt: number;
}

// ── Prompt Version ────────────────────────────────────────────────────────────
export interface PromptVersion {
  id: string;
  role: AgentRole;
  version: number;
  content: string;
  domain?: DomainMode;
  successRate: number;
  avgConfidence: number;
  useCount: number;
  createdAt: number;
  isActive: boolean;
}

// ── Enhanced SSE Events ───────────────────────────────────────────────────────
export type V4SSEEventType =
  | 'start'
  | 'dag_ready'
  | 'node_start'
  | 'node_done'
  | 'node_error'
  | 'agent_message'
  | 'circuit_break'
  | 'eval'
  | 'improvement'
  | 'token'
  | 'done'
  | 'error';

export interface V4SSEEvent {
  type: V4SSEEventType;
  timestamp: number;
  data?: unknown;
  error?: string;
}

// ── Enhanced Agent Result ─────────────────────────────────────────────────────
export interface V4AgentResult {
  runId: string;
  query: string;
  domain: DomainMode;
  answer: string;
  summary: string;
  keyFindings: string[];
  limitations: string[];
  sources: SourceRef[];
  verifiedClaims: VerifiedClaim[];
  failureStates: AgentFailure[];
  confidence: number;
  evaluation: EvaluationResult;
  dag: ExecutionDAG;
  agentMessages: AgentMessage[];
  improvements: ImprovementRecord[];
  totalTokens: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  provider: string;
  model: string;
  depth: string;
  circuitBreaks: number;
  timestamp: number;
}
