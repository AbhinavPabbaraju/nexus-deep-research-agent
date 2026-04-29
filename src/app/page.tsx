// ─── src/app/page.tsx (v4 — Elite UI) ────────────────────────────────────────
'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentV4 } from '@/hooks/useAgentV4';
import { DAGGraph } from '@/components/graph/DAGGraph';
import { ConfidenceGauge } from '@/components/ConfidenceGauge';
import { EvaluationPanel } from '@/components/EvaluationPanel';
import { DOMAIN_CONFIGS, type DomainMode } from '@/lib/agent/types-v4';

const DEPTH_OPTIONS = [
  { value: 'quick',      label: 'Quick',      desc: '~30s',  steps: '2-3' },
  { value: 'standard',   label: 'Standard',   desc: '~90s',  steps: '4-5' },
  { value: 'deep',       label: 'Deep',       desc: '~3min', steps: '5-6' },
  { value: 'exhaustive', label: 'Exhaustive', desc: '~6min', steps: '6-7' },
] as const;

const PROVIDER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-4-5', badge: 'Recommended' },
  { value: 'openai',    label: 'OpenAI',    model: 'gpt-4o',            badge: null },
  { value: 'gemini',    label: 'Gemini',    model: 'gemini-1.5-pro',    badge: 'Fast' },
  { value: 'nvidia',    label: 'NVIDIA',    model: 'meta/llama-3.1-70b-instruct', badge: 'Open' },
] as const;

const EXAMPLE_QUERIES: Record<DomainMode, string[]> = {
  general:    ['How does transformer attention scale with sequence length?', 'What caused the 2008 financial crisis?'],
  finance:    ['Explain VaR and CVaR for portfolio risk management', 'Compare Black-Scholes vs Monte Carlo for options pricing'],
  technical:  ['Compare Raft vs Paxos consensus algorithms', 'Design a rate limiter for a distributed API gateway'],
  medical:    ['Explain the mechanism of GLP-1 agonists for diabetes', 'What are the long-term effects of sleep deprivation?'],
  legal:      ["What constitutes fair use under US copyright law?", "Explain GDPR right to erasure requirements"],
  scientific: ['What is quantum entanglement and how is it measured?', 'Explain CRISPR-Cas9 off-target effects'],
};

function AuroraBackground() {
  return (
    <div className="aurora-container" aria-hidden>
      <div className="aurora aurora-1" />
      <div className="aurora aurora-2" />
      <div className="aurora aurora-3" />
      <div className="aurora-grid" />
    </div>
  );
}

function AgentMessageFeed({ messages }: { messages: Array<{ fromRole: string; toRole: string; content: string; messageType: string; timestamp: number }> }) {
  if (messages.length === 0) return null;
  const TYPE_COLORS: Record<string, string> = {
    challenge: '#f59e0b', verification: '#10b981', correction: '#ef4444', output: '#6366f1',
  };
  return (
    <div className="message-feed">
      <div className="feed-header">
        <span className="feed-title">Agent Dialogue</span>
        <span className="feed-count">{messages.length} exchanges</span>
      </div>
      {messages.map((msg, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }} className="msg-item"
          style={{ borderLeftColor: TYPE_COLORS[msg.messageType] ?? '#27272a' }}>
          <div className="msg-header">
            <span className="msg-from" style={{ color: TYPE_COLORS[msg.messageType] ?? '#6366f1' }}>{msg.fromRole.toUpperCase()}</span>
            <span className="msg-arrow">→</span>
            <span className="msg-to">{msg.toRole.toUpperCase()}</span>
            <span className="msg-type">[{msg.messageType}]</span>
          </div>
          <div className="msg-preview">{msg.content.substring(0, 200)}{msg.content.length > 200 ? '…' : ''}</div>
        </motion.div>
      ))}
    </div>
  );
}

function ElapsedTimer({ ms, active }: { ms: number; active: boolean }) {
  if (!active && ms === 0) return null;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const display = m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  return (
    <motion.span className="elapsed"
      animate={active ? { opacity: [1, 0.5, 1] } : { opacity: 1 }}
      transition={{ duration: 1.5, repeat: active ? Infinity : 0 }}>
      {display}
    </motion.span>
  );
}

function mdToHtml(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[VERIFIED\]/g, '<span class="tag-verified">[VERIFIED]</span>')
    .replace(/\[DISPUTED\]/g, '<span class="tag-disputed">[DISPUTED]</span>')
    .replace(/\[UNVERIFIED\]/g, '<span class="tag-unverified">[UNVERIFIED]</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>');
}

function ResultView({ result }: { result: NonNullable<ReturnType<typeof useAgentV4>['state']['result']> }) {
  const [tab, setTab] = useState<'answer' | 'trace' | 'messages'>('answer');
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(result.answer); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  return (
    <div className="result-view">
      <div className="result-tabs-bar">
        {(['answer', 'trace', 'messages'] as const).map((t) => (
          <button key={t} className={`rtab ${tab === t ? 'rtab-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'answer' ? '📄 Answer' : t === 'trace' ? `🔍 Trace (${result.dag.nodes.length})` : `💬 Dialogue (${result.agentMessages.length})`}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="copy-btn" onClick={copy}>{copied ? '✓ Copied' : '⎘ Copy'}</button>
      </div>
      <AnimatePresence mode="wait">
        {tab === 'answer' && (
          <motion.div key="ans" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="answer-content">
            <div className="answer-meta">
              <span className="meta-pill" style={{ background: '#6366f120', color: '#818cf8' }}>{result.domain}</span>
              <span className="meta-pill" style={{ background: '#06b6d420', color: '#22d3ee' }}>{result.depth}</span>
              <span className="meta-pill" style={{ background: '#10b98120', color: '#34d399' }}>{result.confidence}% confidence</span>
            </div>
            <div className="md-body" dangerouslySetInnerHTML={{ __html: mdToHtml(result.answer) }} />
            {result.keyFindings.length > 0 && (
              <div className="key-findings">
                <div className="kf-title">Key Findings</div>
                {result.keyFindings.map((f, i) => (
                  <div key={i} className="kf-item"><span className="kf-dot" />{f}</div>
                ))}
              </div>
            )}
          </motion.div>
        )}
        {tab === 'trace' && (
          <motion.div key="trace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="trace-view">
            {result.dag.nodes.map((node, i) => (
              <div key={node.id} className={`trace-node trace-${node.status}`}>
                <div className="tn-index">{i + 1}</div>
                <div className="tn-body">
                  <div className="tn-role">{node.role.toUpperCase()}</div>
                  <div className="tn-label">{node.label}</div>
                  {node.endTime && node.startTime && <div className="tn-time">{node.endTime - node.startTime}ms</div>}
                  {node.confidence != null && <div className="tn-conf">{Math.round(node.confidence * 100)}%</div>}
                </div>
                <div className="tn-status">{node.status === 'done' ? '✓' : node.status === 'error' ? '✗' : '…'}</div>
              </div>
            ))}
            <div className="trace-summary">
              Total: {result.totalLatencyMs < 1000 ? `${result.totalLatencyMs}ms` : `${(result.totalLatencyMs / 1000).toFixed(1)}s`}
              {' · '}Circuit breaks: {result.circuitBreaks}
            </div>
          </motion.div>
        )}
        {tab === 'messages' && (
          <motion.div key="msgs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AgentMessageFeed messages={result.agentMessages} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Home() {
  const { state, run, abort, reset } = useAgentV4();
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep' | 'exhaustive'>('standard');
  const [domain, setDomain] = useState<DomainMode>('general');
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'gemini' | 'nvidia'>('anthropic');
  const [showSettings, setShowSettings] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isActive = ['planning', 'running', 'evaluating'].includes(state.status);
  const domainCfg = DOMAIN_CONFIGS[domain];
  const selectedProvider = PROVIDER_OPTIONS.find((p) => p.value === provider)!;
  const confidenceFromEval = state.evaluation ? Math.round(state.evaluation.overallScore * 100) : 0;
  const evalHistory = state.evaluation ? [Math.round(state.evaluation.overallScore * 100)] : [];

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [query]);

  function handleSubmit() {
    if (!query.trim() || isActive) return;
    run({ query: query.trim(), depth, domain, provider, model: selectedProvider.model, userId: 'anonymous' });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  }

  return (
    <div className="page">
      <AuroraBackground />

      <header className="hdr">
        <div className="hdr-left">
          <div className="logo-wrap">
            <div className="logo-hex">
              <svg viewBox="0 0 40 46" fill="none" width="22" height="26">
                <path d="M20 1L39 12V34L20 45L1 34V12L20 1Z" stroke="url(#lg)" strokeWidth="1.5" fill="url(#lgf)" />
                <defs>
                  <linearGradient id="lg" x1="0" y1="0" x2="40" y2="46" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6366f1" /><stop offset="1" stopColor="#06b6d4" />
                  </linearGradient>
                  <linearGradient id="lgf" x1="0" y1="0" x2="40" y2="46" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6366f110" /><stop offset="1" stopColor="#06b6d410" />
                  </linearGradient>
                </defs>
                <text x="20" y="29" textAnchor="middle" fill="url(#lg)" fontSize="14" fontWeight="700" fontFamily="monospace">N</text>
              </svg>
            </div>
            <div>
              <div className="logo-name">NexusAI</div>
              <div className="logo-tag">Quant-Grade Research Agent</div>
            </div>
          </div>
        </div>

        <div className="hdr-center">
          <div className="domain-pills">
            {(Object.keys(DOMAIN_CONFIGS) as DomainMode[]).map((d) => (
              <button key={d}
                className={`domain-pill ${domain === d ? 'domain-pill-active' : ''}`}
                style={domain === d ? { '--pill-color': DOMAIN_CONFIGS[d].color } as React.CSSProperties : {}}
                onClick={() => setDomain(d)} disabled={isActive}>
                <span>{DOMAIN_CONFIGS[d].icon}</span>
                {DOMAIN_CONFIGS[d].label}
              </button>
            ))}
          </div>
        </div>

        <div className="hdr-right">
          {isActive && (
            <motion.div className="live-badge" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.div className="live-dot" animate={{ scale: [1, 1.6, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
              LIVE
            </motion.div>
          )}
          <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Settings">⚙</button>
        </div>
      </header>

      <AnimatePresence>
        {state.status === 'idle' && (
          <motion.section className="hero" initial={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
            <motion.div className="hero-badge" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <span className="hero-badge-dot" />
              Multi-agent · Adversarial critique · Self-improving
            </motion.div>
            <motion.h1 className="hero-title" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}>
              Research that<span className="hero-gradient"> challenges itself</span>
            </motion.h1>
            <motion.p className="hero-sub" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              A Planner → Researcher → Critic → Verifier → Synthesizer system.
              Agents challenge each other. Circuit breakers handle failures.
              The system learns from every poor result.
            </motion.p>
            <motion.div className="feature-pills" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              {[
                { icon: '⬡', text: 'DAG Execution',     color: '#6366f1' },
                { icon: '⊘', text: 'Adversarial Critic', color: '#f59e0b' },
                { icon: '✓', text: 'Fact Verification',  color: '#10b981' },
                { icon: '⚡', text: 'Circuit Breakers',   color: '#06b6d4' },
                { icon: '◎', text: 'Self-Improving',     color: '#ec4899' },
              ].map(({ icon, text, color }) => (
                <div key={text} className="feature-pill" style={{ '--fp-color': color } as React.CSSProperties}>
                  <span style={{ color }}>{icon}</span>{text}
                </div>
              ))}
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="layout">
        <AnimatePresence>
          {showSettings && (
            <motion.aside className="sidebar"
              initial={{ opacity: 0, x: -20, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 220 }}
              exit={{ opacity: 0, x: -20, width: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
              <div className="sb-section">
                <div className="sb-label">Research Depth</div>
                {DEPTH_OPTIONS.map((opt) => (
                  <button key={opt.value} className={`sb-btn ${depth === opt.value ? 'sb-btn-active' : ''}`}
                    onClick={() => setDepth(opt.value)} disabled={isActive}>
                    <div className="sb-btn-main">{opt.label}</div>
                    <div className="sb-btn-sub">{opt.desc} · {opt.steps} steps</div>
                  </button>
                ))}
              </div>
              <div className="sb-section">
                <div className="sb-label">Provider</div>
                {PROVIDER_OPTIONS.map((opt) => (
                  <button key={opt.value} className={`sb-btn ${provider === opt.value ? 'sb-btn-active' : ''}`}
                    onClick={() => setProvider(opt.value)} disabled={isActive}>
                    <div className="sb-btn-main">
                      {opt.label}
                      {opt.badge && <span className="sb-badge">{opt.badge}</span>}
                    </div>
                    <div className="sb-btn-sub" style={{ fontSize: 9 }}>{opt.model}</div>
                  </button>
                ))}
              </div>
              <AnimatePresence>
                {(isActive || state.status === 'done') && confidenceFromEval > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="sb-section">
                    <div className="sb-label">Confidence</div>
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
                      <ConfidenceGauge value={confidenceFromEval} history={evalHistory} size="sm" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.aside>
          )}
        </AnimatePresence>

        <main className="main-col">
          <motion.div className="input-card" layout
            style={{ '--domain-color': domainCfg.color } as React.CSSProperties}>
            <div className="input-domain-strip"
              style={{ background: `linear-gradient(90deg, ${domainCfg.color}22, transparent)` }}>
              <span style={{ color: domainCfg.color }}>{domainCfg.icon}</span>
              <span className="input-domain-label">{domainCfg.label} Research</span>
              <span className="input-model-label">{selectedProvider.label} · {selectedProvider.model}</span>
              <button className="settings-toggle" onClick={() => setShowSettings((s) => !s)}>
                {showSettings ? '← Hide' : '⚙ Settings'}
              </button>
            </div>
            <textarea ref={textareaRef} className="query-ta"
              placeholder={`Ask a ${domainCfg.label.toLowerCase()} research question…`}
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey} disabled={isActive} rows={3} />
            <div className="input-footer">
              <div className="footer-left">
                <span className="char-count">{query.length}/2000</span>
                <span className="kb-hint">⌘↵ to run</span>
                <ElapsedTimer ms={state.elapsedMs} active={isActive} />
              </div>
              <div className="footer-actions">
                {(isActive || state.status !== 'idle') && (
                  <button className="btn-ghost" onClick={() => { abort(); reset(); setQuery(''); }}>
                    {isActive ? '■ Stop' : '↺ Reset'}
                  </button>
                )}
                <motion.button className="btn-run"
                  style={{ '--rc': domainCfg.color } as React.CSSProperties}
                  onClick={handleSubmit} disabled={!query.trim() || isActive}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  {isActive ? (
                    <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                      {state.status === 'planning' ? '◈ Planning…' : state.status === 'evaluating' ? '◎ Evaluating…' : '⬡ Researching…'}
                    </motion.span>
                  ) : `→ Run ${domainCfg.label} Research`}
                </motion.button>
              </div>
            </div>
          </motion.div>

          <AnimatePresence>
            {state.status === 'idle' && EXAMPLE_QUERIES[domain] && (
              <motion.div className="examples-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <span className="examples-label">Try:</span>
                {EXAMPLE_QUERIES[domain].map((ex) => (
                  <button key={ex} className="example-chip" onClick={() => setQuery(ex)}>
                    {ex.substring(0, 60)}{ex.length > 60 ? '…' : ''}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.dag && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
                <DAGGraph dag={state.dag} activeNodeId={state.activeNodeId} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.agentMessages.length > 0 && state.status !== 'done' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AgentMessageFeed messages={state.agentMessages} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.result && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 250, damping: 26 }}>
                <ResultView result={state.result} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.evaluation && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <EvaluationPanel evaluation={state.evaluation} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.improvements.length > 0 && (
              <motion.div className="improvement-notice" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <span className="imp-icon">◎</span>
                <div>
                  <div className="imp-title">System Learned</div>
                  <div className="imp-desc">{state.improvements[0].pattern} — {state.improvements[0].correction.substring(0, 120)}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.status === 'error' && state.error && (
              <motion.div className="error-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="err-title">Agent Error</div>
                <div className="err-msg">{state.error}</div>
                <button className="btn-ghost" onClick={reset}>Try Again</button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <style jsx global>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{color-scheme:dark;scroll-behavior:smooth}
        body{background:#060608;color:#f0f0f2;font-family:var(--font-inter,'Inter',system-ui,-apple-system,sans-serif);-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:hidden}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#27272a;border-radius:2px}
        ::selection{background:#312e81;color:#c7d2fe}
        .md-body h1{font-size:17px;font-weight:600;color:#f4f4f5;margin:18px 0 8px;border-bottom:0.5px solid #1e1e24;padding-bottom:8px}
        .md-body h2{font-size:14px;font-weight:500;color:#e4e4e7;margin:14px 0 6px}
        .md-body h3{font-size:13px;font-weight:500;color:#d4d4d8;margin:10px 0 4px}
        .md-body p{margin:8px 0;color:#a1a1aa;line-height:1.8;font-size:13.5px}
        .md-body ul{padding-left:16px;margin:8px 0}
        .md-body li{margin:4px 0;color:#a1a1aa;font-size:13px;line-height:1.7}
        .md-body strong{color:#f4f4f5;font-weight:500}
        .md-body code{font-family:'JetBrains Mono',monospace;font-size:12px;background:#1a1a2e;padding:1px 6px;border-radius:4px;color:#818cf8;border:0.5px solid #312e81}
        .md-body hr{border:none;border-top:0.5px solid #1e1e24;margin:16px 0}
        .tag-verified{color:#10b981;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace}
        .tag-disputed{color:#f59e0b;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace}
        .tag-unverified{color:#52525b;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace}
      `}</style>

      <style jsx>{`
        .aurora-container{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
        .aurora{position:absolute;border-radius:50%;filter:blur(80px);opacity:0.12;animation:afloat 20s ease-in-out infinite}
        .aurora-1{width:700px;height:500px;top:-100px;left:-100px;background:radial-gradient(circle,#6366f1,#312e81,transparent);animation-delay:0s}
        .aurora-2{width:600px;height:400px;top:20%;right:-150px;background:radial-gradient(circle,#06b6d4,#0e7490,transparent);animation-delay:-7s}
        .aurora-3{width:500px;height:600px;bottom:-100px;left:30%;background:radial-gradient(circle,#ec4899,#831843,transparent);animation-delay:-14s}
        .aurora-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px);background-size:40px 40px}
        @keyframes afloat{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(40px,-30px) scale(1.1)}66%{transform:translate(-20px,20px) scale(0.95)}}
        .page{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column}
        .hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:0.5px solid #1e1e24;background:rgba(6,6,8,0.85);backdrop-filter:blur(16px);position:sticky;top:0;z-index:50;gap:16px}
        .hdr-left,.hdr-right{flex-shrink:0}
        .hdr-center{flex:1;display:flex;justify-content:center}
        .logo-wrap{display:flex;align-items:center;gap:10px}
        .logo-name{font-size:14px;font-weight:600;letter-spacing:-0.03em;color:#f4f4f5}
        .logo-tag{font-size:9px;color:#52525b;letter-spacing:0.06em;font-family:'JetBrains Mono',monospace;text-transform:uppercase}
        .hdr-right{display:flex;align-items:center;gap:10px}
        .live-badge{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#10b981;font-family:'JetBrains Mono',monospace;letter-spacing:0.08em}
        .live-dot{width:6px;height:6px;border-radius:50%;background:#10b981}
        .icon-btn{background:transparent;border:0.5px solid #27272a;color:#52525b;width:30px;height:30px;border-radius:7px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
        .icon-btn:hover{background:#1a1a1f;color:#a1a1aa}
        .domain-pills{display:flex;gap:4px;flex-wrap:wrap;justify-content:center}
        .domain-pill{display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;border:0.5px solid #27272a;background:transparent;color:#71717a;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;transition:all 0.2s;white-space:nowrap}
        .domain-pill:hover:not(:disabled){border-color:#3f3f46;color:#a1a1aa}
        .domain-pill-active{background:color-mix(in srgb,var(--pill-color) 15%,transparent);border-color:color-mix(in srgb,var(--pill-color) 50%,transparent);color:var(--pill-color)}
        .domain-pill:disabled{opacity:0.5;cursor:not-allowed}
        .hero{padding:56px 24px 32px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;max-width:740px;margin:0 auto;width:100%}
        .hero-badge{display:flex;align-items:center;gap:7px;font-size:11px;color:#71717a;letter-spacing:0.05em;border:0.5px solid #27272a;padding:5px 14px;border-radius:9999px;background:rgba(255,255,255,0.02)}
        .hero-badge-dot{width:5px;height:5px;border-radius:50%;background:#6366f1;box-shadow:0 0 6px #6366f1}
        .hero-title{font-size:clamp(32px,5vw,52px);font-weight:700;line-height:1.1;letter-spacing:-0.04em;color:#f4f4f5}
        .hero-gradient{background:linear-gradient(135deg,#6366f1,#06b6d4,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .hero-sub{font-size:15px;color:#71717a;line-height:1.7;max-width:520px}
        .feature-pills{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:4px}
        .feature-pill{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:7px;font-size:11px;font-weight:500;color:#71717a;border:0.5px solid #1e1e24;background:rgba(255,255,255,0.02);transition:all 0.2s}
        .feature-pill:hover{border-color:color-mix(in srgb,var(--fp-color) 40%,transparent);color:var(--fp-color)}
        .layout{display:flex;flex:1;gap:0}
        .sidebar{flex-shrink:0;overflow:hidden;border-right:0.5px solid #1e1e24;background:rgba(6,6,8,0.7);backdrop-filter:blur(12px);padding:16px 12px;display:flex;flex-direction:column;gap:16px}
        .sb-section{display:flex;flex-direction:column;gap:4px}
        .sb-label{font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:#3f3f46;margin-bottom:4px;padding-left:4px;font-family:'JetBrains Mono',monospace}
        .sb-btn{width:100%;padding:8px 10px;border-radius:8px;border:0.5px solid transparent;background:transparent;text-align:left;cursor:pointer;font-family:inherit;transition:all 0.15s}
        .sb-btn:hover:not(:disabled){background:#111116}
        .sb-btn-active{background:#111116;border-color:#27272a}
        .sb-btn:disabled{opacity:0.5;cursor:not-allowed}
        .sb-btn-main{font-size:12px;font-weight:500;color:#d4d4d8;display:flex;align-items:center;gap:6px}
        .sb-btn-sub{font-size:10px;color:#52525b;margin-top:2px;font-family:'JetBrains Mono',monospace}
        .sb-badge{font-size:9px;padding:1px 6px;background:#312e81;color:#a5b4fc;border-radius:4px}
        .main-col{flex:1;min-width:0;padding:20px 24px;display:flex;flex-direction:column;gap:12px;overflow-y:auto}
        .input-card{background:rgba(13,13,16,0.92);border:0.5px solid #1e1e24;border-top:1.5px solid var(--domain-color,#6366f1);border-radius:14px;overflow:hidden;backdrop-filter:blur(8px);box-shadow:0 0 40px color-mix(in srgb,var(--domain-color,#6366f1) 8%,transparent)}
        .input-domain-strip{display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:11px;border-bottom:0.5px solid #1a1a1f}
        .input-domain-label{font-weight:500;color:#71717a}
        .input-model-label{color:#3f3f46;font-family:'JetBrains Mono',monospace;font-size:10px}
        .settings-toggle{margin-left:auto;font-size:11px;color:#52525b;background:transparent;border:0.5px solid #27272a;padding:2px 8px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all 0.15s}
        .settings-toggle:hover{color:#a1a1aa}
        .query-ta{width:100%;padding:14px 16px;background:transparent;border:none;outline:none;color:#f0f0f2;font-family:inherit;font-size:14.5px;line-height:1.8;resize:none;caret-color:var(--domain-color,#6366f1)}
        .query-ta::placeholder{color:#3f3f46}
        .query-ta:disabled{opacity:0.6}
        .input-footer{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-top:0.5px solid #111116}
        .footer-left{display:flex;align-items:center;gap:12px}
        .footer-actions{display:flex;gap:6px}
        .char-count{font-size:11px;color:#3f3f46;font-family:'JetBrains Mono',monospace}
        .kb-hint{font-size:10px;color:#27272a}
        .elapsed{font-size:11px;color:#52525b;font-family:'JetBrains Mono',monospace}
        .btn-ghost{padding:6px 12px;border-radius:7px;background:transparent;color:#71717a;border:0.5px solid #27272a;font-size:12px;cursor:pointer;font-family:inherit;transition:all 0.15s}
        .btn-ghost:hover{background:#111116;color:#a1a1aa}
        .btn-run{padding:8px 18px;border-radius:8px;background:linear-gradient(135deg,var(--rc,#6366f1),color-mix(in srgb,var(--rc,#6366f1) 70%,#06b6d4));color:white;border:none;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;letter-spacing:-0.01em;box-shadow:0 4px 20px color-mix(in srgb,var(--rc,#6366f1) 30%,transparent);transition:box-shadow 0.2s,opacity 0.2s}
        .btn-run:disabled{opacity:0.5;cursor:not-allowed;box-shadow:none}
        .examples-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .examples-label{font-size:11px;color:#3f3f46;flex-shrink:0}
        .example-chip{padding:5px 12px;border-radius:7px;background:#111116;border:0.5px solid #1e1e24;color:#71717a;font-size:11px;cursor:pointer;font-family:inherit;text-align:left;transition:all 0.15s;line-height:1.4}
        .example-chip:hover{background:#1a1a1f;color:#a1a1aa;border-color:#27272a}
        .message-feed{background:#0a0a0d;border:0.5px solid #1e1e24;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
        .feed-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
        .feed-title{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#3f3f46;font-family:'JetBrains Mono',monospace}
        .feed-count{font-size:10px;color:#3f3f46}
        .msg-item{border-left:2px solid #27272a;padding:6px 10px;display:flex;flex-direction:column;gap:3px}
        .msg-header{display:flex;align-items:center;gap:6px}
        .msg-from{font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace}
        .msg-arrow{font-size:10px;color:#27272a}
        .msg-to{font-size:10px;color:#52525b;font-family:'JetBrains Mono',monospace}
        .msg-type{font-size:9px;color:#3f3f46}
        .msg-preview{font-size:11px;color:#71717a;line-height:1.6}
        .result-view{background:#0a0a0d;border:0.5px solid #1e1e24;border-radius:14px;overflow:hidden}
        .result-tabs-bar{display:flex;align-items:center;gap:2px;padding:8px 12px;border-bottom:0.5px solid #111116;background:#0d0d10}
        .rtab{padding:4px 12px;border-radius:6px;font-size:12px;border:none;background:transparent;color:#52525b;cursor:pointer;transition:all 0.15s;font-family:inherit}
        .rtab:hover{color:#a1a1aa;background:#111116}
        .rtab-active{color:#e4e4e7;background:#1a1a2e}
        .copy-btn{padding:4px 10px;border-radius:6px;font-size:11px;border:0.5px solid #27272a;background:transparent;color:#71717a;cursor:pointer;font-family:inherit;transition:all 0.15s}
        .copy-btn:hover{color:#a1a1aa}
        .answer-content{padding:20px 22px}
        .answer-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
        .meta-pill{font-size:10px;font-weight:500;padding:3px 9px;border-radius:5px;font-family:'JetBrains Mono',monospace}
        .key-findings{margin-top:20px;padding-top:16px;border-top:0.5px solid #1e1e24}
        .kf-title{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#3f3f46;margin-bottom:8px;font-family:'JetBrains Mono',monospace}
        .kf-item{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#a1a1aa;line-height:1.7;padding:3px 0}
        .kf-dot{width:4px;height:4px;border-radius:50%;background:#6366f1;flex-shrink:0;margin-top:7px}
        .trace-view{padding:12px;display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto}
        .trace-node{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:0.5px solid #1e1e24;background:#0f0f12}
        .trace-node.trace-done{border-color:#1a2a1a}
        .trace-node.trace-error{border-color:#2a1a1a}
        .trace-node.trace-running{border-color:#1a1a2e}
        .tn-index{font-size:11px;color:#3f3f46;font-family:'JetBrains Mono',monospace;min-width:16px}
        .tn-body{flex:1;display:flex;align-items:center;gap:10px}
        .tn-role{font-size:10px;font-weight:600;color:#818cf8;font-family:'JetBrains Mono',monospace;min-width:70px}
        .tn-label{font-size:11px;color:#71717a}
        .tn-time{font-size:10px;color:#06b6d4;font-family:'JetBrains Mono',monospace;margin-left:auto}
        .tn-conf{font-size:10px;color:#10b981;font-family:'JetBrains Mono',monospace}
        .tn-status{font-size:12px}
        .trace-done .tn-status{color:#10b981}
        .trace-error .tn-status{color:#ef4444}
        .trace-running .tn-status{color:#6366f1}
        .trace-summary{font-size:11px;color:#3f3f46;font-family:'JetBrains Mono',monospace;text-align:center;padding:8px 0 4px}
        .improvement-notice{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:#0a0a14;border:0.5px solid #1e1e3a;border-radius:10px}
        .imp-icon{font-size:16px;color:#6366f1;flex-shrink:0;padding-top:2px}
        .imp-title{font-size:12px;font-weight:500;color:#818cf8;margin-bottom:4px}
        .imp-desc{font-size:11px;color:#52525b;line-height:1.6}
        .error-card{background:#0f0505;border:0.5px solid #450a0a;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
        .err-title{font-size:13px;font-weight:500;color:#ef4444}
        .err-msg{font-size:11px;color:#fca5a5;font-family:'JetBrains Mono',monospace}
      `}</style>
    </div>
  );
}
