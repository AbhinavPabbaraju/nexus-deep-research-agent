// ─── src/lib/agent/orchestrator-v4.ts ────────────────────────────────────────
// V4 multi-agent orchestrator: DAG execution, adversarial agents,
// circuit breakers, evaluation, self-improvement, domain modes.

import { v4 as uuidv4 } from 'uuid';
import { buildDAG, topoSort, updateNode } from './dag/builder';
import { researcherAgent, criticAgent, verifierAgent, synthesizerAgent } from './roles/agents';
import { evaluateResult } from '@/lib/evaluation/evaluator';
import { extractImprovement, getImprovements, formatImprovementsForPrompt } from '@/lib/memory/self-improvement';
import { getAllBreakerStatuses } from '@/lib/reliability/circuit-breaker';
import { logger } from '@/lib/observability/logger';
import { tracer } from '@/lib/observability/tracer';
import type { AgentInput } from './types';
import type {
  V4AgentResult, V4SSEEvent, DomainMode, ExecutionDAG,
  AgentMessage, EvaluationResult, ImprovementRecord,
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

export async function runV4AgentLoop(
  input: V4AgentInput,
  callbacks: V4Callbacks = {}
): Promise<V4AgentResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const agentMessages: AgentMessage[] = [];
  const improvements: ImprovementRecord[] = [];
  let circuitBreaks = 0;

  logger.info({ runId, query: input.query, depth: input.depth, domain: input.domain }, 'V4 agent starting');
  callbacks.onStart?.(runId);

  const span = tracer.startSpan('v4.agent.run', { runId, domain: input.domain });

  try {
    // ── 1. Build execution DAG ────────────────────────────────────────────────
    let dag = buildDAG({
      query: input.query,
      depth: input.depth,
      domain: input.domain,
      hasDocuments: (input.documentIds?.length ?? 0) > 0,
      hasMemory: (input.memoryContextIds?.length ?? 0) > 0,
    });
    callbacks.onDAGReady?.(dag);
    logger.info({ nodeCount: dag.nodes.length, estimatedMs: dag.estimatedDurationMs }, 'DAG built');

    // ── 2. Load prior improvements for this domain ─────────────────────────────
    const priorImprovements = getImprovements(input.domain, 5);
    const improvementHint = formatImprovementsForPrompt(priorImprovements);

    // ── 3. Execute DAG via topological batches ────────────────────────────────
    const batches = topoSort(dag);
    const agentOpts = {
      query: input.query,
      domain: input.domain,
      provider: input.provider,
      model: input.model,
      signal: input.abortSignal,
    };

    let researchOutput = '';
    let critiqueOutput = '';
    let verificationResult = null;
    let synthesisResult = null;

    for (const batch of batches) {
      if (input.abortSignal?.aborted) break;

      // Execute batch (parallel if multiple nodes)
      const batchResults = await Promise.allSettled(
        batch.map(async (nodeId) => {
          const node = dag.nodes.find((n) => n.id === nodeId)!;
          callbacks.onNodeStart?.(nodeId, node.role, node.label);
          dag = updateNode(dag, nodeId, { status: 'running', startTime: Date.now() });

          try {
            let output = '';
            let confidence: number | undefined;

            const context = researchOutput + (critiqueOutput ? `\n\nCritique:\n${critiqueOutput}` : '');

            switch (node.role) {
              case 'planner':
                // Planner is embedded in context-building; emit a synthetic output
                output = `Research plan for: "${input.query}"\nDomain: ${input.domain}\nDepth: ${input.depth}${improvementHint}`;
                break;

              case 'researcher':
                output = await researcherAgent({ ...agentOpts, context: improvementHint });
                researchOutput = output;
                break;

              case 'critic': {
                const { critique, message } = await criticAgent(
                  { ...agentOpts, context },
                  researchOutput
                );
                critiqueOutput = critique;
                output = critique;
                agentMessages.push(message);
                callbacks.onAgentMessage?.(message);
                break;
              }

              case 'verifier': {
                const vResult = await verifierAgent(
                  { ...agentOpts, context },
                  researchOutput,
                  critiqueOutput
                );
                verificationResult = vResult;
                output = JSON.stringify(vResult.verifiedClaims.slice(0, 3));
                confidence = vResult.overallVerification;
                agentMessages.push(vResult.message);
                callbacks.onAgentMessage?.(vResult.message);
                break;
              }

              case 'synthesizer': {
                synthesisResult = await synthesizerAgent(
                  { ...agentOpts, context },
                  researchOutput,
                  critiqueOutput,
                  verificationResult,
                );
                output = synthesisResult.answer;
                confidence = synthesisResult.confidence;
                break;
              }
            }

            dag = updateNode(dag, nodeId, {
              status: 'done',
              endTime: Date.now(),
              output: output.substring(0, 500),
              confidence,
            });
            callbacks.onNodeDone?.(nodeId, node.role, output, confidence);
            return { nodeId, output };
          } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            if (error.startsWith('CircuitOpen:')) circuitBreaks++;
            dag = updateNode(dag, nodeId, { status: 'error', endTime: Date.now(), error });
            callbacks.onNodeError?.(nodeId, error);
            logger.error({ nodeId, role: node.role, error }, 'Node execution failed');
            return { nodeId, output: '', error };
          }
        })
      );

      // Check for critical failures (synthesizer failed = unrecoverable)
      const synthFailed = batchResults.some((r) =>
        r.status === 'fulfilled' && r.value.error &&
        dag.nodes.find((n) => n.id === r.value.nodeId)?.role === 'synthesizer'
      );
      if (synthFailed) {
        logger.warn({ runId }, 'Synthesizer failed — using research output as answer');
      }
    }

    // ── 4. Build final answer ─────────────────────────────────────────────────
    const finalAnswer = synthesisResult?.answer ?? researchOutput ?? 'Research could not be completed.';
    const finalConfidence = synthesisResult?.confidence ?? 0.5;

    // ── 5. Evaluate output ────────────────────────────────────────────────────
    const evaluation = await evaluateResult({
      runId,
      query: input.query,
      answer: finalAnswer,
      confidence: finalConfidence,
      domain: input.domain,
    });
    callbacks.onEval?.(evaluation);
    span.setAttribute('eval.overallScore', evaluation.overallScore);

    // ── 6. Self-improvement ───────────────────────────────────────────────────
    if (evaluation.overallScore < 0.7) {
      const improvement = await extractImprovement(input.query, finalAnswer, evaluation, input.domain);
      if (improvement) {
        improvements.push(improvement);
        callbacks.onImprovement?.(improvement);
      }
    }

    // ── 7. Assemble result ────────────────────────────────────────────────────
    const result: V4AgentResult = {
      runId,
      query: input.query,
      domain: input.domain,
      answer: finalAnswer,
      summary: synthesisResult?.summary ?? finalAnswer.substring(0, 300),
      keyFindings: synthesisResult?.keyFindings ?? [],
      limitations: synthesisResult?.limitations ?? [],
      sources: synthesisResult?.sources ?? [],
      confidence: Math.round(finalConfidence * 100),
      evaluation,
      dag,
      agentMessages,
      improvements,
      totalTokens: 0, // tracked in normalizer
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
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    span.setStatus('error', error);
    callbacks.onError?.(error);
    throw err;
  } finally {
    span.end();
  }
}
