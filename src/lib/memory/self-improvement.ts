// ─── src/lib/memory/self-improvement.ts ──────────────────────────────────────
// Self-improving agent: extracts failure patterns from low-scoring runs
// and stores corrections that are injected into future planner prompts.

import { callLLMJson } from '@/lib/providers/normalizer';
import type { ImprovementRecord, EvaluationResult, DomainMode } from '@/lib/agent/types-v4';
import { logger } from '@/lib/observability/logger';
import { v4 as uuidv4 } from 'uuid';

// In-memory store (replace with Supabase for persistence)
const improvements: ImprovementRecord[] = [];

export function getImprovements(domain: DomainMode, limit = 5): ImprovementRecord[] {
  return improvements
    .filter((r) => r.domain === domain && r.successRate > 0.5)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, limit);
}

export async function extractImprovement(
  query: string,
  answer: string,
  evaluation: EvaluationResult,
  domain: DomainMode
): Promise<ImprovementRecord | null> {
  // Only learn from poor performance
  if (evaluation.overallScore > 0.7) return null;

  try {
    const record = await callLLMJson<Omit<ImprovementRecord, 'id' | 'appliedCount' | 'successRate' | 'createdAt'>>(
      {
        systemPrompt: 'You are a meta-learning analyst. Extract failure patterns. Return ONLY JSON.',
        userPrompt: `A research run scored poorly (${(evaluation.overallScore * 100).toFixed(0)}%).

Query: "${query}"
Domain: ${domain}
Issues found: ${evaluation.issues.join('; ')}
Calibration error: ${evaluation.calibrationError.toFixed(3)}

Extract the failure pattern and correction. Return:
{
  "pattern": "type of query/domain that caused this failure",
  "failureMode": "specific thing that went wrong",
  "correction": "concrete instruction to avoid this in future",
  "domain": "${domain}"
}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 500,
        temperature: 0,
        responseFormat: 'json_object',
      },
      (raw) => raw as Omit<ImprovementRecord, 'id' | 'appliedCount' | 'successRate' | 'createdAt'>
    );

    const improvement: ImprovementRecord = {
      ...record,
      id: uuidv4(),
      appliedCount: 0,
      successRate: 0,
      createdAt: Date.now(),
    };

    improvements.push(improvement);
    logger.info({ id: improvement.id, pattern: improvement.pattern }, 'Improvement extracted');
    return improvement;
  } catch (err) {
    logger.error({ err }, 'Failed to extract improvement');
    return null;
  }
}

export function recordImprovementOutcome(id: string, success: boolean): void {
  const record = improvements.find((r) => r.id === id);
  if (!record) return;
  record.appliedCount++;
  // Exponential moving average
  record.successRate = 0.7 * record.successRate + 0.3 * (success ? 1 : 0);
}

export function formatImprovementsForPrompt(records: ImprovementRecord[]): string {
  if (records.length === 0) return '';
  return `\nLearned corrections from past failures:\n${records.map((r) =>
    `- Pattern: ${r.pattern}\n  Correction: ${r.correction}`
  ).join('\n')}`;
}
