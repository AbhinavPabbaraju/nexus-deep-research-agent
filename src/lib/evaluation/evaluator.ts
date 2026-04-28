// ─── src/lib/evaluation/evaluator.ts ─────────────────────────────────────────
// Rigorous evaluation: factual accuracy, coherence, calibration error,
// regression vs baseline. All stored for improvement tracking.

import { callLLMJson } from '@/lib/providers/normalizer';
import type { EvaluationResult, DomainMode } from '@/lib/agent/types-v4';
import { logger } from '@/lib/observability/logger';

interface EvalInput {
  runId: string;
  query: string;
  answer: string;
  confidence: number; // 0-1, predicted by agent
  domain: DomainMode;
  baselineScore?: number; // from prior run on same query type
}

const EVAL_SYSTEM = `You are a rigorous research evaluator. Score the answer against these criteria.
Return ONLY valid JSON. Be calibrated — do not inflate scores.`;

export async function evaluateResult(input: EvalInput): Promise<EvaluationResult> {
  try {
    const scores = await callLLMJson<{
      factualAccuracy: number;
      completeness: number;
      coherence: number;
      citationQuality: number;
      issues: string[];
    }>(
      {
        systemPrompt: EVAL_SYSTEM,
        userPrompt: `Query: "${input.query}"
Domain: ${input.domain}

Answer to evaluate:
${input.answer.substring(0, 3000)}

Score each dimension 0.0-1.0:
- factualAccuracy: Are claims factually correct and well-supported?
- completeness: Does it fully address the query?
- coherence: Is reasoning logical and internally consistent?
- citationQuality: Are sources/evidence cited appropriately?
- issues: List specific problems found

Return: { "factualAccuracy": 0.0, "completeness": 0.0, "coherence": 0.0, "citationQuality": 0.0, "issues": [] }`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 800,
        temperature: 0,
        responseFormat: 'json_object',
      },
      (raw) => raw as typeof scores
    );

    const overallScore = (
      scores.factualAccuracy * 0.35 +
      scores.completeness * 0.25 +
      scores.coherence * 0.25 +
      scores.citationQuality * 0.15
    );

    // Calibration error: |predicted_confidence - actual_accuracy|
    const calibrationError = Math.abs(input.confidence - scores.factualAccuracy);

    const regressionVsBaseline = input.baselineScore != null
      ? overallScore - input.baselineScore
      : 0;

    logger.info({
      runId: input.runId,
      overallScore: overallScore.toFixed(3),
      calibrationError: calibrationError.toFixed(3),
    }, 'Evaluation complete');

    return {
      runId: input.runId,
      query: input.query,
      domain: input.domain,
      factualAccuracy: scores.factualAccuracy,
      completeness: scores.completeness,
      coherence: scores.coherence,
      citationQuality: scores.citationQuality,
      overallScore,
      calibrationError,
      regressionVsBaseline,
      issues: scores.issues ?? [],
      timestamp: Date.now(),
    };
  } catch (err) {
    logger.error({ err }, 'Evaluation failed — returning defaults');
    return {
      runId: input.runId,
      query: input.query,
      domain: input.domain,
      factualAccuracy: 0.5,
      completeness: 0.5,
      coherence: 0.5,
      citationQuality: 0.3,
      overallScore: 0.5,
      calibrationError: Math.abs(input.confidence - 0.5),
      regressionVsBaseline: 0,
      issues: ['Evaluation failed'],
      timestamp: Date.now(),
    };
  }
}

// ── Benchmark dataset helpers ─────────────────────────────────────────────────
export interface BenchmarkQuery {
  id: string;
  query: string;
  domain: DomainMode;
  expectedKeywords: string[];
  minAccuracy: number;
}

export const BENCHMARK_QUERIES: BenchmarkQuery[] = [
  { id: 'fin-01', query: 'Explain the Black-Scholes model and its assumptions', domain: 'finance', expectedKeywords: ['volatility', 'risk-free rate', 'European option', 'log-normal'], minAccuracy: 0.85 },
  { id: 'sci-01', query: 'What is CRISPR-Cas9 and how does it work?', domain: 'scientific', expectedKeywords: ['guide RNA', 'nuclease', 'DNA repair', 'off-target'], minAccuracy: 0.88 },
  { id: 'tech-01', query: 'Compare RAFT vs Paxos consensus algorithms', domain: 'technical', expectedKeywords: ['leader election', 'log replication', 'safety', 'liveness'], minAccuracy: 0.82 },
  { id: 'gen-01', query: 'What caused the 2008 financial crisis?', domain: 'general', expectedKeywords: ['subprime', 'mortgage-backed securities', 'leverage', 'systemic risk'], minAccuracy: 0.80 },
];

export function scoreKeywordCoverage(answer: string, keywords: string[]): number {
  const lower = answer.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return hits.length / keywords.length;
}
