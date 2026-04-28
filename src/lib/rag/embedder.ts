// ─── src/lib/rag/embedder.ts ──────────────────────────────────────────────────
import OpenAI from 'openai';
import { logger } from '@/lib/observability/logger';

let _openai: OpenAI | null = null;
function getClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

export async function embedText(text: string): Promise<number[]> {
  try {
    const res = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000), // max safe input
    });
    return res.data[0].embedding;
  } catch (err) {
    logger.error({ err }, 'Embedding failed');
    // Return zero vector as fallback (will produce low similarity scores)
    return new Array(EMBEDDING_DIM).fill(0);
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const res = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.substring(0, 8000)),
    });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } catch (err) {
    logger.error({ err }, 'Batch embedding failed');
    return texts.map(() => new Array(EMBEDDING_DIM).fill(0));
  }
}
