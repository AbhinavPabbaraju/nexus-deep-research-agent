// ─── src/hooks/useAgentV4.ts ──────────────────────────────────────────────────
'use client';

import { useState, useCallback, useRef } from 'react';
import type { ExecutionDAG, AgentMessage, EvaluationResult, ImprovementRecord, V4AgentResult, DomainMode } from '@/lib/agent/types-v4';

export type V4Status = 'idle' | 'planning' | 'running' | 'evaluating' | 'done' | 'error' | 'aborted';

export interface V4UIState {
  status: V4Status;
  runId: string | null;
  dag: ExecutionDAG | null;
  activeNodeId: string | null;
  agentMessages: AgentMessage[];
  evaluation: EvaluationResult | null;
  improvements: ImprovementRecord[];
  result: V4AgentResult | null;
  error: string | null;
  circuitBreaks: number;
  elapsedMs: number;
}

const initial: V4UIState = {
  status: 'idle', runId: null, dag: null, activeNodeId: null,
  agentMessages: [], evaluation: null, improvements: [],
  result: null, error: null, circuitBreaks: 0, elapsedMs: 0,
};

export interface RunV4Options {
  query: string;
  depth?: 'quick' | 'standard' | 'deep' | 'exhaustive';
  domain?: DomainMode;
  provider?: string;
  model?: string;
  userId?: string;
  documentIds?: string[];
  memoryContextIds?: string[];
}

export function useAgentV4() {
  const [state, setState] = useState<V4UIState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const update = useCallback((patch: Partial<V4UIState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setState((prev) => ({ ...prev, elapsedMs: Date.now() - startTimeRef.current }));
    }, 200);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const run = useCallback(async (opts: RunV4Options) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState({ ...initial, status: 'planning' });
    startTimer();

    try {
      const res = await fetch('/api/agent-v4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: opts.query,
          depth: opts.depth ?? 'standard',
          domain: opts.domain ?? 'general',
          provider: opts.provider ?? 'anthropic',
          model: opts.model ?? 'claude-sonnet-4-5',
          userId: opts.userId ?? 'anonymous',
          documentIds: opts.documentIds,
          memoryContextIds: opts.memoryContextIds,
          saveToMemory: true,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
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
            const event = JSON.parse(line.slice(6));
            handleEvent(event.type, event.data, event.error);
          } catch {}
        }
      }
    } catch (err: unknown) {
      stopTimer();
      if (err instanceof Error && err.name === 'AbortError') {
        update({ status: 'aborted' });
      } else {
        update({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleEvent(type: string, data: unknown, error?: string) {
    switch (type) {
      case 'start':
        update({ runId: (data as { runId: string }).runId, status: 'planning' });
        break;
      case 'dag_ready':
        update({ dag: data as ExecutionDAG, status: 'running' });
        break;
      case 'node_start':
        update({ activeNodeId: (data as { nodeId: string }).nodeId, status: 'running' });
        setState((prev) => {
          if (!prev.dag) return prev;
          return { ...prev, dag: { ...prev.dag, nodes: prev.dag.nodes.map((n) => n.id === (data as { nodeId: string }).nodeId ? { ...n, status: 'running' as const } : n) } };
        });
        break;
      case 'node_done':
        setState((prev) => {
          if (!prev.dag) return prev;
          const d = data as { nodeId: string; confidence?: number };
          return { ...prev, activeNodeId: null, dag: { ...prev.dag, nodes: prev.dag.nodes.map((n) => n.id === d.nodeId ? { ...n, status: 'done' as const, confidence: d.confidence } : n) } };
        });
        break;
      case 'node_error':
        setState((prev) => {
          if (!prev.dag) return prev;
          const d = data as { nodeId: string; error: string };
          return { ...prev, dag: { ...prev.dag, nodes: prev.dag.nodes.map((n) => n.id === d.nodeId ? { ...n, status: 'error' as const, error: d.error } : n) } };
        });
        break;
      case 'agent_message':
        setState((prev) => ({ ...prev, agentMessages: [...prev.agentMessages, data as AgentMessage] }));
        break;
      case 'eval':
        update({ evaluation: data as EvaluationResult, status: 'evaluating' });
        break;
      case 'improvement':
        setState((prev) => ({ ...prev, improvements: [...prev.improvements, data as ImprovementRecord] }));
        break;
      case 'circuit_break':
        setState((prev) => ({ ...prev, circuitBreaks: prev.circuitBreaks + 1 }));
        break;
      case 'done':
        stopTimer();
        update({ result: data as V4AgentResult, status: 'done', activeNodeId: null });
        break;
      case 'error':
        stopTimer();
        update({ status: 'error', error: error ?? 'Unknown error' });
        break;
    }
  }

  const abort = useCallback(() => { abortRef.current?.abort(); stopTimer(); update({ status: 'aborted' }); }, [update]);
  const reset = useCallback(() => { abortRef.current?.abort(); stopTimer(); setState(initial); }, []);

  return { state, run, abort, reset };
}
