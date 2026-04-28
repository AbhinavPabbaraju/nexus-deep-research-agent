// ─── src/lib/agent/roles/agents.ts ────────────────────────────────────────────
// Four specialized agents that challenge each other.
// Each has a distinct system prompt, temperature, and evaluation criteria.

import { callLLM, callLLMJson } from '@/lib/providers/normalizer';
import { DOMAIN_CONFIGS, type DomainMode, type AgentMessage } from '@/lib/agent/types-v4';
import { withRetry } from '@/lib/reliability/circuit-breaker';
import { logger } from '@/lib/observability/logger';
import type { Provider } from '@/lib/agent/types';

interface AgentCallOptions {
  query: string;
  context: string;
  domain: DomainMode;
  provider: Provider;
  model: string;
  signal?: AbortSignal;
}

function getDomainHint(domain: DomainMode): string {
  return DOMAIN_CONFIGS[domain].systemHint;
}

// ── RESEARCHER ────────────────────────────────────────────────────────────────
export async function researcherAgent(opts: AgentCallOptions): Promise<string> {
  const domainHint = getDomainHint(opts.domain);
  const system = `You are NEXUS Researcher — a world-class research specialist.
Domain context: ${domainHint}

Your job: produce comprehensive, evidence-based research on the given query.
Structure your output with: key facts, supporting evidence, quantitative data where available,
multiple perspectives, and explicit uncertainty markers where evidence is weak.
Use markdown. Be exhaustive but precise.`;

  const prompt = `Query: "${opts.query}"
Prior context: ${opts.context || 'None'}

Produce deep research. Include:
1. Core findings (with confidence level per finding)
2. Quantitative data / statistics
3. Contrasting viewpoints
4. Knowledge gaps / uncertainties
5. Suggested follow-up questions`;

  return withRetry(
    () => callLLM({ systemPrompt: system, userPrompt: prompt, provider: opts.provider, model: opts.model, maxTokens: 4000, temperature: 0.25, signal: opts.signal }).then(r => r.content),
    opts.provider,
    undefined,
    opts.signal
  );
}

// ── CRITIC ────────────────────────────────────────────────────────────────────
export async function criticAgent(
  opts: AgentCallOptions,
  researchOutput: string
): Promise<{ critique: string; message: AgentMessage }> {
  const system = `You are NEXUS Critic — an adversarial quality reviewer.
Domain: ${getDomainHint(opts.domain)}

Your ONLY job: find flaws. Be brutal, specific, and constructive.
Challenge: logical errors, unsupported claims, missing evidence, selection bias,
statistical misinterpretation, overly strong conclusions, missing counterarguments.

Output format:
## Critical Flaws
(specific logical or evidentiary problems)

## Unsupported Claims
(claims that need better sourcing)

## Alternative Interpretations
(what else could the evidence mean)

## Severity Rating
(critical/major/minor for each issue)`;

  const prompt = `Original Query: "${opts.query}"

Research to critique:
${researchOutput}

Adversarially challenge every claim. Be specific — cite the exact sentence or paragraph.`;

  const critique = await withRetry(
    () => callLLM({ systemPrompt: system, userPrompt: prompt, provider: opts.provider, model: opts.model, maxTokens: 2500, temperature: 0.15, signal: opts.signal }).then(r => r.content),
    opts.provider,
    undefined,
    opts.signal
  );

  const message: AgentMessage = {
    fromRole: 'critic',
    toRole: 'researcher',
    content: critique,
    messageType: 'challenge',
    timestamp: Date.now(),
    confidence: 0,
  };

  return { critique, message };
}

// ── VERIFIER ──────────────────────────────────────────────────────────────────
export interface VerificationResult {
  verifiedClaims: Array<{ claim: string; verdict: 'verified' | 'disputed' | 'unverifiable'; reasoning: string }>;
  overallVerification: number; // 0-1
  flaggedIssues: string[];
  message: AgentMessage;
}

export async function verifierAgent(
  opts: AgentCallOptions,
  researchOutput: string,
  critique: string
): Promise<VerificationResult> {
  const system = `You are NEXUS Verifier — a fact-checking and consistency specialist.
Domain: ${getDomainHint(opts.domain)}

Your job: independently verify claims in the research. Cross-reference the critique.
Mark each claim as: verified (strong evidence), disputed (contradictory evidence), or unverifiable (insufficient evidence).
Return ONLY valid JSON.`;

  const result = await withRetry(
    () => callLLMJson(
      {
        systemPrompt: system,
        userPrompt: `Query: "${opts.query}"
Research: ${researchOutput.substring(0, 2000)}
Critique: ${critique.substring(0, 1000)}

Return JSON:
{
  "verifiedClaims": [{ "claim": "...", "verdict": "verified|disputed|unverifiable", "reasoning": "..." }],
  "overallVerification": 0.0-1.0,
  "flaggedIssues": ["..."]
}`,
        provider: opts.provider,
        model: opts.model,
        maxTokens: 2000,
        temperature: 0,
        responseFormat: 'json_object',
        signal: opts.signal,
      },
      (raw) => raw as { verifiedClaims: VerificationResult['verifiedClaims']; overallVerification: number; flaggedIssues: string[] }
    ),
    opts.provider,
    undefined,
    opts.signal
  );

  const message: AgentMessage = {
    fromRole: 'verifier',
    toRole: 'synthesizer',
    content: JSON.stringify(result),
    messageType: 'verification',
    timestamp: Date.now(),
    confidence: result.overallVerification,
  };

  return { ...result, message };
}

// ── SYNTHESIZER ───────────────────────────────────────────────────────────────
export interface SynthesisOutput {
  answer: string;
  summary: string;
  keyFindings: string[];
  limitations: string[];
  sources: Array<{ title: string; relevance: number; excerpt?: string }>;
  confidence: number;
}

export async function synthesizerAgent(
  opts: AgentCallOptions,
  research: string,
  critique: string,
  verification: VerificationResult | null,
): Promise<SynthesisOutput> {
  const system = `You are NEXUS Synthesizer — a master research synthesizer.
Domain: ${getDomainHint(opts.domain)}

You receive: (1) research, (2) adversarial critique, (3) verification results.
Produce a definitive, balanced report that:
- Incorporates valid critique points
- Clearly marks disputed vs verified claims
- Provides honest confidence levels
- Cites evidence for each major claim
- Does NOT overstate certainty

Format: structured markdown with Executive Summary, Key Findings, Detailed Analysis, Limitations.`;

  const verificationSummary = verification
    ? `Verification: ${verification.overallVerification.toFixed(2)} score. ${verification.flaggedIssues.length} flagged issues.`
    : '';

  const prompt = `Query: "${opts.query}"

Research:
${research}

Critique:
${critique}

${verificationSummary}

Synthesize into a definitive, calibrated report. Weight critique appropriately.
Be honest about uncertainty. Mark claims as [VERIFIED], [DISPUTED], or [UNVERIFIED] inline.`;

  const answer = await withRetry(
    () => callLLM({ systemPrompt: system, userPrompt: prompt, provider: opts.provider, model: opts.model, maxTokens: 5000, temperature: 0.2, signal: opts.signal }).then(r => r.content),
    opts.provider,
    undefined,
    opts.signal
  );

  // Compute final confidence from verification score
  const baseConf = verification?.overallVerification ?? 0.65;
  const confidence = Math.min(0.97, baseConf);

  return {
    answer,
    summary: extractSummary(answer),
    keyFindings: extractKeyFindings(answer),
    limitations: extractLimitations(answer),
    sources: [],
    confidence,
  };
}

function extractSummary(text: string): string {
  const m = text.match(/#+\s*Executive Summary\s*\n+([\s\S]*?)(?=\n#+|$)/i);
  return m ? m[1].trim().substring(0, 500) : text.split(/\n\n+/)[0]?.trim().substring(0, 400) ?? '';
}

function extractKeyFindings(text: string): string[] {
  const m = text.match(/#+\s*Key Findings\s*\n+([\s\S]*?)(?=\n#+|$)/i);
  if (!m) return [];
  return m[1].split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(l => l.length > 15).slice(0, 6);
}

function extractLimitations(text: string): string[] {
  const m = text.match(/#+\s*Limitations?[\s\S]*?\n+([\s\S]*?)(?=\n#+|$)/i);
  if (!m) return [];
  return m[1].split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(l => l.length > 10).slice(0, 4);
}
