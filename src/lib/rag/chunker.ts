// ─── src/lib/rag/chunker.ts ───────────────────────────────────────────────────
// Semantic chunking: splits on paragraph/sentence boundaries,
// applies overlap so context isn't lost at chunk edges.

export interface Chunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: { startChar: number; endChar: number; section?: string };
}

interface ChunkConfig {
  chunkSize: number;   // target tokens
  overlap: number;     // overlap tokens between adjacent chunks
  minChunkSize: number;
}

const CONFIGS: Record<string, ChunkConfig> = {
  scientific: { chunkSize: 512, overlap: 100, minChunkSize: 100 },
  code:       { chunkSize: 256, overlap: 50,  minChunkSize: 50  },
  narrative:  { chunkSize: 400, overlap: 80,  minChunkSize: 80  },
  default:    { chunkSize: 384, overlap: 76,  minChunkSize: 60  },
};

// Approximate token count (1 token ≈ 4 chars for English)
function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getOverlapText(text: string, overlapTokens: number): string {
  const chars = overlapTokens * 4;
  return text.slice(-chars);
}

function detectDocType(text: string): string {
  if (/```|function |class |import |export /.test(text)) return 'code';
  if (/abstract|methodology|hypothesis|p-value/i.test(text)) return 'scientific';
  if (text.split('\n').length > text.length / 80) return 'narrative';
  return 'default';
}

export function semanticChunk(text: string, configOverride?: Partial<ChunkConfig>): Chunk[] {
  const docType = detectDocType(text);
  const config = { ...CONFIGS[docType], ...configOverride };
  const chunks: Chunk[] = [];

  // Split on double-newlines (paragraph boundaries)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  let buffer = '';
  let bufferStart = 0;
  let chunkIndex = 0;
  let charPos = 0;

  for (const para of paragraphs) {
    const combined = buffer ? `${buffer}\n\n${para}` : para;
    const combinedTokens = countTokens(combined);

    if (combinedTokens > config.chunkSize && buffer.length >= config.minChunkSize * 4) {
      // Flush buffer as a chunk
      chunks.push({
        content: buffer.trim(),
        chunkIndex,
        tokenCount: countTokens(buffer),
        metadata: { startChar: bufferStart, endChar: charPos },
      });
      chunkIndex++;

      // Start new buffer with overlap from previous
      const overlapText = getOverlapText(buffer, config.overlap);
      buffer = overlapText ? `${overlapText}\n\n${para}` : para;
      bufferStart = charPos - overlapText.length;
    } else {
      buffer = combined;
    }
    charPos += para.length + 2;
  }

  // Flush remaining buffer
  if (buffer.trim().length >= config.minChunkSize * 4) {
    chunks.push({
      content: buffer.trim(),
      chunkIndex,
      tokenCount: countTokens(buffer),
      metadata: { startChar: bufferStart, endChar: text.length },
    });
  }

  return chunks;
}
