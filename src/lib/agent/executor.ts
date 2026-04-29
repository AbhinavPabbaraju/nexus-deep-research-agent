// ─── src/lib/agent/executor.ts ────────────────────────────────────────────────
// Executor dispatches tools. Independent tools run in parallel.
// Each tool has retry logic and a timeout. Failed tools don't crash the agent.

import { v4 as uuidv4 } from 'uuid';
import type { AgentState, StepResult, ToolCall, ToolName } from './types';
import { callLLM } from '@/lib/providers/normalizer';
import { logger } from '@/lib/observability/logger';

// ── Tool timeout config ───────────────────────────────────────────────────────
const TOOL_TIMEOUTS: Record<ToolName, number> = {
  search:     12_000,
  retrieve:   6_000,
  reason:     45_000,
  compute:    20_000,
  critique:   30_000,
  synthesize: 90_000,
};

// ── Tool system prompts ───────────────────────────────────────────────────────
const TOOL_SYSTEM_PROMPTS: Record<ToolName, string> = {
  search: `You are a research specialist. Given a query, synthesize comprehensive information
from your knowledge base. Structure your response with clear sections. Include specific facts,
statistics, and examples where possible. Be thorough but concise.`,

  retrieve: `You are a document analysis specialist. Given a query and document context,
extract the most relevant information. Cite specific passages. Identify key claims and evidence.
Note any contradictions or gaps in the documents.`,

  reason: `You are a deep analytical reasoner. Given context and a question, apply rigorous
logical analysis. Identify assumptions, evaluate evidence quality, consider multiple perspectives,
and draw well-reasoned conclusions. Show your reasoning chain explicitly.`,

  compute: `You are a quantitative analyst. Given data or a computational question, perform
accurate calculations, identify trends, and interpret results clearly. Show your work step by step.`,

  critique: `You are an adversarial reviewer. Given a claim or analysis, identify:
1. Logical flaws or weak reasoning
2. Missing evidence or counterexamples  
3. Alternative explanations not considered
4. Overly strong claims not supported by evidence
5. Potential biases or limitations
Be specific and constructive.`,

  synthesize: `You are a research synthesis expert. Given all research gathered, produce a
definitive, well-structured research report. Format:
# Executive Summary
(2-3 sentence overview)

## Key Findings
(bullet points)

## Detailed Analysis
(structured sections with evidence)

## Limitations & Caveats
(honest assessment of uncertainty)

## Conclusion
(clear, actionable takeaway)

Use markdown. Be comprehensive but precise.`,
};

// ── Individual tool handlers ──────────────────────────────────────────────────

async function executeTool(
  tool: ToolCall,
  state: AgentState,
  priorContext: string
): Promise<string> {
  const provider = state.plan!.fallbackProviders[0];
  const fallbackProviders = state.plan!.fallbackProviders.slice(1).map((p) => ({
    provider: p,
    model: getDefaultModel(p),
  }));

  const buildPrompt = (): string => {
    switch (tool.name) {
      case 'search': {
        const q = (tool.args.query as string) || state.query;
        const maxRes = (tool.args.maxResults as number) || 5;
        return `Search Query: "${q}"\nMax Results Desired: ${maxRes}\n\nProvide ${maxRes} detailed findings on this topic from your knowledge.`;
      }
      case 'retrieve': {
        const q = (tool.args.query as string) || state.query;
        const docs = state.ragChunks.join('\n\n---\n\n') || 'No documents available.';
        return `Query: "${q}"\n\nDocument Context:\n${docs}\n\nExtract all relevant information from these documents.`;
      }
      case 'reason': {
        const q = (tool.args.question as string) || state.query;
        return `Question: "${q}"\n\nContext from prior research:\n${priorContext}\n\nApply deep analytical reasoning to answer this question comprehensively.`;
      }
      case 'compute': {
        const task = (tool.args.task as string) || state.query;
        return `Computational Task: "${task}"\n\nContext:\n${priorContext}\n\nPerform accurate computation and analysis.`;
      }
      case 'critique': {
        const claim = (tool.args.claim as string) || priorContext;
        return `Claim/Analysis to Critique:\n${claim}\n\nAdversarially review this for flaws, gaps, and weaknesses.`;
      }
      case 'synthesize': {
        return `Original Query: "${state.query}"\n\nAll Research Gathered:\n${priorContext}\n\nSynthesize this into a definitive research report.`;
      }
      default:
        return state.query;
    }
  };

  const res = await callLLM({
    systemPrompt: TOOL_SYSTEM_PROMPTS[tool.name as ToolName],
    userPrompt: buildPrompt(),
    provider,
    model: getDefaultModel(provider),
    maxTokens: tool.name === 'synthesize' ? 6000 : 3000,
    temperature: ['reason', 'synthesize', 'critique'].includes(tool.name) ? 0.2 : 0.3,
    fallbackProviders,
    timeoutMs: TOOL_TIMEOUTS[tool.name as ToolName],
    signal: state.abortSignal,
  });

  return res.content;
}

function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    anthropic: 'claude-sonnet-4-5',
    openai:    'gpt-4o',
    gemini:    'gemini-1.5-pro',
    nvidia:    'meta/llama-3.1-70b-instruct',
  };
  return defaults[provider] ?? 'claude-sonnet-4-5';
}

// ── Partition tools into parallel/sequential groups ───────────────────────────

function partitionTools(tools: ToolCall[]): { parallel: ToolCall[][]; sequential: ToolCall[][] } {
  const groups: { parallel: ToolCall[][]; sequential: ToolCall[][] } = {
    parallel: [],
    sequential: [],
  };

  let currentParallelGroup: ToolCall[] = [];

  for (const tool of tools) {
    if (tool.canParallelize && tool.dependsOn.length === 0) {
      currentParallelGroup.push(tool);
    } else {
      if (currentParallelGroup.length > 0) {
        groups.parallel.push([...currentParallelGroup]);
        currentParallelGroup = [];
      }
      groups.sequential.push([tool]);
    }
  }

  if (currentParallelGroup.length > 0) {
    groups.parallel.push(currentParallelGroup);
  }

  return groups;
}

// ── Main executor function ────────────────────────────────────────────────────

export interface ExecutorCallbacks {
  onStepStart: (step: Partial<StepResult>) => void;
  onStepDone: (step: StepResult) => void;
  onStepError: (stepId: string, error: string) => void;
}

export async function executorAgent(
  state: AgentState,
  callbacks: ExecutorCallbacks
): Promise<StepResult[]> {
  if (!state.plan) throw new Error('No plan set on agent state');

  const tools = state.plan.toolSequence;
  const results: StepResult[] = [];

  // Build context from completed steps
  function buildPriorContext(): string {
    return [...state.steps, ...results]
      .filter((s) => s.status === 'done')
      .map((s, i) => `[Step ${i + 1} — ${s.tool.toUpperCase()}]\n${s.output}`)
      .join('\n\n---\n\n');
  }

  // Execute a single tool call
  async function runTool(tool: ToolCall): Promise<StepResult> {
    const stepId = uuidv4();
    const t0 = Date.now();
    const provider = state.plan!.fallbackProviders[0];
    const model = state.model || getDefaultModel(provider);

    const partial: Partial<StepResult> = {
      stepId,
      tool: tool.name as ToolName,
      input: tool.args,
      status: 'running',
      provider,
      model,
      timestamp: t0,
      retryCount: 0,
    };

    callbacks.onStepStart(partial);
    logger.info({ stepId, tool: tool.name }, 'Step starting');

    try {
      const output = await executeTool(tool, state, buildPriorContext());
      const latencyMs = Date.now() - t0;

      // Rough token estimate (actual tracked in callLLM)
      const tokensUsed = Math.ceil(output.split(/\s+/).length * 1.3);

      const step: StepResult = {
        stepId,
        tool: tool.name as ToolName,
        input: tool.args,
        output,
        tokensUsed,
        latencyMs,
        provider,
        model,
        status: 'done',
        retryCount: 0,
        timestamp: t0,
      };

      callbacks.onStepDone(step);
      logger.info({ stepId, tool: tool.name, latencyMs, tokensUsed }, 'Step done');
      return step;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      const step: StepResult = {
        stepId,
        tool: tool.name as ToolName,
        input: tool.args,
        output: '',
        tokensUsed: 0,
        latencyMs: Date.now() - t0,
        provider,
        model,
        status: 'error',
        error,
        retryCount: 0,
        timestamp: t0,
      };

      callbacks.onStepError(stepId, error);
      logger.error({ stepId, tool: tool.name, error }, 'Step failed');
      return step;
    }
  }

  // Process tools — batch parallel groups, then sequential
  // Build batches: consecutive parallelizable tools go together
  const batches: Array<{ parallel: boolean; tools: ToolCall[] }> = [];
  let i = 0;
  while (i < tools.length) {
    const tool = tools[i];
    if (tool.canParallelize) {
      const batch: ToolCall[] = [];
      while (i < tools.length && tools[i].canParallelize) {
        batch.push(tools[i]);
        i++;
      }
      batches.push({ parallel: true, tools: batch });
    } else {
      batches.push({ parallel: false, tools: [tool] });
      i++;
    }
  }

  for (const batch of batches) {
    if (state.abortSignal?.aborted) break;

    if (batch.parallel && batch.tools.length > 1) {
      logger.info({ count: batch.tools.length, tools: batch.tools.map((t) => t.name) }, 'Parallel batch');
      const settled = await Promise.allSettled(batch.tools.map((t) => runTool(t)));
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value);
      }
    } else {
      const step = await runTool(batch.tools[0]);
      results.push(step);
    }
  }

  return results;
}
