// ─── src/app/api/rag/route.ts ─────────────────────────────────────────────────
// Handles PDF/TXT upload → chunking → embedding → pgvector storage
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { semanticChunk } from '@/lib/rag/chunker';
import { embedBatch } from '@/lib/rag/embedder';
import { supabase } from '@/lib/db/supabase';
import { logger } from '@/lib/observability/logger';

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? 'anonymous';
  let text = '';
  let filename = 'document';

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    filename = file.name;
    text = await file.text();
  } else {
    const body = await req.json();
    text = body.text ?? '';
    filename = body.filename ?? 'document';
  }

  if (!text || text.trim().length < 50) {
    return NextResponse.json({ error: 'Document too short or empty' }, { status: 400 });
  }

  try {
    const docId = uuidv4();
    const chunks = semanticChunk(text);
    logger.info({ docId, filename, chunkCount: chunks.length }, 'Ingesting document');

    // Batch embed all chunks
    const embeddings = await embedBatch(chunks.map((c) => c.content));

    // Bulk insert to Supabase
    const rows = chunks.map((chunk, i) => ({
      id: uuidv4(),
      user_id: userId,
      doc_id: docId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.chunkIndex,
      token_count: chunk.tokenCount,
      metadata: { filename, ...chunk.metadata },
    }));

    const { error } = await supabase.from('document_chunks').insert(rows);
    if (error) throw error;

    logger.info({ docId, chunkCount: rows.length }, 'Document ingested');
    return NextResponse.json({ docId, filename, chunkCount: rows.length });
  } catch (err) {
    logger.error({ err }, 'Document ingestion failed');
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? 'anonymous';
  const { docId } = await req.json();
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });

  const { error } = await supabase
    .from('document_chunks')
    .delete()
    .eq('doc_id', docId)
    .eq('user_id', userId);

  return NextResponse.json({ success: !error, error: error?.message });
}
