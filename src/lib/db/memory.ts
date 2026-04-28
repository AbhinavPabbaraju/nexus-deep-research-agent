// ─── src/lib/db/memory.ts ─────────────────────────────────────────────────────
import { supabase } from './supabase';
import { embedText } from '@/lib/rag/embedder';
import type { MemoryContext, AgentResult } from '@/lib/agent/types';
import { logger } from '@/lib/observability/logger';

export async function saveMemory(result: AgentResult, userId: string): Promise<string | null> {
  try {
    const embedding = await embedText(`${result.query} ${result.summary}`);
    const { data, error } = await supabase
      .from('memory_contexts')
      .insert({
        user_id: userId,
        run_id: result.runId,
        query: result.query,
        answer: result.answer,
        summary: result.summary,
        provider: result.provider,
        model: result.model,
        confidence: result.confidence / 100,
        key_findings: result.keyFindings,
        depth: result.depth,
        total_tokens: result.totalTokens,
        total_latency_ms: result.totalLatencyMs,
        embedding,
      })
      .select('id')
      .single();

    if (error) throw error;
    logger.info({ id: data.id }, 'Memory saved');
    return data.id;
  } catch (err) {
    logger.error({ err }, 'Failed to save memory');
    return null;
  }
}

export async function loadMemoryContexts(ids: string[], userId: string): Promise<MemoryContext[]> {
  try {
    const { data, error } = await supabase
      .from('memory_contexts')
      .select('*')
      .in('id', ids)
      .eq('user_id', userId);
    if (error) throw error;
    return (data ?? []) as MemoryContext[];
  } catch (err) {
    logger.error({ err }, 'Failed to load memory contexts');
    return [];
  }
}

export async function getRecentMemory(userId: string, limit = 10): Promise<MemoryContext[]> {
  const { data, error } = await supabase
    .from('memory_contexts')
    .select('id, query, summary, confidence, provider, model, depth, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) { logger.error({ error }, 'getRecentMemory failed'); return []; }
  return (data ?? []) as MemoryContext[];
}

export async function semanticMemorySearch(query: string, userId: string, limit = 5): Promise<MemoryContext[]> {
  const embedding = await embedText(query);
  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: embedding,
    p_user_id: userId,
    match_threshold: 0.75,
    match_count: limit,
  });
  if (error) { logger.error({ error }, 'Semantic memory search failed'); return []; }
  return (data ?? []) as MemoryContext[];
}

export async function deleteMemory(id: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_contexts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  return !error;
}
