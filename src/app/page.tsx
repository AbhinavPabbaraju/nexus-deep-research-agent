'use client';

import { useState, useEffect, useRef } from 'react';

// ── Types ──
interface ResearchResult {
  id: string;
  query: string;
  answer: string;
  confidence: number;
  provider: string;
  model: string;
  depth: string;
  timestamp: number;
}

interface MemoryContext {
  id: string;
  query: string;
  answer: string;
  provider: string;
  model: string;
  created_at?: string;
  timestamp?: number;
}

// ── Helpers ──
async function callResearchAPI(
  provider: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  signal: AbortSignal
): Promise<string> {
  const r = await fetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, systemPrompt, userPrompt, maxTokens, temperature }),
    signal,
  });
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.error || `API error ${r.status}`);
  }
  const d = await r.json();
  return d.result;
}

async function apiSaveHistory(item: Omit<ResearchResult, 'id'>) {
  await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...item, user_id: 'anonymous' }),
  });
}

async function apiLoadHistory(): Promise<ResearchResult[]> {
  const r = await fetch('/api/history?user_id=anonymous');
  const { data } = await r.json();
  return data || [];
}

async function apiSaveMemory(ctx: Omit<MemoryContext, 'id'>) {
  await fetch('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...ctx, user_id: 'anonymous' }),
  });
}

async function apiLoadMemory(): Promise<MemoryContext[]> {
  const r = await fetch('/api/memory?user_id=anonymous');
  const { data } = await r.json();
  return data || [];
}

async function apiClearMemory() {
  await fetch('/api/memory?user_id=anonymous', { method: 'DELETE' });
}

// ── Constants ──
const PROVIDERS: Record<string, { name: string; color: string; models: { value: string; label: string }[] }> = {
  anthropic: {
    name: 'Anthropic',
    color: '#e07b39',
    models: [
      { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    name: 'OpenAI',
    color: '#74aa9c',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'o1-preview', label: 'o1 Preview' },
    ],
  },
  gemini: {
    name: 'Google Gemini',
    color: '#4285f4',
    models: [
      { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
  },
  nvidia: {
    name: 'NVIDIA NIM',
    color: '#76b900',
    models: [
      { value: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B' },
      { value: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
      { value: 'mistralai/mixtral-8x22b-instruct-v0.1', label: 'Mixtral 8x22B' },
    ],
  },
};

const PASS_LABELS = [
  'INITIAL ANALYSIS',
  'DEEP INVESTIGATION',
  'CRITICAL EVALUATION',
  'CROSS-VALIDATION',
  'EXPERT SYNTHESIS',
  'ADVERSARIAL REVIEW',
  'DOMAIN EXPANSION',
  'FINAL REFINEMENT',
];

function computeConfidence(answer: string, numPasses: number, docChunks: number, hasMem: boolean): number {
  let s = 45;
  s += Math.min(15, answer.split(' ').length / 120);
  s += Math.min(18, numPasses * 3.5);
  s += Math.min(12, docChunks * 2);
  if (hasMem) s += 5;
  const ev = (answer.match(/according to|research shows|evidence suggests|data shows/gi) || []).length;
  s += Math.min(10, ev * 1.5);
  if (answer.includes('##') || answer.includes('|')) s += 4;
  return Math.min(97, Math.max(22, Math.round(s)));
}

function mdToHtml(md: string): string {
  if (!md) return '';
  let h = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^&gt; (.*?)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^[\-\*] (.*?)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*?)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  const parts = h.split(/\n\n+/);
  return parts.map(p => {
    if (/^<(h[1-3]|ul|blockquote|hr)/.test(p.trim())) return p;
    if (p.trim()) return `<p>${p.replace(/\n/g, '<br />')}</p>`;
    return '';
  }).join('\n');
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════
export default function Home() {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [depth, setDepth] = useState('standard');
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.3);

  const [isResearching, setIsResearching] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('');
  const [progress, setProgress] = useState(0);

  const [results, setResults] = useState<ResearchResult[]>([]);
  const [history, setHistory] = useState<ResearchResult[]>([]);
  const [memoryContexts, setMemoryContexts] = useState<MemoryContext[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [activeContextIds, setActiveContextIds] = useState<Set<string>>(new Set());
  const [thoughts, setThoughts] = useState<{ type: string; detail: string; time: string }[]>([]);
  const [activeResultTab, setActiveResultTab] = useState<Record<string, string>>({});

  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    apiLoadHistory().then(setHistory).catch(console.error);
    apiLoadMemory().then(setMemoryContexts).catch(console.error);
  }, []);

  // Update model when provider changes
  useEffect(() => {
    const firstModel = PROVIDERS[provider]?.models[0]?.value || '';
    setModel(firstModel);
  }, [provider]);

  function addThought(type: string, detail: string, t0: number) {
    const time = `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
    setThoughts(prev => [...prev, { type, detail, time }]);
  }

  function buildMemorySection(): string {
    if (!activeContextIds.size) return '';
    const sel = memoryContexts.filter(c => activeContextIds.has(c.id));
    if (!sel.length) return '';
    return '\n\n━━━ PRIOR RESEARCH CONTEXTS ━━━\n' +
      sel.map((c, i) => `[Context ${i + 1}]\nPrevious Query: ${c.query}\nPrevious Answer: ${c.answer.substring(0, 600)}...`).join('\n\n') +
      '\n━━━ END CONTEXTS ━━━\n\nUse the above prior research to inform your current analysis.';
  }

  async function startResearch() {
    if (!query.trim() || isResearching) return;

    setIsResearching(true);
    setThoughts([]);
    setProgress(0);
    abortRef.current = new AbortController();

    const numPasses = { quick: 1, standard: 3, deep: 5, exhaustive: 8 }[depth] || 3;
    const memSection = buildMemorySection();
    const hasMem = activeContextIds.size > 0;
    const passResults: string[] = [];
    const t0 = Date.now();
    let finalAnswer = '';

    try {
      addThought('INITIALIZE', `Provider: ${PROVIDERS[provider].name} · Model: ${model} · Passes: ${numPasses}`, t0);
      setProgress(8);

      if (hasMem) {
        addThought('MEMORY RETRIEVAL', `Injecting ${activeContextIds.size} prior context(s) for cross-session continuity`, t0);
      }

      for (let i = 0; i < numPasses; i++) {
        if (abortRef.current.signal.aborted) break;

        const passLabel = PASS_LABELS[Math.min(i, PASS_LABELS.length - 1)];
        setCurrentPhase(`Pass ${i + 1}/${numPasses}: ${passLabel}`);
        addThought(passLabel, `Executing research pass ${i + 1} of ${numPasses}...`, t0);
        setProgress(16 + (i / numPasses) * 60);

        const sys = `You are NEXUS, a world-class deep research AI. Pass ${i + 1}/${numPasses} — ${passLabel}. Produce rigorous, structured analysis using markdown. Use headers, tables, and code blocks where appropriate.`;
        const prevCtx = passResults.length
          ? `\n\nPREVIOUS PASSES:\n${passResults.map((r, j) => `[Pass ${j + 1}]: ${r.substring(0, 500)}...`).join('\n\n')}`
          : '';
        const usr = `RESEARCH QUERY: ${query}${memSection}${prevCtx}\n\nExecute ${passLabel}. Be thorough and precise.`;

        const response = await callResearchAPI(
          provider, model, sys, usr, maxTokens, temperature, abortRef.current.signal
        );
        passResults.push(response);
        addThought(`PASS ${i + 1} COMPLETE`, `${response.split(' ').length.toLocaleString()} words generated`, t0);
      }

      if (!abortRef.current.signal.aborted && numPasses > 1 && passResults.length > 1) {
        setCurrentPhase('Synthesizing...');
        setProgress(85);
        addThought('SYNTHESIS', `Synthesizing ${passResults.length} passes into final response...`, t0);

        const sys = `You are NEXUS SYNTHESIS ENGINE. Produce a definitive research report from ${passResults.length} analysis passes. Structure: Executive Summary → Detailed Analysis → Key Findings → Limitations → Conclusions. Use rich markdown.`;
        const usr = `QUERY: ${query}${memSection}\n\n${passResults.map((r, i) => `━━ PASS ${i + 1} ━━\n${r}`).join('\n\n')}\n\nSynthesize into the definitive final answer.`;

        finalAnswer = await callResearchAPI(
          provider, model, sys, usr, maxTokens, temperature, abortRef.current.signal
        );
      } else {
        finalAnswer = passResults[passResults.length - 1] || '';
      }

      if (!abortRef.current.signal.aborted && finalAnswer) {
        setProgress(95);
        const confidence = computeConfidence(finalAnswer, passResults.length, 0, hasMem);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        addThought('COMPLETE', `Done in ${elapsed}s · Confidence: ${confidence}%`, t0);

        const resultItem: ResearchResult = {
          id: Date.now().toString(),
          query,
          answer: finalAnswer,
          confidence,
          provider,
          model,
          depth,
          timestamp: Date.now(),
        };

        setResults(prev => [resultItem, ...prev]);
        setActiveResultTab(prev => ({ ...prev, [resultItem.id]: 'answer' }));

        // Persist to Supabase
        await apiSaveHistory(resultItem).catch(console.error);
        if (memoryEnabled) {
          await apiSaveMemory({ query, answer: finalAnswer, provider, model }).catch(console.error);
          const newMem = await apiLoadMemory().catch(() => []);
          setMemoryContexts(newMem);
        }
        const newHist = await apiLoadHistory().catch(() => []);
        setHistory(newHist);

        setProgress(100);
        setCurrentPhase('');
        setQuery('');
        if (queryRef.current) queryRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addThought('ERROR', err.message, t0);
        console.error('Research error:', err);
      }
    } finally {
      setIsResearching(false);
      setCurrentPhase('');
    }
  }

  function stopResearch() {
    abortRef.current?.abort();
    setIsResearching(false);
    setCurrentPhase('');
    setProgress(0);
  }

  function toggleContext(id: string) {
    setActiveContextIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }

  function getTabForResult(id: string) {
    return activeResultTab[id] || 'answer';
  }

  function setTabForResult(id: string, tab: string) {
    setActiveResultTab(prev => ({ ...prev, [id]: tab }));
  }

  const confColor = (c: number) => c >= 80 ? '#34d399' : c >= 60 ? '#fbbf24' : '#f87171';

  // ── RENDER ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#060710', color: '#eaecf8', fontFamily: "'DM Sans', sans-serif", overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(99,120,255,0.2); border-radius: 2px; }
        textarea { font-family: inherit; }
        select { font-family: 'DM Mono', monospace; }
        .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 14px; cursor: pointer; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #4e5470; transition: all 0.2s; white-space: nowrap; }
        .tab-btn:hover { color: #9ca3c8; }
        .tab-btn.active { color: #6378ff; border-bottom-color: #6378ff; }
        .answer-body h1, .answer-body h2, .answer-body h3 { font-family: 'Syne', sans-serif; font-weight: 700; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(99,120,255,0.1); }
        .answer-body h1 { font-size: 18px; } .answer-body h2 { font-size: 16px; } .answer-body h3 { font-size: 14px; }
        .answer-body p { margin-bottom: 14px; }
        .answer-body strong { color: #a78bfa; font-weight: 500; }
        .answer-body em { color: #9ca3c8; font-style: italic; }
        .answer-body code { font-family: 'DM Mono', monospace; font-size: 12px; background: #101325; border: 1px solid rgba(99,120,255,0.15); padding: 2px 6px; border-radius: 4px; color: #38bdf8; }
        .answer-body pre { background: #101325; border: 1px solid rgba(99,120,255,0.15); border-radius: 10px; padding: 16px; margin: 14px 0; overflow-x: auto; }
        .answer-body pre code { background: none; border: none; padding: 0; }
        .answer-body ul { margin: 8px 0 14px 22px; }
        .answer-body li { margin-bottom: 6px; line-height: 1.75; }
        .answer-body blockquote { border-left: 3px solid #6378ff; padding: 8px 16px; margin: 14px 0; color: #9ca3c8; font-style: italic; background: rgba(99,120,255,0.04); border-radius: 0 8px 8px 0; }
        .answer-body hr { border: none; border-top: 1px solid rgba(99,120,255,0.1); margin: 20px 0; }
        .answer-body table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
        .answer-body th { background: rgba(99,120,255,0.1); padding: 8px 12px; border: 1px solid rgba(99,120,255,0.15); font-weight: 600; text-align: left; }
        .answer-body td { padding: 7px 12px; border: 1px solid rgba(99,120,255,0.08); color: #9ca3c8; }
        .hint-chip:hover { border-color: #6378ff !important; color: #9ca3c8 !important; background: rgba(99,120,255,0.05) !important; }
        .mem-item:hover { background: #161930 !important; }
        .hist-item:hover { background: #101325 !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes cardIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes stepIn { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }
      `}</style>

      {/* HEADER */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', height: 56, background: 'rgba(6,7,16,0.9)', borderBottom: '1px solid rgba(99,120,255,0.08)', backdropFilter: 'blur(20px)', flexShrink: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 3 }}>
          <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#6378ff,#38bdf8)', borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 15 }}>⬡</div>
          NEXUS
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 2, padding: '2px 6px', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 3 }}>v2.0</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', animation: 'pulse 2s infinite' }} />
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#34d399', letterSpacing: 1 }}>
              {isResearching ? 'RESEARCHING...' : 'OPERATIONAL'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#9ca3c8' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: PROVIDERS[provider]?.color || '#6378ff' }} />
            {PROVIDERS[provider]?.name} · {model.split('/').pop()?.split('-').slice(0, 3).join('-')}
          </div>
        </div>
      </header>

      {/* BODY */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* SIDEBAR */}
        <aside style={{ width: 300, background: '#0b0d1c', borderRight: '1px solid rgba(99,120,255,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>

            {/* Provider */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(99,120,255,0.06)' }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 10 }}>Provider</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4, marginBottom: 10 }}>
                {Object.entries(PROVIDERS).map(([key, p]) => (
                  <button key={key} onClick={() => setProvider(key)} style={{ padding: '7px 3px', borderRadius: 6, border: `1px solid ${provider === key ? '#6378ff' : 'rgba(99,120,255,0.1)'}`, background: provider === key ? 'rgba(99,120,255,0.1)' : 'none', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 8, color: provider === key ? '#eaecf8' : '#4e5470', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, transition: 'all 0.2s' }}>
                    <span style={{ fontSize: 13 }}>{key === 'anthropic' ? '🟠' : key === 'openai' ? '🟢' : key === 'gemini' ? '🔵' : '🟩'}</span>
                    {p.name.split(' ')[0]}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 1 }}>MODEL</label>
                <select value={model} onChange={e => setModel(e.target.value)} style={{ width: '100%', background: '#101325', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 7, padding: '7px 10px', fontSize: 11, color: '#eaecf8', outline: 'none' }}>
                  {PROVIDERS[provider]?.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>

            {/* Config */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(99,120,255,0.06)' }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 10 }}>Research Config</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: 'DEPTH', node: <select value={depth} onChange={e => setDepth(e.target.value)} style={{ width: '100%', background: '#101325', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 7, padding: '7px 10px', fontSize: 11, color: '#eaecf8', outline: 'none' }}><option value="quick">Quick (1x)</option><option value="standard">Standard (3x)</option><option value="deep">Deep (5x)</option><option value="exhaustive">Full (8x)</option></select> },
                  { label: 'MAX TOKENS', node: <input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} min={512} max={16384} step={512} style={{ width: '100%', background: '#101325', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 7, padding: '7px 10px', fontSize: 11, color: '#eaecf8', outline: 'none' }} /> },
                  { label: 'TEMPERATURE', node: <input type="number" value={temperature} onChange={e => setTemperature(Number(e.target.value))} min={0} max={2} step={0.05} style={{ width: '100%', background: '#101325', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 7, padding: '7px 10px', fontSize: 11, color: '#eaecf8', outline: 'none' }} /> },
                ].map(({ label, node }) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 1 }}>{label}</label>
                    {node}
                  </div>
                ))}
              </div>
            </div>

            {/* Memory */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(99,120,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 2.5, textTransform: 'uppercase' }}>Memory</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => { apiClearMemory(); setMemoryContexts([]); setActiveContextIds(new Set()); }} style={{ background: 'none', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4, color: '#f87171', fontFamily: "'DM Mono',monospace", fontSize: 9, padding: '2px 7px', cursor: 'pointer', opacity: 0.7 }}>Clear</button>
                  <div onClick={() => setMemoryEnabled(m => !m)} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <div style={{ width: 32, height: 18, background: memoryEnabled ? 'rgba(99,120,255,0.3)' : '#161930', border: `1px solid ${memoryEnabled ? '#6378ff' : 'rgba(99,120,255,0.15)'}`, borderRadius: 10, position: 'relative', transition: 'all 0.2s' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: memoryEnabled ? '#6378ff' : '#4e5470', position: 'absolute', top: 2, left: memoryEnabled ? 16 : 2, transition: 'all 0.2s' }} />
                    </div>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#9ca3c8' }}>{memoryEnabled ? 'ON' : 'OFF'}</span>
                  </div>
                </div>
              </div>
              <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {memoryContexts.length === 0
                  ? <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#4e5470', textAlign: 'center', padding: 12 }}>{memoryEnabled ? 'No contexts yet' : 'Enable memory above'}</div>
                  : memoryContexts.slice(0, 10).map(c => {
                    const sel = activeContextIds.has(c.id);
                    return <div key={c.id} className="mem-item" onClick={() => toggleContext(c.id)} style={{ padding: '6px 8px', background: sel ? 'rgba(52,211,153,0.05)' : '#101325', borderRadius: 6, borderLeft: `2px solid ${sel ? '#34d399' : '#6378ff'}`, cursor: 'pointer', transition: 'all 0.2s' }}>
                      <div style={{ fontSize: 10, color: '#9ca3c8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel ? '✓ ' : ''}{c.query.substring(0, 50)}{c.query.length > 50 ? '…' : ''}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: '#4e5470', marginTop: 2 }}>{c.provider} · {c.model.split('/').pop()}</div>
                    </div>;
                  })}
              </div>
              {activeContextIds.size > 0 && (
                <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(99,120,255,0.08)', border: '1px solid rgba(99,120,255,0.15)', borderRadius: 6, fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#a78bfa' }}>
                  🧠 {activeContextIds.size} context(s) active — will be injected into next query
                </div>
              )}
            </div>

            {/* History */}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 8 }}>History</div>
              {history.length === 0
                ? <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#4e5470', textAlign: 'center', padding: 12 }}>No history yet</div>
                : history.slice(0, 20).map(h => {
                  const cc = h.confidence >= 80 ? '#34d399' : h.confidence >= 60 ? '#fbbf24' : '#f87171';
                  return <div key={h.id} className="hist-item" style={{ padding: '7px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 3, transition: 'all 0.2s' }}>
                    <div style={{ fontSize: 11, color: '#9ca3c8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{h.query}</div>
                    <div style={{ display: 'flex', gap: 6, fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470' }}>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: `${cc}20`, color: cc }}>{h.confidence}%</span>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(99,120,255,0.1)', color: '#a78bfa' }}>{h.provider}</span>
                    </div>
                  </div>;
                })}
            </div>

          </div>
        </aside>

        {/* MAIN */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Active context banner */}
          {activeContextIds.size > 0 && (
            <div style={{ padding: '7px 22px', background: 'rgba(11,13,28,0.7)', borderBottom: '1px solid rgba(99,120,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 1.5, textTransform: 'uppercase' }}>Active Contexts:</span>
              {Array.from(activeContextIds).map(id => {
                const c = memoryContexts.find(x => x.id === id);
                return c ? <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: 'rgba(99,120,255,0.1)', border: '1px solid rgba(99,120,255,0.2)', fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#a78bfa' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{c.query.substring(0, 35)}…</span>
                  <span onClick={() => toggleContext(id)} style={{ cursor: 'pointer', color: '#4e5470', marginLeft: 2 }}>✕</span>
                </div> : null;
              })}
              <span onClick={() => { setActiveContextIds(new Set()); }} style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', cursor: 'pointer' }}>clear all</span>
            </div>
          )}

          {/* Query Input */}
          <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid rgba(99,120,255,0.08)', background: 'rgba(11,13,28,0.4)', backdropFilter: 'blur(10px)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#0b0d1c', border: `1.5px solid ${isResearching ? '#6378ff' : 'rgba(99,120,255,0.18)'}`, borderRadius: 14, padding: '14px 16px', transition: 'all 0.2s', boxShadow: isResearching ? '0 0 0 3px rgba(99,120,255,0.08)' : 'none' }}>
              <textarea ref={queryRef} value={query} onChange={e => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 280) + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) startResearch(); }} placeholder="Enter a deep research question… (Ctrl+Enter to submit)" rows={2} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 15, color: '#eaecf8', resize: 'none', lineHeight: 1.7, minHeight: 64, maxHeight: 280 }} />
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexShrink: 0 }}>
                {isResearching && <button onClick={stopResearch} style={{ padding: '11px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 10, color: '#f87171', fontFamily: "'DM Mono',monospace", fontSize: 11, cursor: 'pointer' }}>⏹ Stop</button>}
                <button onClick={startResearch} disabled={isResearching || !query.trim()} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 22px', background: 'linear-gradient(135deg,#6378ff,#4a60ff)', border: 'none', borderRadius: 10, color: 'white', fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: isResearching || !query.trim() ? 0.45 : 1, transition: 'all 0.2s' }}>⚡ Research</button>
              </div>
            </div>

            {/* Progress */}
            {isResearching && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 2, background: 'rgba(99,120,255,0.1)', borderRadius: 1, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ height: '100%', background: 'linear-gradient(90deg,#6378ff,#38bdf8)', borderRadius: 1, width: `${progress}%`, transition: 'width 0.6s ease' }} />
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#6378ff', letterSpacing: 1 }}>{currentPhase}</div>
              </div>
            )}

            {/* Hint chips */}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {[
                ['🔬 Transformers', 'Analyze the evolution of transformer architectures from BERT to modern LLMs'],
                ['📚 RAG Systems', 'What are the key limitations of RAG systems and how can they be mitigated?'],
                ['🖼️ Diffusion vs GAN', 'Compare diffusion models vs GANs — architecture, quality, and speed tradeoffs'],
                ['💼 AI Economics', 'Analyze economic implications of AI on software engineering roles'],
              ].map(([label, q]) => (
                <div key={label} className="hint-chip" onClick={() => { setQuery(q); if (queryRef.current) { queryRef.current.style.height = 'auto'; queryRef.current.style.height = Math.min(queryRef.current.scrollHeight, 280) + 'px'; } }} style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, padding: '4px 10px', border: '1px solid rgba(99,120,255,0.1)', borderRadius: 20, color: '#4e5470', cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>{label}</div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Live thought process while researching */}
            {isResearching && thoughts.length > 0 && (
              <div style={{ background: '#0b0d1c', border: '1px solid rgba(99,120,255,0.12)', borderRadius: 16, overflow: 'hidden', animation: 'cardIn 0.35s ease' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(99,120,255,0.08)', fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: 13 }}>🧠 Live Thought Process</div>
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {thoughts.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: i < thoughts.length - 1 ? 12 : 0, position: 'relative', animation: 'stepIn 0.25s ease' }}>
                      {i < thoughts.length - 1 && <div style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 1, background: 'rgba(99,120,255,0.1)' }} />}
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(99,120,255,0.1)', border: '1.5px solid rgba(99,120,255,0.3)', display: 'grid', placeItems: 'center', fontSize: 10, flexShrink: 0, color: '#6378ff' }}>◎</div>
                      <div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#6378ff', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 }}>{t.type}</div>
                        <div style={{ fontSize: 13, color: '#9ca3c8', lineHeight: 1.6 }}>{t.detail}</div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: '#4e5470', marginTop: 2 }}>{t.time}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 4, padding: '10px 0 0 36px' }}>
                    {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6378ff', animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
                  </div>
                </div>
              </div>
            )}

            {/* Result Cards */}
            {results.map(r => {
              const tab = getTabForResult(r.id);
              const cc = confColor(r.confidence);
              return (
                <div key={r.id} style={{ background: '#0b0d1c', border: '1px solid rgba(99,120,255,0.1)', borderRadius: 18, overflow: 'hidden', animation: 'cardIn 0.35s ease' }}>
                  {/* Card Header */}
                  <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(99,120,255,0.06)', background: 'rgba(99,120,255,0.02)' }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 600, flex: 1, lineHeight: 1.5 }}>{r.query}</div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                      {[PROVIDERS[r.provider]?.name || r.provider, r.model.split('/').pop()?.split('-').slice(0,3).join('-') || '', r.depth.toUpperCase(), new Date(r.timestamp).toLocaleTimeString()].map((b, i) => (
                        <span key={i} style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(99,120,255,0.15)', color: i === 0 ? PROVIDERS[r.provider]?.color : '#4e5470', background: i === 0 ? `${PROVIDERS[r.provider]?.color}11` : 'none' }}>{b}</span>
                      ))}
                    </div>
                  </div>

                  {/* Confidence */}
                  <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(99,120,255,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 38, fontWeight: 800, color: cc, lineHeight: 1 }}>{r.confidence}%</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#4e5470', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>CONFIDENCE SCORE</div>
                      <div style={{ height: 4, background: 'rgba(99,120,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${r.confidence}%`, background: `linear-gradient(90deg,${cc},${cc}88)`, borderRadius: 2, transition: 'width 1.2s ease' }} />
                      </div>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div style={{ display: 'flex', padding: '0 20px', borderBottom: '1px solid rgba(99,120,255,0.06)', overflowX: 'auto' }}>
                    {[['answer', '📝 Answer'], ['thoughts', '🧠 Thought Process']].map(([t, label]) => (
                      <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTabForResult(r.id, t)}>{label}</button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  {tab === 'answer' && (
                    <div style={{ padding: '24px 26px' }}>
                      <div className="answer-body" style={{ fontSize: 15, lineHeight: 1.9, color: '#eaecf8' }} dangerouslySetInnerHTML={{ __html: mdToHtml(r.answer) }} />
                    </div>
                  )}
                  {tab === 'thoughts' && (
                    <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {thoughts.map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: i < thoughts.length - 1 ? 12 : 0, position: 'relative' }}>
                          {i < thoughts.length - 1 && <div style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 1, background: 'rgba(99,120,255,0.08)' }} />}
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(99,120,255,0.1)', border: '1.5px solid rgba(99,120,255,0.25)', display: 'grid', placeItems: 'center', fontSize: 10, flexShrink: 0, color: '#6378ff' }}>◎</div>
                          <div>
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: '#6378ff', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 }}>{t.type}</div>
                            <div style={{ fontSize: 13, color: '#9ca3c8', lineHeight: 1.6 }}>{t.detail}</div>
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: '#4e5470', marginTop: 2 }}>{t.time}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Empty state */}
            {results.length === 0 && !isResearching && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, opacity: 0.5, padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 56 }}>🔭</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, color: '#9ca3c8' }}>NEXUS Deep Research v2</div>
                <div style={{ fontSize: 13, color: '#4e5470', maxWidth: 440, lineHeight: 1.7 }}>Multi-provider AI research with contextual memory, multi-pass analysis, and confidence scoring. Select your provider and enter a question to begin.</div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}