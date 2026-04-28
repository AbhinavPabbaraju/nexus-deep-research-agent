# NexusAI Changelog

## v4.0.0 — Quant-Grade Multi-Agent System

### Architecture
- **Multi-agent DAG**: Planner → Researcher → Critic → Verifier → Synthesizer
- **Adversarial agents**: Critic challenges Researcher output; Verifier cross-checks claims
- **DAG execution engine**: `src/lib/agent/dag/builder.ts` — topological sort, parallel batches, dependency graph
- **Domain modes**: General · Finance · Technical · Medical · Legal · Scientific — each with tuned system prompts, confidence thresholds, and preferred tools

### Reliability
- **Circuit breaker**: `src/lib/reliability/circuit-breaker.ts` — closed/open/half-open states, per-provider failure tracking
- **Exponential backoff with full jitter**: `computeDelay()` — prevents thundering herd on retry
- **Provider rotation**: automatic fallback chain on circuit open

### Evaluation Framework
- **Multi-dimensional scoring**: factual accuracy (35%), completeness (25%), coherence (25%), citation quality (15%)
- **Calibration error**: |predicted_confidence − actual_accuracy|
- **Regression tracking**: score vs baseline from prior runs
- **Supabase persistence**: `evaluation_results` table

### Self-Improvement
- `src/lib/memory/self-improvement.ts` — extracts failure patterns from low-scoring runs
- Corrections injected into future planner prompts via `formatImprovementsForPrompt()`
- EMA-based success rate tracking per improvement record

### New API Routes
- `POST /api/agent-v4` — streaming SSE with v4 event types: `dag_ready`, `node_start`, `node_done`, `agent_message`, `eval`, `improvement`

### UI Redesign
- **Aurora hero background**: animated radial gradients (indigo/cyan/pink) + grid overlay
- **Domain pill selector** in header — switches color theme, system prompts, example queries
- **DAG Graph component**: SVG node graph with animated edges, status indicators, confidence badges
- **Agent Dialogue feed**: real-time adversarial message log
- **EvaluationPanel**: animated score bars, calibration grade, regression indicator
- **Self-improvement notice**: system learning banner on poor results
- **Elapsed timer**: live clock during runs
- **Settings sidebar**: slide-in panel with depth/provider controls

### Color System
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#060608` | Page background |
| `--surface` | `#0d0d10` | Cards |
| `--border` | `#1e1e24` | All borders |
| `indigo` | `#6366f1` | Primary accent, planner |
| `cyan` | `#06b6d4` | Secondary, researcher |
| `amber` | `#f59e0b` | Critic/warnings |
| `emerald` | `#10b981` | Success, verifier |
| `pink` | `#ec4899` | Synthesizer, aurora |

---

## v3.0.0 — True Agent Loop (baseline)
- Planner → Executor → Evaluator → Loop architecture
- Zod schema validation on all LLM responses
- SSE streaming endpoint `/api/agent`
- pgvector RAG with semantic chunking + reranking
- Pino structured logging + span tracer
- Provider normalizer (Anthropic/OpenAI/Gemini/NVIDIA)
- `useAgent` hook with typed SSE subscription
- AgentTimeline, ConfidenceGauge, ResultPanel components
