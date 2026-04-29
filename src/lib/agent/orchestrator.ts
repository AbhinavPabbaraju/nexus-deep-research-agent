// ─── src/lib/agent/orchestrator.ts ───────────────────────────────────────────
// The main agent loop: Planner → Executor → Evaluator → Loop → Synthesizer
// Callbacks stream each event to the SSE endpoint in real time.

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentInput,
  AgentResult,
  AgentState,
  AgentCallbacks,
  StepResult,
  EvalResult,
} from './types';
import { plannerAgent } from './planner';
import { executorAgent } from './executor';
import { evaluatorAgent } from './evaluator';
import { ragRetrieve } from '@/lib/rag/retriever';
import { loadMemoryContexts } from '@/lib/db/memory';
import { tracer } from '@/lib/observability/tracer';
import { logger } from '@/lib/observability/logger';

export async function runAgentLoop(
  input: AgentInput,
  callbacks: AgentCallbacks = {}
): Promise<AgentResult> {
  const runId = uuidv4();
  const startTime = Date.now();

  logger.info({ runId, query: input.query, depth: input.depth, provider: input.provider }, 'Agent run starting');
  callbacks.onStart?.(runId);

  // ── Initialize state ────────────────────────────────────────────────────────
  const state: AgentState = {
    runId,
    query: input.query,
    depth: input.depth,
    plan: null,
    steps: [],
    evaluations: [],
    loopCount: 0,
    totalTokensUsed: 0,
    totalCostUsd: 0,
    startTime,
    memory: [],
    ragChunks: [],
    primaryProvider: input.provider,
    model: input.model,
    abortSignal: input.abortSignal,
  };

  const span = tracer.startSpan('agent.run', { runId, query: input.query });

  try {
    // ── Load memory contexts ───────────────────────────────────────────────────
    if (input.memoryContextIds && input.memoryContextIds.length > 0) {
      state.memory = await loadMemoryContexts(input.memoryContextIds, input.userId);
      logger.info({ count: state.memory.length }, 'Memory contexts loaded');
    }

    // ── Load RAG chunks ────────────────────────────────────────────────────────
    if (input.documentIds && input.documentIds.length > 0) {
      state.ragChunks = await ragRetrieve(input.query, input.userId, 8);
      logger.info({ count: state.ragChunks.length }, 'RAG chunks retrieved');
    }

    // ── Build memory context string for planner ────────────────────────────────
    const memoryContext = state.memory
      .map((m) => `Q: ${m.query}\nA: ${m.summary || m.answer.substring(0, 300)}`)
      .join('\n\n');

    // ── STEP 1: PLANNER ────────────────────────────────────────────────────────
    const plan = await plannerAgent(input, memoryContext);
    state.plan = plan;
    callbacks.onPlanReady?.(plan);
    span.setAttribute('plan.intent', plan.intent);
    span.setAttribute('plan.maxSteps', plan.maxSteps);

    // ── AGENT LOOP ─────────────────────────────────────────────────────────────
    let lastEval: EvalResult | null = null;

    while (state.loopCount < plan.maxSteps) {
      if (state.abortSignal?.aborted) {
        logger.info({ runId }, 'Agent aborted by signal');
        break;
      }

      state.loopCount++;
      callbacks.onLoopStart?.(state.loopCount);
      logger.info({ loopCount: state.loopCount, maxSteps: plan.maxSteps }, 'Loop iteration');

      // ── STEP 2: EXECUTOR ─────────────────────────────────────────────────────
      const newSteps = await executorAgent(state, {
        onStepStart: (step) => callbacks.onStepStart?.(step),
        onStepDone: (step) => {
          state.totalTokensUsed += step.tokensUsed;
          callbacks.onStepDone?.(step);
        },
        onStepError: (stepId, error) => callbacks.onStepError?.(stepId, error),
      });

      state.steps.push(...newSteps);

      // ── STEP 3: EVALUATOR ────────────────────────────────────────────────────
      const eval_ = await evaluatorAgent(state);
      state.evaluations.push(eval_);
      lastEval = eval_;
      callbacks.onEval?.(eval_);

      span.addEvent('eval', { confidence: eval_.confidence, action: eval_.action });

      // ── Decision logic ───────────────────────────────────────────────────────
      if (eval_.action === 'DONE') {
        logger.info({ confidence: eval_.confidence }, 'Evaluator says DONE');
        break;
      }

      if (eval_.action === 'PIVOT' && eval_.revisedPlan) {
        logger.info({ revisedPlan: eval_.revisedPlan }, 'Pivoting plan');
        state.plan = { ...state.plan, ...eval_.revisedPlan };
      }

      if (eval_.action === 'EXPAND' && eval_.newTools && eval_.newTools.length > 0) {
        // Add new tools before synthesize
        const synthIndex: number = state.plan.toolSequence.findIndex((t) => t.name === 'synthesize');
        const insertAt: number = synthIndex >= 0 ? synthIndex : state.plan.toolSequence.length;
        state.plan = {
          ...state.plan,
          toolSequence: [
            ...state.plan.toolSequence.slice(0, insertAt),
            ...eval_.newTools,
            ...state.plan.toolSequence.slice(insertAt),
          ],
        };
        logger.info({ newTools: eval_.newTools.map((t) => t.name) }, 'Expanded tool sequence');
      }

      if (eval_.action === 'FALLBACK') {
        // Rotate providers
        if (state.plan.fallbackProviders.length > 1) {
          state.plan = {
            ...state.plan,
            fallbackProviders: [
              ...state.plan.fallbackProviders.slice(1),
              state.plan.fallbackProviders[0],
            ],
          };
          logger.info({ newPrimary: state.plan.fallbackProviders[0] }, 'Provider fallback triggered');
        }
      }
    }

    // ── Build final answer from synthesis step ─────────────────────────────────
    const synthStep = state.steps.filter((s) => s.tool === 'synthesize' && s.status === 'done').at(-1);
    const finalAnswer = synthStep?.output || buildFallbackAnswer(state);
    const finalConfidence = lastEval?.confidence ?? computeHeuristicConfidence(state);

    const result: AgentResult = {
      runId,
      query: input.query,
      answer: finalAnswer,
      summary: extractSummary(finalAnswer),
      keyFindings: extractKeyFindings(finalAnswer),
      limitations: lastEval?.gaps ?? [],
      confidence: Math.round(finalConfidence * 100),
      stepsExecuted: state.steps.length,
      loopCount: state.loopCount,
      totalTokens: state.totalTokensUsed,
      totalCostUsd: state.totalCostUsd,
      totalLatencyMs: Date.now() - startTime,
      provider: input.provider,
      model: input.model,
      depth: input.depth,
      trace: state.steps,
      timestamp: Date.now(),
    };

    span.setStatus('success');
    span.setAttribute('result.confidence', result.confidence);
    span.setAttribute('result.stepsExecuted', result.stepsExecuted);

    callbacks.onDone?.(result);
    logger.info({
      runId,
      confidence: result.confidence,
      stepsExecuted: result.stepsExecuted,
      totalLatencyMs: result.totalLatencyMs,
    }, 'Agent run complete');

    return result;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    span.setStatus('error', error);
    callbacks.onError?.(error);
    logger.error({ runId, err }, 'Agent run failed');
    throw err;
  } finally {
    span.end();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractSummary(answer: string): string {
  // Try to extract the executive summary section
  const match = answer.match(/#+\s*Executive Summary\s*\n+([\s\S]*?)(?=\n#+|\n\n##|$)/i);
  if (match) return match[1].trim().substring(0, 500);
  // Fall back to first paragraph
  return answer.split(/\n\n+/)[0]?.trim().substring(0, 500) ?? '';
}

function extractKeyFindings(answer: string): string[] {
  // Try to extract Key Findings section
  const match = answer.match(/#+\s*Key Findings\s*\n+([\s\S]*?)(?=\n#+|$)/i);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l.length > 10)
    .slice(0, 6);
}

function computeHeuristicConfidence(state: AgentState): number {
  let score = 0.4;
  const doneSteps = state.steps.filter((s) => s.status === 'done');
  score += Math.min(0.2, doneSteps.length * 0.04);
  score += Math.min(0.15, state.ragChunks.length * 0.03);
  if (state.memory.length > 0) score += 0.05;
  const hasSynth = doneSteps.some((s) => s.tool === 'synthesize');
  if (hasSynth) score += 0.1;
  const hasCritique = doneSteps.some((s) => s.tool === 'critique');
  if (hasCritique) score += 0.05;
  return Math.min(0.95, score);
}

function buildFallbackAnswer(state: AgentState): string {
  const doneSteps = state.steps.filter((s) => s.status === 'done' && s.output);
  if (doneSteps.length === 0) return `Unable to complete research for: ${state.query}`;

  const parts = doneSteps.map((s) => `## ${s.tool.toUpperCase()}\n${s.output}`);
  return `# Research Results\n\n${parts.join('\n\n---\n\n')}`;
}
