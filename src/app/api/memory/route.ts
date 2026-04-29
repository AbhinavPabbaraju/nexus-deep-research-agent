// ─── src/app/api/memory/route.ts ──────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getRecentMemory, deleteMemory, semanticMemorySearch } from '@/lib/db/memory';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? 'anonymous';
  const search = req.nextUrl.searchParams.get('search');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20');

  try {
    const data = search
      ? await semanticMemorySearch(search, userId, Math.min(limit, 20))
      : await getRecentMemory(userId, Math.min(limit, 50));
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? 'anonymous';
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const ok = await deleteMemory(id, userId);
  return NextResponse.json({ success: ok });
}
