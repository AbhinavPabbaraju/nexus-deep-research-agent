import { z } from 'zod';
import { callLLMJson } from '@/lib/providers/normalizer';
import {
  DOMAIN_CONFIGS,
  type AgentMessage,
  type CritiqueOutput,
  type DomainMode,
  type ResearchOutput,
  type SourceRef,
  type SynthesisOutput,
  type VerifiedClaim,
} from '@/lib/agent/types-v4';
import { withRetry } from '@/lib/reliability/circuit-breaker';
import type { Provider } from '@/lib/agent/types';

interface AgentCallOptions {
  query: string;
  context: string;
  domain: DomainMode;
  provider: Provider;
  model: string;
  signal?: AbortSignal;
}

const SourceRefSchema = z.object({
  documentId: z.string().optional(),
  url: z.string().optional(),
  chunkId: z.string().optional(),
  title: z.string().optional(),
  quote: z.string().optional(),
  relevanceScore: z.number().min(0).max(1),
});

const ResearchOutputSchema = z.object({
  findings: z.array(z.object({
    claim: z.string().min(5),
    confidence: z.number().min(0).max(1),
    evidence: z.array(SourceRefSchema).default([]),
    uncertainty: z.string().default(''),
  })).min(1).max(12),
  quantitativeData: z.array(z.string()).default([]),
  counterpoints: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  recommendedNextSteps: z.array(z.string()).default([]),
});

const CritiqueOutputSchema = z.object({
  criticalFlaws: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  alternativeInterpretations: z.array(z.string()).default([]),
  severity: z.enum(['minor', 'major', 'critical']),
});

const VerificationResultSchema = z.object({
  verifiedClaims: z.array(z.object({
    claim: z.string(),
    verdict: z.enum(['supported', 'unsupported', 'contradicted', 'uncertain']),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    sources: z.array(SourceRefSchema).default([]),
  })).default([]),
  overallVerification: z.number().min(0).max(1),
  flaggedIssues: z.array(z.string()).default([]),
});

const SynthesisOutputSchema = z.object({
  answer: z.string().min(80),
  summary: z.string().min(20).max(700),
  keyFindings: z.array(z.string()).min(1).max(8),
  limitations: z.array(z.string()).default([]),
  sources: z.array(SourceRefSchema).default([]),
  confidence: z.number().min(0).max(1),
});

function parseWithSchema<T>(schema: z.ZodType<T>, label: string): (raw: unknown) => T {
  return (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${label} schema validation failed: ${parsed.error.message}`);
    }
    return parsed.data;
  };
}

function parseResearch(raw: unknown): ResearchOutput {
  const parsed = ResearchOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`ResearchOutput schema validation failed: ${parsed.error.message}`);
  return {
    findings: parsed.data.findings.map((finding) => ({
      claim: finding.claim,
      confidence: finding.confidence,
      evidence: finding.evidence ?? [],
      uncertainty: finding.uncertainty ?? '',
    })),
    quantitativeData: parsed.data.quantitativeData ?? [],
    counterpoints: parsed.data.counterpoints ?? [],
    gaps: parsed.data.gaps ?? [],
    recommendedNextSteps: parsed.data.recommendedNextSteps ?? [],
  };
}

function parseCritique(raw: unknown): CritiqueOutput {
  const parsed = CritiqueOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`CritiqueOutput schema validation failed: ${parsed.error.message}`);
  return {
    criticalFlaws: parsed.data.criticalFlaws ?? [],
    unsupportedClaims: parsed.data.unsupportedClaims ?? [],
    alternativeInterpretations: parsed.data.alternativeInterpretations ?? [],
    severity: parsed.data.severity,
  };
}

function parseVerification(raw: unknown): Omit<VerificationResult, 'message'> {
  const parsed = VerificationResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`VerificationResult schema validation failed: ${parsed.error.message}`);
  return {
    verifiedClaims: (parsed.data.verifiedClaims ?? []).map((claim) => ({
      claim: claim.claim,
      verdict: claim.verdict,
      confidence: claim.confidence,
      reasoning: claim.reasoning,
      sources: claim.sources ?? [],
    })),
    overallVerification: parsed.data.overallVerification,
    flaggedIssues: parsed.data.flaggedIssues ?? [],
  };
}

function parseSynthesis(raw: unknown): SynthesisOutput {
  const parsed = SynthesisOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`SynthesisOutput schema validation failed: ${parsed.error.message}`);
  return {
    answer: parsed.data.answer,
    summary: parsed.data.summary,
    keyFindings: parsed.data.keyFindings,
    limitations: parsed.data.limitations ?? [],
    sources: parsed.data.sources ?? [],
    confidence: parsed.data.confidence,
  };
}

function getDomainHint(domain: DomainMode): string {
  return DOMAIN_CONFIGS[domain].systemHint;
}

function formatSources(sources: SourceRef[]): string {
  if (sources.length === 0) return 'No explicit source attached';
  return sources.map((source) => {
    const label = source.title ?? source.url ?? source.documentId ?? source.chunkId ?? 'source';
    return `${label} (${Math.round(source.relevanceScore * 100)}%)`;
  }).join('; ');
}

export function renderResearchOutput(output: ResearchOutput): string {
  const findings = output.findings.map((finding, idx) =>
    `${idx + 1}. ${finding.claim} [confidence ${Math.round(finding.confidence * 100)}%]\nEvidence: ${formatSources(finding.evidence)}\nUncertainty: ${finding.uncertainty || 'not specified'}`
  ).join('\n\n');

  return [
    '## Research Findings',
    findings,
    output.quantitativeData.length ? `## Quantitative Data\n${output.quantitativeData.map((x) => `- ${x}`).join('\n')}` : '',
    output.counterpoints.length ? `## Counterpoints\n${output.counterpoints.map((x) => `- ${x}`).join('\n')}` : '',
    output.gaps.length ? `## Gaps\n${output.gaps.map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function renderCritiqueOutput(output: CritiqueOutput): string {
  return [
    `Severity: ${output.severity}`,
    output.criticalFlaws.length ? `Critical flaws:\n${output.criticalFlaws.map((x) => `- ${x}`).join('\n')}` : '',
    output.unsupportedClaims.length ? `Unsupported claims:\n${output.unsupportedClaims.map((x) => `- ${x}`).join('\n')}` : '',
    output.alternativeInterpretations.length ? `Alternative interpretations:\n${output.alternativeInterpretations.map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function researcherAgent(opts: AgentCallOptions): Promise<ResearchOutput> {
  const system = `You are NEXUS Researcher.
Domain context: ${getDomainHint(opts.domain)}

Return only JSON matching this contract:
{
  "findings": [{"claim": string, "confidence": number, "evidence": [{"title"?: string, "url"?: string, "documentId"?: string, "chunkId"?: string, "quote"?: string, "relevanceScore": number}], "uncertainty": string}],
  "quantitativeData": string[],
  "counterpoints": string[],
  "gaps": string[],
  "recommendedNextSteps": string[]
}

Every major claim needs evidence or explicit uncertainty. Do not hide weak evidence.`;

  const prompt = `Query: ${opts.query}
Evidence and prior context:
${opts.context || 'None'}

Produce calibrated research. Prefer specific claims over broad prose.`;

  return withRetry(
    () => callLLMJson(
      {
        systemPrompt: system,
        userPrompt: prompt,
        provider: opts.provider,
        model: opts.model,
        maxTokens: 3500,
        temperature: 0.15,
        idempotencyKey: `${opts.query}:researcher`,
        schemaVersion: 'ResearchOutput.v1',
        signal: opts.signal,
      },
      parseResearch
    ),
    opts.provider,
    undefined,
    opts.signal
  );
}

export async function criticAgent(
  opts: AgentCallOptions,
  researchOutput: ResearchOutput
): Promise<{ critique: CritiqueOutput; message: AgentMessage }> {
  const system = `You are NEXUS Critic, an adversarial reviewer.
Domain context: ${getDomainHint(opts.domain)}

Return only JSON matching:
{
  "criticalFlaws": string[],
  "unsupportedClaims": string[],
  "alternativeInterpretations": string[],
  "severity": "minor" | "major" | "critical"
}

Challenge evidence, logic, statistics, missing counterarguments, and overstated confidence.`;

  const critique = await withRetry(
    () => callLLMJson(
      {
        systemPrompt: system,
        userPrompt: `Query: ${opts.query}\n\nResearch JSON:\n${JSON.stringify(researchOutput).slice(0, 6000)}`,
        provider: opts.provider,
        model: opts.model,
        maxTokens: 1800,
        temperature: 0,
        idempotencyKey: `${opts.query}:critic:${JSON.stringify(researchOutput).length}`,
        schemaVersion: 'CritiqueOutput.v1',
        signal: opts.signal,
      },
      parseCritique
    ),
    opts.provider,
    undefined,
    opts.signal
  );

  return {
    critique,
    message: {
      fromRole: 'critic',
      toRole: 'researcher',
      content: renderCritiqueOutput(critique),
      messageType: 'challenge',
      timestamp: Date.now(),
      confidence: critique.severity === 'critical' ? 0.9 : critique.severity === 'major' ? 0.7 : 0.45,
    },
  };
}

export interface VerificationResult {
  verifiedClaims: VerifiedClaim[];
  overallVerification: number;
  flaggedIssues: string[];
  message: AgentMessage;
}

export async function verifierAgent(
  opts: AgentCallOptions,
  researchOutput: ResearchOutput,
  critique: CritiqueOutput | null
): Promise<VerificationResult> {
  const system = `You are NEXUS Verifier.
Domain context: ${getDomainHint(opts.domain)}

Return only JSON. Mark each important claim as supported, unsupported, contradicted, or uncertain.
Do not mark unsupported claims as supported. Use source references from the research where possible.`;

  const result = await withRetry(
    () => callLLMJson(
      {
        systemPrompt: system,
        userPrompt: `Query: ${opts.query}
Research JSON:
${JSON.stringify(researchOutput).slice(0, 5000)}

Critique JSON:
${JSON.stringify(critique ?? {}).slice(0, 2500)}

Return:
{
  "verifiedClaims": [{"claim": string, "verdict": "supported|unsupported|contradicted|uncertain", "confidence": number, "reasoning": string, "sources": []}],
  "overallVerification": number,
  "flaggedIssues": string[]
}`,
        provider: opts.provider,
        model: opts.model,
        maxTokens: 2200,
        temperature: 0,
        idempotencyKey: `${opts.query}:verifier`,
        schemaVersion: 'VerificationResult.v1',
        signal: opts.signal,
      },
      parseVerification
    ),
    opts.provider,
    undefined,
    opts.signal
  );

  return {
    ...result,
    message: {
      fromRole: 'verifier',
      toRole: 'synthesizer',
      content: JSON.stringify(result),
      messageType: 'verification',
      timestamp: Date.now(),
      confidence: result.overallVerification,
    },
  };
}

export async function synthesizerAgent(
  opts: AgentCallOptions,
  research: ResearchOutput,
  critique: CritiqueOutput | null,
  verification: VerificationResult | null,
): Promise<SynthesisOutput> {
  const supportedClaims = verification?.verifiedClaims.filter((claim) => claim.verdict === 'supported') ?? [];
  const blockedClaims = verification?.verifiedClaims.filter((claim) => claim.verdict !== 'supported') ?? [];

  const system = `You are NEXUS Synthesizer.
Domain context: ${getDomainHint(opts.domain)}

Return only JSON matching:
{
  "answer": string,
  "summary": string,
  "keyFindings": string[],
  "limitations": string[],
  "sources": [],
  "confidence": number
}

Only promote supported claims as key findings. Mention uncertain, unsupported, or contradicted claims in limitations.`;

  return withRetry(
    () => callLLMJson(
      {
        systemPrompt: system,
        userPrompt: `Query: ${opts.query}

Research JSON:
${JSON.stringify(research).slice(0, 6000)}

Critique JSON:
${JSON.stringify(critique ?? {}).slice(0, 2500)}

Supported claims:
${JSON.stringify(supportedClaims).slice(0, 3500)}

Claims that must not be overstated:
${JSON.stringify(blockedClaims).slice(0, 2500)}

Produce the final calibrated answer.`,
        provider: opts.provider,
        model: opts.model,
        maxTokens: 4000,
        temperature: 0.1,
        idempotencyKey: `${opts.query}:synthesizer`,
        schemaVersion: 'SynthesisOutput.v1',
        signal: opts.signal,
      },
      parseSynthesis
    ),
    opts.provider,
    undefined,
    opts.signal
  );
}
