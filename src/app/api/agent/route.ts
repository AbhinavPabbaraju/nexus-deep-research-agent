// ─── src/app/api/agent/route.ts ───────────────────────────────────────────────
// Streaming SSE endpoint. Every agent event is pushed to the client in real time.
// Client subscribes with EventSource or fetch + ReadableStream.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgentLoop } from '@/lib/agent/orchestrator';
import { saveMemory } from '@/lib/db/memory';
import type { SSEEvent, AgentInput } from '@/lib/agent/types';
import { logger } from '@/lib/observability/logger';

const RequestSchema = z.object({
  query: z.string().min(3).max(2000),
  depth: z.enum(['quick', 'standard', 'deep', 'exhaustive']).default('standard'),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'nvidia']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-5'),
  maxTokens: z.number().int().min(500).max(16000).default(6000),
  temperature: z.number().min(0).max(1).default(0.3),
  userId: z.string().default('anonymous'),
  documentIds: z.array(z.string()).optional(),
  memoryContextIds: z.array(z.string()).optional(),
  saveToMemory: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const input = parsed.data;
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  // Abort agent when client disconnects
  req.signal.addEventListener('abort', () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: SSEEvent) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream already closed
        }
      }

      try {
        const agentInput: AgentInput = {
          ...input,
          abortSignal: abortController.signal,
        };

        const result = await runAgentLoop(agentInput, {
          onStart: (runId) => emit({ type: 'start', timestamp: Date.now(), data: { runId } }),
          onPlanReady: (plan) => emit({ type: 'plan', timestamp: Date.now(), data: plan }),
          onLoopStart: (loopCount) => emit({ type: 'loop_start', timestamp: Date.now(), data: { loopCount } }),
          onStepStart: (step) => emit({ type: 'step_start', timestamp: Date.now(), data: step }),
          onStepDone: (step) => emit({ type: 'step_done', timestamp: Date.now(), data: step }),
          onStepError: (stepId, error) => emit({ type: 'step_error', timestamp: Date.now(), data: { stepId, error } }),
          onEval: (eval_) => emit({ type: 'eval', timestamp: Date.now(), data: eval_ }),
          onToken: (token) => emit({ type: 'token', timestamp: Date.now(), data: { token } }),
          onDone: async (finalResult) => {
            // Auto-save to memory
            if (input.saveToMemory) {
              const memId = await saveMemory(finalResult, input.userId);
              emit({ type: 'done', timestamp: Date.now(), data: { ...finalResult, memoryId: memId } });
            } else {
              emit({ type: 'done', timestamp: Date.now(), data: finalResult });
            }
          },
          onError: (error) => emit({ type: 'error', timestamp: Date.now(), error }),
        });

        logger.info({ runId: result.runId }, 'Stream complete');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', timestamp: Date.now(), error: msg });
        logger.error({ err }, 'Agent stream error');
      } finally {
        controller.close();
      }
    },

    cancel() {
      abortController.abort();
    },
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
