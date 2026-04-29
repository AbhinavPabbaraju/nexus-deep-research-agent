import { v4 as uuidv4 } from 'uuid';
import { buildDAG, topoSort, updateNode } from './dag/builder';
import {
  criticAgent,
  renderCritiqueOutput,
  renderResearchOutput,
  researcherAgent,
  synthesizerAgent,
  verifierAgent,
  type VerificationResult,
} from './roles/agents';
import { evaluateResult } from '@/lib/evaluation/evaluator';
import { extractImprovement, formatImprovementsForPrompt, getImprovements } from '@/lib/memory/self-improvement';
import { logger } from '@/lib/observability/logger';
import { tracer } from '@/lib/observability/tracer';
import type { AgentInput } from './types';
import type {
  AgentFailure,
  AgentMessage,
  CritiqueOutput,
  DomainMode,
  EvaluationResult,
  ExecutionDAG,
  ImprovementRecord,
  PlannerOutput,
  ResearchOutput,
  SourceRef,
  SynthesisOutput,
  V4AgentResult,
  VerifiedClaim,
} from './types-v4';

export interface V4AgentInput extends AgentInput {
  domain: DomainMode;
}

export interface V4Callbacks {
  onStart?: (runId: string) => void;
  onDAGReady?: (dag: ExecutionDAG) => void;
  onNodeStart?: (nodeId: string, role: string, label: string) => void;
  onNodeDone?: (nodeId: string, role: string, output: string, confidence?: number) => void;
  onNodeError?: (nodeId: string, error: string) => void;
  onAgentMessage?: (msg: AgentMessage) => void;
  onEval?: (eval_: EvaluationResult) => void;
  onImprovement?: (rec: ImprovementRecord) => void;
  onToken?: (token: string) => void;
  onDone?: (result: V4AgentResult) => void;
  onError?: (error: string) => void;
}

function makeFailure(error: unknown): AgentFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('CircuitOpen:')) return { code: 'CIRCUIT_OPEN', message, recoverable: true };
  if (/timeout/i.test(message)) return { code: 'PROVIDER_TIMEOUT', message, recoverable: true };
  if (/rate.?limit/i.test(message)) return { code: 'PROVIDER_RATE_LIMIT', message, recoverable: true };
  if (/schema validation failed|parse json/i.test(message)) {
    return { code: 'SCHEMA_VALIDATION_FAILED', message, recoverable: true };
  }
  return { code: 'FATAL', message, recoverable: false };
}

function deterministicPlan(input: V4AgentInput, improvementHint: string): PlannerOutput {
  return {
    objective: input.query,
    assumptions: [
      'Planner control flow is deterministic; LLMs produce bounded JSON inside DAG nodes.',
      'Final synthesis must not promote claims that verifier marked unsupported or contradicted.',
      improvementHint ? 'Historical failure patterns are injected as constraints.' : 'No historical failure hints were available.',
    ],
    tasks: [
      {
        id: 'retrieve-evidence',
        agent: 'retriever',
        instruction: 'Build an evidence pack from documents or external search.',
        dependencies: ['planner'],
        requiredTools: [],
        expectedSchema: 'EvidencePack',
      },
      {
        id: 'research',
        agent: 'researcher',
        instruction: 'Produce claim-level research with confidence and evidence references.',
        dependencies: ['retrieve-evidence', 'memory'],
        requiredTools: [],
        expectedSchema: 'ResearchOutput',
      },
      {
        id: 'critique',
        agent: 'critic',
        instruction: 'Challenge unsupported, biased, or overconfident claims.',
        dependencies: ['research'],
        requiredTools: [],
        expectedSchema: 'CritiqueOutput',
      },
      {
        id: 'verify',
        agent: 'verifier',
        instruction: 'Classify claims as supported, unsupported, contradicted, or uncertain.',
        dependencies: ['research', 'critique'],
        requiredTools: [],
        expectedSchema: 'VerificationResult',
      },
      {
        id: 'synthesize',
        agent: 'synthesizer',
        instruction: 'Produce final answer from supported claims with explicit limitations.',
        dependencies: ['verify'],
        requiredTools: [],
        expectedSchema: 'SynthesisOutput',
      },
    ],
    successCriteria: [
      'Every agent step returns schema-valid JSON.',
      'Every material factual claim has source or uncertainty metadata.',
      'The final answer includes calibrated confidence and limitations.',
    ],
    riskLevel: input.domain === 'medical' || input.domain === 'legal' || input.domain === 'finance' ? 'high' : 'medium',
  };
}

function buildEvidenceContext(input: V4AgentInput, plan: PlannerOutput): string {
  const docHint = input.documentIds?.length
    ? `Document IDs available: ${input.documentIds.join(', ')}`
    : 'No document IDs supplied; use provider knowledge cautiously and label missing sources.';
  return [
    `Objective: ${plan.objective}`,
    `Domain: ${input.domain}`,
    docHint,
    'Evidence policy: attach source references where available; otherwise mark uncertainty explicitly.',
  ].join('\n');
}

function buildMemoryContext(input: V4AgentInput, improvementHint: string): string {
  const memoryHint = input.memoryContextIds?.length
    ? `Memory context IDs: ${input.memoryContextIds.join(', ')}`
    : 'No explicit memory context IDs supplied.';
  return [memoryHint, improvementHint].filter(Boolean).join('\n\n');
}

function collectSources(synthesis: SynthesisOutput | null, verifiedClaims: VerifiedClaim[]): SourceRef[] {
  const seen = new Set<string>();
  const sources = [...(synthesis?.sources ?? []), ...verifiedClaims.flatMap((claim) => claim.sources)];
  return sources.filter((source) => {
    const key = source.url ?? source.documentId ?? source.chunkId ?? source.title ?? JSON.stringify(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runV4AgentLoop(
  input: V4AgentInput,
  callbacks: V4Callbacks = {}
): Promise<V4AgentResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const agentMessages: AgentMessage[] = [];
  const improvements: ImprovementRecord[] = [];
  const failureStates: AgentFailure[] = [];
  let circuitBreaks = 0;

  logger.info({ runId, query: input.query, depth: input.depth, domain: input.domain }, 'V4 agent starting');
  callbacks.onStart?.(runId);

  const span = tracer.startSpan('v4.agent.run', { runId, domain: input.domain });

  try {
    let dag = buildDAG({
      query: input.query,
      depth: input.depth,
      domain: input.domain,
      hasDocuments: (input.documentIds?.length ?? 0) > 0,
      hasMemory: (input.memoryContextIds?.length ?? 0) > 0,
    });
    callbacks.onDAGReady?.(dag);

    const priorImprovements = getImprovements(input.domain, 5);
    const improvementHint = formatImprovementsForPrompt(priorImprovements);
    const plan = deterministicPlan(input, improvementHint);

    const agentOpts = {
      query: input.query,
      domain: input.domain,
      provider: input.provider,
      model: input.model,
      signal: input.abortSignal,
    };

    const runtime: {
      evidenceContext: string;
      memoryContext: string;
      researchOutput: ResearchOutput | null;
      critiqueOutput: CritiqueOutput | null;
      verificationResult: VerificationResult | null;
      synthesisResult: SynthesisOutput | null;
    } = {
      evidenceContext: '',
      memoryContext: '',
      researchOutput: null,
      critiqueOutput: null,
      verificationResult: null,
      synthesisResult: null,
    };

    for (const batch of topoSort(dag)) {
      if (input.abortSignal?.aborted) break;

      const batchResults = await Promise.allSettled(batch.map(async (nodeId) => {
        const node = dag.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`Unknown node ${nodeId}`);

        callbacks.onNodeStart?.(nodeId, node.role, node.label);
        const nodeStart = Date.now();
        dag = updateNode(dag, nodeId, { status: 'running', startTime: nodeStart });

        try {
          let output = '';
          let confidence: number | undefined;

          switch (node.role) {
            case 'planner':
              output = JSON.stringify(plan, null, 2);
              confidence = 1;
              break;

            case 'retriever':
              runtime.evidenceContext = buildEvidenceContext(input, plan);
              output = runtime.evidenceContext;
              confidence = input.documentIds?.length ? 0.85 : 0.55;
              break;

            case 'memory':
              runtime.memoryContext = buildMemoryContext(input, improvementHint);
              output = runtime.memoryContext || 'No durable memory context supplied.';
              confidence = input.memoryContextIds?.length ? 0.75 : 0.35;
              break;

            case 'researcher':
              runtime.researchOutput = await researcherAgent({
                ...agentOpts,
                context: [runtime.evidenceContext, runtime.memoryContext].filter(Boolean).join('\n\n'),
              });
              output = renderResearchOutput(runtime.researchOutput);
              confidence = Math.max(...runtime.researchOutput.findings.map((finding) => finding.confidence), 0.5);
              break;

            case 'critic': {
              if (!runtime.researchOutput) throw new Error('Research output missing before critic');
              const { critique, message } = await criticAgent({
                ...agentOpts,
                context: [runtime.evidenceContext, runtime.memoryContext].filter(Boolean).join('\n\n'),
              }, runtime.researchOutput);
              runtime.critiqueOutput = critique;
              output = renderCritiqueOutput(critique);
              confidence = message.confidence;
              agentMessages.push(message);
              callbacks.onAgentMessage?.(message);
              break;
            }

            case 'verifier':
              if (!runtime.researchOutput) throw new Error('Research output missing before verifier');
              runtime.verificationResult = await verifierAgent({
                ...agentOpts,
                context: [runtime.evidenceContext, runtime.memoryContext].filter(Boolean).join('\n\n'),
              }, runtime.researchOutput, runtime.critiqueOutput);
              output = JSON.stringify(runtime.verificationResult.verifiedClaims.slice(0, 5), null, 2);
              confidence = runtime.verificationResult.overallVerification;
              agentMessages.push(runtime.verificationResult.message);
              callbacks.onAgentMessage?.(runtime.verificationResult.message);
              break;

            case 'synthesizer':
              if (!runtime.researchOutput) throw new Error('Research output missing before synthesizer');
              runtime.synthesisResult = await synthesizerAgent({
                ...agentOpts,
                context: [runtime.evidenceContext, runtime.memoryContext].filter(Boolean).join('\n\n'),
              }, runtime.researchOutput, runtime.critiqueOutput, runtime.verificationResult);
              output = runtime.synthesisResult.answer;
              confidence = runtime.synthesisResult.confidence;
              break;
          }

          dag = updateNode(dag, nodeId, {
            status: 'done',
            endTime: Date.now(),
            output: output.substring(0, 700),
            confidence,
            metrics: {
              latencyMs: Date.now() - nodeStart,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUsd: 0,
              cacheHit: false,
              provider: input.provider,
              model: input.model,
            },
          });
          callbacks.onNodeDone?.(nodeId, node.role, output, confidence);
          logger.info({ runId, nodeId, role: node.role, latencyMs: Date.now() - nodeStart, confidence }, 'DAG node complete');
          return { nodeId, ok: true };
        } catch (error) {
          const failure = makeFailure(error);
          if (failure.code === 'CIRCUIT_OPEN') circuitBreaks++;
          failureStates.push(failure);

          const degraded = node.role === 'retriever' || node.role === 'memory';
          dag = updateNode(dag, nodeId, {
            status: degraded ? 'degraded' : 'error',
            endTime: Date.now(),
            error: failure.message,
            failure,
          });
          callbacks.onNodeError?.(nodeId, failure.message);
          logger.error({ runId, nodeId, role: node.role, failure }, 'DAG node failed');
          return { nodeId, ok: degraded, failure };
        }
      }));

      const hardFailure = batchResults.some((result) =>
        result.status === 'fulfilled' && !result.value.ok &&
        !result.value.failure?.recoverable
      );
      if (hardFailure) break;
    }

    const verifiedClaims = runtime.verificationResult?.verifiedClaims ?? [];
    const finalAnswer = runtime.synthesisResult?.answer ?? (runtime.researchOutput ? renderResearchOutput(runtime.researchOutput) : 'Research could not be completed.');
    const finalConfidence = runtime.synthesisResult?.confidence ?? runtime.verificationResult?.overallVerification ?? 0.45;

    const evaluation = await evaluateResult({
      runId,
      query: input.query,
      answer: finalAnswer,
      confidence: finalConfidence,
      domain: input.domain,
    });
    callbacks.onEval?.(evaluation);
    span.setAttribute('eval.overallScore', evaluation.overallScore);

    if (evaluation.overallScore < 0.7) {
      const improvement = await extractImprovement(input.query, finalAnswer, evaluation, input.domain);
      if (improvement) {
        improvements.push(improvement);
        callbacks.onImprovement?.(improvement);
      }
    }

    const result: V4AgentResult = {
      runId,
      query: input.query,
      domain: input.domain,
      answer: finalAnswer,
      summary: runtime.synthesisResult?.summary ?? finalAnswer.substring(0, 300),
      keyFindings: runtime.synthesisResult?.keyFindings ?? [],
      limitations: [
        ...(runtime.synthesisResult?.limitations ?? []),
        ...failureStates.map((failure) => `${failure.code}: ${failure.message}`),
      ],
      sources: collectSources(runtime.synthesisResult, verifiedClaims),
      verifiedClaims,
      failureStates,
      confidence: Math.round(finalConfidence * 100),
      evaluation,
      dag,
      agentMessages,
      improvements,
      totalTokens: 0,
      totalCostUsd: 0,
      totalLatencyMs: Date.now() - startTime,
      provider: input.provider,
      model: input.model,
      depth: input.depth,
      circuitBreaks,
      timestamp: Date.now(),
    };

    span.setStatus('success');
    callbacks.onDone?.(result);
    logger.info({ runId, confidence: result.confidence, latencyMs: result.totalLatencyMs }, 'V4 agent complete');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    span.setStatus('error', message);
    callbacks.onError?.(message);
    throw error;
  } finally {
    span.end();
  }
}
