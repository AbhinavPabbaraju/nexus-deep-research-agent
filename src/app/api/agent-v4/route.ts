// ─── src/app/api/agent-v4/route.ts ───────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runV4AgentLoop } from '@/lib/agent/orchestrator-v4';
import { saveMemory } from '@/lib/db/memory';
import type { V4SSEEvent } from '@/lib/agent/types-v4';
import { logger } from '@/lib/observability/logger';

const RequestSchema = z.object({
  query: z.string().min(3).max(2000),
  depth: z.enum(['quick', 'standard', 'deep', 'exhaustive']).default('standard'),
  domain: z.enum(['general', 'finance', 'technical', 'medical', 'legal', 'scientific']).default('general'),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'nvidia']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-5'),
  userId: z.string().default('anonymous'),
  documentIds: z.array(z.string()).optional(),
  memoryContextIds: z.array(z.string()).optional(),
  saveToMemory: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const input = parsed.data;
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: V4SSEEvent) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch {}
      }

      try {
        await runV4AgentLoop(
          { ...input, maxTokens: 6000, temperature: 0.3, abortSignal: abortController.signal },
          {
            onStart: (runId) => emit({ type: 'start', timestamp: Date.now(), data: { runId } }),
            onDAGReady: (dag) => emit({ type: 'dag_ready', timestamp: Date.now(), data: dag }),
            onNodeStart: (nodeId, role, label) => emit({ type: 'node_start', timestamp: Date.now(), data: { nodeId, role, label } }),
            onNodeDone: (nodeId, role, output, confidence) => emit({ type: 'node_done', timestamp: Date.now(), data: { nodeId, role, output: output.substring(0, 200), confidence } }),
            onNodeError: (nodeId, error) => emit({ type: 'node_error', timestamp: Date.now(), data: { nodeId, error } }),
            onAgentMessage: (msg) => emit({ type: 'agent_message', timestamp: Date.now(), data: msg }),
            onEval: (eval_) => emit({ type: 'eval', timestamp: Date.now(), data: eval_ }),
            onImprovement: (rec) => emit({ type: 'improvement', timestamp: Date.now(), data: rec }),
            onDone: async (result) => {
              if (input.saveToMemory) {
                // Save abbreviated result to memory
                await saveMemory({
                  runId: result.runId,
                  query: result.query,
                  answer: result.answer,
                  summary: result.summary,
                  keyFindings: result.keyFindings,
                  limitations: result.limitations,
                  confidence: result.confidence / 100,
                  provider: result.provider as 'anthropic' | 'openai' | 'gemini' | 'nvidia',
                  model: result.model,
                  depth: result.depth as 'quick' | 'standard' | 'deep' | 'exhaustive',
                  totalTokens: result.totalTokens,
                  totalLatencyMs: result.totalLatencyMs,
                  totalCostUsd: result.totalCostUsd,
                  trace: [],
                  stepsExecuted: result.dag.nodes.length,
                  loopCount: 1,
                  timestamp: result.timestamp,
                }, input.userId);
              }
              emit({ type: 'done', timestamp: Date.now(), data: result });
            },
            onError: (error) => emit({ type: 'error', timestamp: Date.now(), error }),
          }
        );
      } catch (err: unknown) {
        emit({ type: 'error', timestamp: Date.now(), error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
    cancel() { abortController.abort(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
