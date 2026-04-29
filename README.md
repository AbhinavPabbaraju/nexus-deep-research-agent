# NexusAI — Deep Research Agent v3

A production-grade, truly agentic research system built on a **Planner → Executor → Evaluator → Loop** architecture. Multi-provider (Anthropic, OpenAI, Gemini, NVIDIA NIM), streaming SSE, pgvector RAG, and an elite UI.

---

## What Makes This a True Agent

Unlike a staged pipeline that runs N fixed passes, NexusAI v3 has genuine decision logic:

```
User Query
    ↓
[PLANNER] — Produces a JSON plan: intent, tool sequence, max steps, target confidence
    ↓
[EXECUTOR] — Dispatches tools (search, retrieve, reason, critique, synthesize)
             Parallel execution for independent tools (search + retrieve run together)
    ↓
[EVALUATOR] — Scores evidence quality (0.0–1.0), decides next action:
              CONTINUE | DONE | PIVOT | EXPAND | FALLBACK
    ↓
    ↺ Loop until confidence ≥ target OR max steps reached
    ↓
[SYNTHESIZER] — Produces final structured report
```

The **Evaluator's `action` field** is what makes it agentic:
- `DONE` — evidence meets quality bar, stop early (saves tokens)
- `PIVOT` — current approach isn't working, revise the plan
- `EXPAND` — good progress but specific gaps remain, add tools
- `FALLBACK` — multiple errors, rotate to next LLM provider

---

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── agent/route.ts      ← Streaming SSE endpoint (main entry point)
│   │   ├── memory/route.ts     ← GET/DELETE research history
│   │   └── rag/route.ts        ← Document upload → chunk → embed → store
│   ├── layout.tsx
│   ├── page.tsx                ← Full UI (sidebar + timeline + result panel)
│   └── globals.css
│
├── lib/
│   ├── agent/
│   │   ├── types.ts            ← All interfaces + Zod schemas (single source of truth)
│   │   ├── orchestrator.ts     ← Main loop: Planner→Executor→Evaluator
│   │   ├── planner.ts          ← Converts query to structured JSON plan
│   │   ├── executor.ts         ← Dispatches tools, parallel execution
│   │   └── evaluator.ts        ← Quality scoring + CONTINUE/DONE/PIVOT/EXPAND/FALLBACK
│   │
│   ├── providers/
│   │   └── normalizer.ts       ← Unified adapter for Anthropic/OpenAI/Gemini/NVIDIA
│   │                             Retry logic, timeout handling, cost tracking
│   ├── rag/
│   │   ├── chunker.ts          ← Semantic chunking with overlap
│   │   ├── embedder.ts         ← text-embedding-3-small via OpenAI
│   │   └── retriever.ts        ← Vector search → LLM reranking → compression
│   │
│   ├── db/
│   │   ├── supabase.ts         ← Supabase client singleton
│   │   └── memory.ts           ← Save/load/search research memory
│   │
│   └── observability/
│       ├── logger.ts           ← Pino structured JSON logging
│       └── tracer.ts           ← Lightweight span-based tracing
│
├── hooks/
│   └── useAgent.ts             ← React hook: SSE subscription + typed UI state
│
└── components/
    ├── AgentTimeline.tsx       ← Animated live step visualization
    ├── ConfidenceGauge.tsx     ← SVG arc gauge with sparkline
    └── ResultPanel.tsx         ← Tabbed: Answer | Trace | Metrics
```

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd nexus-deep-research-v3
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# Required: at least one LLM provider
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...        # Also used for embeddings (required for RAG)
GEMINI_API_KEY=AIza-...
NVIDIA_API_KEY=nvapi-...

# Required: Supabase (free tier works)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
```

### 3. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to SQL Editor → New Query
3. Paste and run the contents of `supabase/schema.sql`

This creates:
- `document_chunks` table with pgvector (1536-dim) for RAG
- `memory_contexts` table with pgvector for semantic memory search
- `match_documents` and `match_memories` RPC functions

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deployment (Vercel)

```bash
npm install -g vercel
vercel --prod
```

Add all environment variables in the Vercel dashboard under Settings → Environment Variables.

**Important Vercel settings:**
- Functions → Max Duration: set to `300` (5 minutes) for exhaustive depth
- Edge Runtime is NOT used — agent runs in Node.js runtime for full SDK support

---

## How to Use

### Basic research
Type a query, select depth and provider, click **Run Research** or press `⌘↵`.

### Research depths
| Depth | Steps | Time | Use case |
|-------|-------|------|----------|
| Quick | 2–3 | ~30s | Fast fact lookup |
| Standard | 4–6 | ~90s | Most queries |
| Deep | 7–9 | ~3m | Complex analysis |
| Exhaustive | 10–12 | ~6m | Critical research |

### RAG (Document Upload)
Upload PDF or TXT via the `/api/rag` endpoint:

```bash
curl -X POST http://localhost:3000/api/rag \
  -H "x-user-id: your-user-id" \
  -F "file=@document.pdf"
```

Returns `{ docId, chunkCount }`. Pass `docId` in the agent request to activate retrieval.

### API Usage

```typescript
// POST /api/agent
const res = await fetch('/api/agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'What are the implications of quantum error correction for cryptography?',
    depth: 'deep',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    userId: 'user-123',
    documentIds: ['doc-uuid-here'],  // optional
    saveToMemory: true,
  }),
});

// Subscribe to SSE events
const reader = res.body.getReader();
// Events: start | plan | loop_start | step_start | step_done | eval | done | error
```

---

## Key Design Decisions

### Why Zod on every LLM response?
LLMs produce inconsistent JSON. Zod validation at the boundary of every agent step catches malformed output, triggers retries, and falls back to safe defaults. This eliminates ~70% of runtime errors.

### Why SSE instead of polling?
Each agent step can take 5–45 seconds. SSE lets the UI show progress in real time — users see the plan, watch each step complete, and observe confidence improving. This is the difference between a loading spinner and a research terminal.

### Why LLM-as-reranker instead of a cross-encoder?
No extra model deployment needed. `gpt-4o-mini` reranks 20 candidates for ~$0.001 and produces better results than BM25. Full cross-encoder (like `cross-encoder/ms-marco-MiniLM-L-6-v2`) can be swapped in if you add a Python sidecar.

### Why parallel tool execution?
`search` and `retrieve` are independent I/O operations. Running them concurrently cuts that phase from ~16s to ~8s at no quality cost.

---

## Extending

### Add a new tool
1. Add tool name to `ToolName` type in `types.ts`
2. Add system prompt and handler in `executor.ts`
3. Add timeout config in `TOOL_TIMEOUTS`

### Add a new provider
1. Add adapter function in `normalizer.ts`
2. Add to `PROVIDER_ADAPTERS` map
3. Add default model to `getDefaultModel()`
4. Add fallback chain in `planner.ts`

### Add evaluation metrics
The `EvalResult` has `confidence`, `evidenceQuality`, and `gaps`. You can extend `EvalResultSchema` to add domain-specific metrics (e.g., `citationCount`, `controversyScore`).

---

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| LLMs | Anthropic, OpenAI, Gemini, NVIDIA NIM |
| Validation | Zod (all LLM outputs) |
| Database | Supabase (PostgreSQL + pgvector) |
| Embeddings | text-embedding-3-small (OpenAI) |
| Animations | Framer Motion |
| Logging | Pino (structured JSON) |
| Deployment | Vercel |

---

## License

MIT
