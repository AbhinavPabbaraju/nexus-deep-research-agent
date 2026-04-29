// ─── src/hooks/useAgent.ts ────────────────────────────────────────────────────
// Subscribes to the /api/agent SSE stream. Exposes typed state for UI.
'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  AgentResult,
  EvalResult,
  PlanResult,
  StepResult,
  SSEEventType,
} from '@/lib/agent/types';

export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'evaluating'
  | 'done'
  | 'error'
  | 'aborted';

export interface AgentUIState {
  status: AgentStatus;
  runId: string | null;
  plan: PlanResult | null;
  steps: StepResult[];
  currentStep: Partial<StepResult> | null;
  evaluations: EvalResult[];
  loopCount: number;
  result: AgentResult | null;
  streamingToken: string;
  error: string | null;
  confidence: number;
}

const initialState: AgentUIState = {
  status: 'idle',
  runId: null,
  plan: null,
  steps: [],
  currentStep: null,
  evaluations: [],
  loopCount: 0,
  result: null,
  streamingToken: '',
  error: null,
  confidence: 0,
};

export interface RunAgentOptions {
  query: string;
  depth?: 'quick' | 'standard' | 'deep' | 'exhaustive';
  provider?: 'anthropic' | 'openai' | 'gemini' | 'nvidia';
  model?: string;
  userId?: string;
  documentIds?: string[];
  memoryContextIds?: string[];
  saveToMemory?: boolean;
}

export function useAgent() {
  const [state, setState] = useState<AgentUIState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((patch: Partial<AgentUIState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const run = useCallback(async (opts: RunAgentOptions) => {
    // Cancel any in-progress run
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState({ ...initialState, status: 'planning' });

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: opts.query,
          depth: opts.depth ?? 'standard',
          provider: opts.provider ?? 'anthropic',
          model: opts.model ?? 'claude-sonnet-4-5',
          userId: opts.userId ?? 'anonymous',
          documentIds: opts.documentIds,
          memoryContextIds: opts.memoryContextIds,
          saveToMemory: opts.saveToMemory ?? true,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type: SSEEventType; data?: unknown; error?: string; timestamp: number };
            handleEvent(event.type, event.data, event.error);
          } catch {
            // Malformed SSE line — skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        update({ status: 'aborted' });
      } else {
        update({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleEvent(type: SSEEventType, data: unknown, error?: string) {
    switch (type) {
      case 'start':
        update({ runId: (data as { runId: string }).runId, status: 'planning' });
        break;

      case 'plan':
        update({ plan: data as PlanResult, status: 'running' });
        break;

      case 'loop_start':
        update({ loopCount: (data as { loopCount: number }).loopCount });
        break;

      case 'step_start':
        update({ currentStep: data as Partial<StepResult>, status: 'running' });
        break;

      case 'step_done':
        setState((prev) => ({
          ...prev,
          steps: [...prev.steps, data as StepResult],
          currentStep: null,
        }));
        break;

      case 'step_error':
        update({ status: 'running' }); // continue despite step errors
        break;

      case 'eval':
        setState((prev) => ({
          ...prev,
          evaluations: [...prev.evaluations, data as EvalResult],
          confidence: Math.round((data as EvalResult).confidence * 100),
          status: 'evaluating',
        }));
        break;

      case 'token':
        setState((prev) => ({
          ...prev,
          streamingToken: prev.streamingToken + (data as { token: string }).token,
        }));
        break;

      case 'done':
        update({ result: data as AgentResult, status: 'done', currentStep: null });
        break;

      case 'error':
        update({ status: 'error', error: error ?? 'Unknown error' });
        break;
    }
  }

  const abort = useCallback(() => {
    abortRef.current?.abort();
    update({ status: 'aborted' });
  }, [update]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initialState);
  }, []);

  return { state, run, abort, reset };
}
