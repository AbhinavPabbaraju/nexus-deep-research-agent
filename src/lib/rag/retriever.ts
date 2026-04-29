// ─── src/lib/rag/retriever.ts ─────────────────────────────────────────────────
// Retrieval pipeline: embed query → vector search (wide recall) → LLM rerank → compress
import { embedText } from './embedder';
import { supabase } from '@/lib/db/supabase';
import { callLLMJson } from '@/lib/providers/normalizer';
import { logger } from '@/lib/observability/logger';

interface MatchedChunk {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

// Step 1: Vector search (wide recall, K=20)
async function vectorSearch(query: string, userId: string, k = 20): Promise<MatchedChunk[]> {
  const embedding = await embedText(query);
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: 0.65,
    match_count: k,
    p_user_id: userId,
  });
  if (error) {
    logger.error({ error }, 'Vector search failed');
    return [];
  }
  return (data ?? []) as MatchedChunk[];
}

// Step 2: LLM reranker (precision, N=6)
async function rerank(query: string, candidates: MatchedChunk[], topN = 6): Promise<MatchedChunk[]> {
  if (candidates.length <= topN) return candidates;

  const scored = await callLLMJson<{ index: number; score: number }[]>(
    {
      systemPrompt: 'You are a relevance scorer. Respond ONLY with JSON array.',
      userPrompt: `Rate each passage for relevance to the query (0.0-1.0).
Query: "${query}"
Passages:
${candidates.map((c, i) => `[${i}] ${c.content.substring(0, 300)}`).join('\n---\n')}

Return JSON: [{"index": 0, "score": 0.9}, ...]`,
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0,
      responseFormat: 'json_object',
      timeoutMs: 10_000,
    },
    (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as Record<string, unknown[]>).scores ?? [];
      return arr as { index: number; score: number }[];
    }
  );

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => candidates[s.index])
    .filter(Boolean);
}

// Step 3: Context compression
async function compress(query: string, chunks: MatchedChunk[], targetTokens = 1200): Promise<string[]> {
  return chunks.map((c) => {
    // Simple sentence-level filter (full LLMLingua would call an LLM here)
    const sentences = c.content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const relevant = sentences.filter((s) =>
      query.toLowerCase().split(' ').some((word) => word.length > 3 && s.toLowerCase().includes(word))
    );
    return relevant.length > 0 ? relevant.join('. ') : c.content.substring(0, 400);
  });
}

// Main retrieval function
export async function ragRetrieve(query: string, userId: string, topN = 6): Promise<string[]> {
  try {
    const candidates = await vectorSearch(query, userId, 20);
    if (candidates.length === 0) return [];
    const reranked = await rerank(query, candidates, topN);
    return compress(query, reranked);
  } catch (err) {
    logger.error({ err }, 'RAG retrieval failed');
    return [];
  }
}
