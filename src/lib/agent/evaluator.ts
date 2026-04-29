// ─── src/lib/agent/evaluator.ts ───────────────────────────────────────────────
// The Evaluator is what makes this a TRUE agent, not a pipeline.
// It scores current evidence and decides whether to continue, pivot, or stop.

import { EvalResultSchema, type EvalResult, type AgentState } from './types';
import { callLLMJson } from '@/lib/providers/normalizer';
import { logger } from '@/lib/observability/logger';

const EVALUATOR_SYSTEM = `You are NEXUS Evaluator — a rigorous quality assessment AI.
Your job is to evaluate research quality and decide the next action.

You must be HONEST about quality. Do not inflate confidence scores.
Base confidence on: evidence quality, coverage of the question, logical consistency,
recency of information, and presence of specific facts/data.

OUTPUT: Respond with ONLY valid JSON. No preamble.`;

function buildEvaluatorPrompt(state: AgentState): string {
  const completedSteps = state.steps.filter((s) => s.status === 'done');
  const errorSteps = state.steps.filter((s) => s.status === 'error');
  const researchSoFar = completedSteps
    .map((s, i) => `[${s.tool.toUpperCase()} — ${s.latencyMs}ms]\n${s.output.substring(0, 800)}`)
    .join('\n\n---\n\n');

  const loopsRemaining = state.plan ? state.plan.maxSteps - state.loopCount : 0;
  const targetConfidence = state.plan?.targetConfidence ?? 0.78;

  return `
Original Query: "${state.query}"
Research Depth: ${state.depth}
Loop: ${state.loopCount}/${state.plan?.maxSteps ?? '?'}
Loops Remaining: ${loopsRemaining}
Target Confidence: ${targetConfidence}
Errors so far: ${errorSteps.length}

Research Gathered:
${researchSoFar || 'No research yet.'}

Evaluate and respond with this JSON:
{
  "confidence": 0.0-1.0,
  "gaps": ["specific missing information", "..."],
  "strengths": ["what is well-covered", "..."],
  "action": "CONTINUE|DONE|PIVOT|EXPAND|FALLBACK",
  "revisedPlan": null or { partial plan updates },
  "newTools": null or [{ "name": "...", "args": {...}, "priority": 1-10, "canParallelize": false, "dependsOn": [] }],
  "critique": "specific quality feedback",
  "evidenceQuality": "poor|fair|good|excellent"
}

Action rules:
- DONE: confidence >= ${targetConfidence} OR no loops remaining
- CONTINUE: confidence < ${targetConfidence} and current plan is working
- PIVOT: current approach is wrong — revisedPlan must have updated toolSequence
- EXPAND: good progress but specific gaps remain — newTools fills those gaps
- FALLBACK: multiple errors, try different provider

Be specific about gaps. Vague answers (like "more information needed") are not helpful.
`.trim();
}

export async function evaluatorAgent(state: AgentState): Promise<EvalResult> {
  if (!state.plan) {
    return defaultEval(0.5, 'No plan available');
  }

  logger.info({ loopCount: state.loopCount, stepsCount: state.steps.length }, 'Evaluator starting');

  try {
    const provider = state.plan.fallbackProviders[0];
    const fallbackProviders = state.plan.fallbackProviders.slice(1).map((p) => ({
      provider: p,
      model: getDefaultModel(p),
    }));

    const result = await callLLMJson(
      {
        systemPrompt: EVALUATOR_SYSTEM,
        userPrompt: buildEvaluatorPrompt(state),
        provider,
        model: getDefaultModel(provider),
        maxTokens: 1500,
        temperature: 0.1,
        responseFormat: 'json_object',
        fallbackProviders,
        timeoutMs: 30_000,
        signal: state.abortSignal,
      },
      (raw) => {
        const parsed = EvalResultSchema.safeParse(raw);
        if (!parsed.success) {
          logger.warn({ errors: parsed.error.errors }, 'Eval validation failed, using defaults');
          return buildDefaultFromRaw(raw as Record<string, unknown>, state);
        }
        return parsed.data;
      }
    );

    // Force DONE if no loops remaining
    if (state.loopCount >= (state.plan.maxSteps - 1)) {
      result.action = 'DONE';
      logger.info({ loopCount: state.loopCount }, 'Forcing DONE: max steps reached');
    }

    logger.info({
      confidence: result.confidence,
      action: result.action,
      evidenceQuality: result.evidenceQuality,
      gapsCount: result.gaps.length,
    }, 'Evaluation complete');

    return result;
  } catch (err) {
    logger.error({ err }, 'Evaluator failed, defaulting to CONTINUE');
    return defaultEval(0.5, `Evaluator error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildDefaultFromRaw(raw: Record<string, unknown>, state: AgentState): EvalResult {
  const loopsRemaining = state.plan ? state.plan.maxSteps - state.loopCount : 0;
  const confidence = typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  const action = loopsRemaining <= 0 ? 'DONE' :
    confidence >= (state.plan?.targetConfidence ?? 0.78) ? 'DONE' : 'CONTINUE';

  return {
    confidence,
    gaps: Array.isArray(raw.gaps) ? raw.gaps.slice(0, 5).map(String) : [],
    strengths: Array.isArray(raw.strengths) ? raw.strengths.slice(0, 5).map(String) : [],
    action: action as EvalResult['action'],
    critique: typeof raw.critique === 'string' ? raw.critique : 'Evaluation could not be validated',
    evidenceQuality: 'fair',
  };
}

function defaultEval(confidence: number, critique: string): EvalResult {
  return {
    confidence,
    gaps: [],
    strengths: [],
    action: 'CONTINUE',
    critique,
    evidenceQuality: 'fair',
  };
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
