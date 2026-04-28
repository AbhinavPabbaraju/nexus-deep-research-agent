// ─── src/components/ResultPanel.tsx ──────────────────────────────────────────
'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentResult } from '@/lib/agent/types';

interface Props {
  result: AgentResult | null;
  streamingText?: string;
  isStreaming?: boolean;
}

export function ResultPanel({ result, streamingText, isStreaming }: Props) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'answer' | 'trace' | 'meta'>('answer');

  const displayText = result?.answer ?? streamingText ?? '';

  function handleCopy() {
    if (!displayText) return;
    navigator.clipboard.writeText(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!displayText && !isStreaming) return null;

  return (
    <motion.div
      className="result-panel"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      {/* Tab bar */}
      {result && (
        <div className="result-tabs">
          {(['answer', 'trace', 'meta'] as const).map((tab) => (
            <button
              key={tab}
              className={`result-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'answer' && '📄 Answer'}
              {tab === 'trace' && `🔍 Trace (${result.trace.length})`}
              {tab === 'meta' && '📊 Metrics'}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="copy-btn" onClick={handleCopy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* Answer tab */}
      <AnimatePresence mode="wait">
        {(!result || activeTab === 'answer') && (
          <motion.div
            key="answer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="result-content"
          >
            <MarkdownRenderer text={displayText} />
            {isStreaming && (
              <motion.span
                className="cursor"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              >▌</motion.span>
            )}
          </motion.div>
        )}

        {/* Trace tab */}
        {result && activeTab === 'trace' && (
          <motion.div key="trace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="trace-list">
            {result.trace.map((step, i) => (
              <div key={step.stepId} className={`trace-item trace-${step.status}`}>
                <div className="trace-header">
                  <span className="trace-index">{i + 1}</span>
                  <span className="trace-tool">{step.tool.toUpperCase()}</span>
                  <span className="trace-provider">{step.provider}/{step.model}</span>
                  <span className="trace-latency">{step.latencyMs}ms</span>
                  <span className="trace-tokens">{step.tokensUsed.toLocaleString()} tok</span>
                  <span className={`trace-status trace-status-${step.status}`}>{step.status}</span>
                </div>
                {step.output && (
                  <details className="trace-output">
                    <summary>Output preview</summary>
                    <pre>{step.output.substring(0, 600)}{step.output.length > 600 ? '…' : ''}</pre>
                  </details>
                )}
              </div>
            ))}
          </motion.div>
        )}

        {/* Meta tab */}
        {result && activeTab === 'meta' && (
          <motion.div key="meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="meta-grid">
            {[
              { label: 'Run ID',      value: result.runId.substring(0, 8) + '…' },
              { label: 'Confidence',  value: `${result.confidence}%` },
              { label: 'Steps',       value: result.stepsExecuted },
              { label: 'Loops',       value: result.loopCount },
              { label: 'Tokens',      value: result.totalTokens.toLocaleString() },
              { label: 'Cost',        value: `$${result.totalCostUsd.toFixed(4)}` },
              { label: 'Latency',     value: `${(result.totalLatencyMs / 1000).toFixed(1)}s` },
              { label: 'Provider',    value: result.provider },
              { label: 'Model',       value: result.model },
              { label: 'Depth',       value: result.depth },
            ].map(({ label, value }) => (
              <div key={label} className="meta-item">
                <div className="meta-label">{label}</div>
                <div className="meta-value">{value}</div>
              </div>
            ))}
            {result.keyFindings.length > 0 && (
              <div className="meta-findings">
                <div className="meta-label" style={{ marginBottom: 6 }}>Key Findings</div>
                {result.keyFindings.map((f, i) => (
                  <div key={i} className="meta-finding">· {f}</div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        .result-panel {
          background: #0d0d0f;
          border: 0.5px solid #27272a;
          border-radius: 12px;
          overflow: hidden;
        }
        .result-tabs {
          display: flex; gap: 2px; align-items: center;
          padding: 8px 12px;
          border-bottom: 0.5px solid #1a1a1f;
          background: #111113;
        }
        .result-tab {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 12px;
          border: none;
          background: transparent;
          color: #52525b;
          cursor: pointer;
          transition: all 0.15s;
          font-family: inherit;
        }
        .result-tab:hover { color: #a1a1aa; background: #1a1a1f; }
        .result-tab.active { color: #e4e4e7; background: #1a1a2e; }
        .copy-btn {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 11px;
          border: 0.5px solid #27272a;
          background: transparent;
          color: #71717a;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .copy-btn:hover { color: #a1a1aa; border-color: #3f3f46; }
        .result-content {
          padding: 20px 24px;
          color: #d4d4d8;
          font-size: 14px;
          line-height: 1.8;
          max-height: 60vh;
          overflow-y: auto;
        }
        .cursor { color: #6366f1; margin-left: 1px; }
        .trace-list { padding: 12px; display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; }
        .trace-item {
          background: #111113;
          border: 0.5px solid #27272a;
          border-radius: 8px;
          overflow: hidden;
        }
        .trace-item.trace-error { border-color: #450a0a; }
        .trace-header {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          flex-wrap: wrap;
        }
        .trace-index { color: #3f3f46; min-width: 16px; }
        .trace-tool { color: #818cf8; font-weight: 500; }
        .trace-provider { color: #52525b; }
        .trace-latency { color: #06b6d4; }
        .trace-tokens { color: #f59e0b; }
        .trace-status { margin-left: auto; }
        .trace-status-done { color: #10b981; }
        .trace-status-error { color: #ef4444; }
        .trace-output summary { padding: 4px 12px 8px; font-size: 11px; color: #52525b; cursor: pointer; }
        .trace-output pre {
          margin: 0; padding: 8px 12px;
          background: #0a0a0c;
          font-size: 11px; line-height: 1.6;
          color: #71717a;
          white-space: pre-wrap;
          word-break: break-word;
          border-top: 0.5px solid #1a1a1f;
        }
        .meta-grid { padding: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
        .meta-item {
          background: #111113;
          border: 0.5px solid #1a1a1f;
          border-radius: 8px;
          padding: 10px 14px;
          min-width: 120px;
        }
        .meta-label { font-size: 10px; color: #52525b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
        .meta-value { font-size: 13px; font-weight: 500; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
        .meta-findings { width: 100%; background: #111113; border: 0.5px solid #1a1a1f; border-radius: 8px; padding: 12px 14px; }
        .meta-finding { font-size: 12px; color: #a1a1aa; line-height: 1.7; }
      `}</style>
    </motion.div>
  );
}

// Minimal markdown renderer (no external deps)
function MarkdownRenderer({ text }: { text: string }) {
  const html = text
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h|u|l|h|p|c])/gm, '');

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} className="markdown-body" />
      <style jsx>{`
        .markdown-body :global(h1) { font-size: 18px; font-weight: 600; color: #f4f4f5; margin: 16px 0 8px; border-bottom: 0.5px solid #27272a; padding-bottom: 8px; }
        .markdown-body :global(h2) { font-size: 15px; font-weight: 500; color: #e4e4e7; margin: 14px 0 6px; }
        .markdown-body :global(h3) { font-size: 13px; font-weight: 500; color: #d4d4d8; margin: 10px 0 4px; }
        .markdown-body :global(p) { margin: 8px 0; }
        .markdown-body :global(ul) { padding-left: 18px; margin: 8px 0; }
        .markdown-body :global(li) { margin: 4px 0; color: #a1a1aa; }
        .markdown-body :global(strong) { color: #f4f4f5; font-weight: 500; }
        .markdown-body :global(code) { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: #1a1a1f; padding: 1px 5px; border-radius: 4px; color: #818cf8; }
        .markdown-body :global(hr) { border: none; border-top: 0.5px solid #27272a; margin: 14px 0; }
      `}</style>
    </>
  );
}
