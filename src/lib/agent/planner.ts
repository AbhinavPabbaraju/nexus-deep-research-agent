// ─── src/lib/agent/planner.ts ─────────────────────────────────────────────────
// Planner converts user query into a structured JSON plan.
// All output is Zod-validated — if the LLM produces garbage, it retries.

import { z } from 'zod';
import { PlanResultSchema, type PlanResult, type AgentInput, type Provider } from './types';
import { callLLMJson } from '@/lib/providers/normalizer';
import { logger } from '@/lib/observability/logger';

const DEPTH_CONFIG: Record<string, { maxSteps: number; targetConfidence: number }> = {
  quick:      { maxSteps: 3,  targetConfidence: 0.65 },
  standard:   { maxSteps: 6,  targetConfidence: 0.78 },
  deep:       { maxSteps: 9,  targetConfidence: 0.88 },
  exhaustive: { maxSteps: 12, targetConfidence: 0.94 },
};

// Provider fallback chains (ordered by quality/cost tradeoff)
const FALLBACK_CHAINS: Record<Provider, Array<{ provider: Provider; model: string }>> = {
  anthropic: [
    { provider: 'openai',   model: 'gpt-4o'           },
    { provider: 'gemini',   model: 'gemini-1.5-pro'   },
  ],
  openai: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'gemini',    model: 'gemini-1.5-pro'    },
  ],
  gemini: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai',    model: 'gpt-4o-mini'       },
  ],
  nvidia: [
    { provider: 'openai',    model: 'gpt-4o-mini'       },
    { provider: 'anthropic', model: 'claude-haiku-4-5'  },
  ],
};

const PLANNER_SYSTEM = `You are NEXUS Planner — a research orchestration AI.
Your job is to analyze a research query and produce a structured execution plan.

TOOLS available to the agent:
- search: Web/knowledge search for facts and current information
- retrieve: Semantic RAG retrieval from user's uploaded documents
- reason: Deep analytical reasoning and inference
- compute: Mathematical/statistical computation or data analysis
- critique: Adversarial review — find flaws, counterarguments, missing evidence
- synthesize: Final answer generation (always last)

OUTPUT: Respond with ONLY valid JSON matching the specified schema. No preamble, no explanation.
Think carefully about which tools to use and in what order. Some tools can run in parallel (canParallelize: true).`;

function buildPlannerPrompt(input: AgentInput, memoryContext: string): string {
  const config = DEPTH_CONFIG[input.depth] ?? DEPTH_CONFIG.standard;

  return `
Research Query: "${input.query}"
Research Depth: ${input.depth} (max ${config.maxSteps} steps, target confidence: ${config.targetConfidence})
User has documents: ${(input.documentIds ?? []).length > 0}
Has memory context: ${(input.memoryContextIds ?? []).length > 0}

${memoryContext ? `Prior research context:\n${memoryContext}` : ''}

Produce a JSON plan with this exact structure:
{
  "intent": "factual|analytical|comparative|predictive|creative",
  "complexity": "low|medium|high",
  "decomposition": [
    { "id": "q1", "subQuery": "...", "rationale": "...", "priority": 1-10 }
  ],
  "toolSequence": [
    {
      "name": "search|retrieve|reason|compute|critique|synthesize",
      "args": { ... },
      "priority": 1-10,
      "canParallelize": true/false,
      "dependsOn": []
    }
  ],
  "maxSteps": ${config.maxSteps},
  "targetConfidence": ${config.targetConfidence},
  "fallbackProviders": ["anthropic", "openai", "gemini"],
  "reasoning": "why this plan makes sense",
  "estimatedTokens": 5000
}

Rules:
- Break the query into 2-5 specific sub-questions
- search/retrieve steps that are independent SHOULD have canParallelize: true
- reason/critique/synthesize MUST be sequential
- synthesize MUST be the final tool
- The args for each tool should be specific and actionable
`.trim();
}

export async function plannerAgent(
  input: AgentInput,
  memoryContext: string = ''
): Promise<PlanResult> {
  logger.info({ query: input.query, depth: input.depth }, 'Planner starting');

  try {
    const plan = await callLLMJson(
      {
        systemPrompt: PLANNER_SYSTEM,
        userPrompt: buildPlannerPrompt(input, memoryContext),
        provider: input.provider,
        model: input.model,
        maxTokens: 2000,
        temperature: 0.1, // Deterministic planning
        responseFormat: 'json_object',
        fallbackProviders: FALLBACK_CHAINS[input.provider],
        timeoutMs: 30_000,
        signal: input.abortSignal,
      },
      (raw) => {
        const result = PlanResultSchema.safeParse(raw);
        if (!result.success) {
          logger.warn({ errors: result.error.errors }, 'Plan validation failed, applying defaults');
          return applyPlanDefaults(raw as Record<string, unknown>, input);
        }
        return result.data;
      }
    );

    logger.info({
      intent: plan.intent,
      tools: plan.toolSequence.map((t) => t.name),
      maxSteps: plan.maxSteps,
    }, 'Plan ready');

    return plan;
  } catch (err) {
    logger.error({ err }, 'Planner failed, using fallback plan');
    return buildFallbackPlan(input);
  }
}

// If validation fails, salvage what we can and fill in defaults
function applyPlanDefaults(raw: Record<string, unknown>, input: AgentInput): PlanResult {
  const config = DEPTH_CONFIG[input.depth] ?? DEPTH_CONFIG.standard;
  return PlanResultSchema.parse({
    intent: raw.intent ?? 'analytical',
    complexity: raw.complexity ?? 'medium',
    decomposition: Array.isArray(raw.decomposition) && raw.decomposition.length > 0
      ? raw.decomposition
      : [{ id: 'q1', subQuery: input.query, rationale: 'Primary research question', priority: 10 }],
    toolSequence: Array.isArray(raw.toolSequence) && raw.toolSequence.length > 0
      ? raw.toolSequence
      : [
          { name: 'search',    args: { query: input.query }, priority: 9, canParallelize: false, dependsOn: [] },
          { name: 'reason',    args: { question: input.query }, priority: 7, canParallelize: false, dependsOn: [] },
          { name: 'synthesize', args: {}, priority: 10, canParallelize: false, dependsOn: [] },
        ],
    maxSteps: config.maxSteps,
    targetConfidence: config.targetConfidence,
    fallbackProviders: [input.provider, 'openai', 'gemini'].filter(
      (p, i, arr) => arr.indexOf(p) === i
    ) as Provider[],
    reasoning: 'Fallback plan due to planner error',
    estimatedTokens: 3000,
  });
}

// Hard-coded minimal plan as last resort
function buildFallbackPlan(input: AgentInput): PlanResult {
  const config = DEPTH_CONFIG[input.depth] ?? DEPTH_CONFIG.standard;
  return {
    intent: 'analytical',
    complexity: 'medium',
    decomposition: [{ id: 'q1', subQuery: input.query, rationale: 'Primary research question', priority: 10 }],
    toolSequence: [
      { name: 'search',    args: { query: input.query, maxResults: 5 }, priority: 9, canParallelize: false, dependsOn: [] },
      { name: 'reason',    args: { question: input.query, context: '' }, priority: 7, canParallelize: false, dependsOn: [] },
      { name: 'synthesize', args: {}, priority: 10, canParallelize: false, dependsOn: [] },
    ],
    maxSteps: config.maxSteps,
    targetConfidence: config.targetConfidence,
    fallbackProviders: [input.provider],
    reasoning: 'Minimal fallback plan',
    estimatedTokens: 2000,
  };
}
