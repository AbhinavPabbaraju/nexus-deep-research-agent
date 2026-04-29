// ─── src/components/AgentTimeline.tsx ────────────────────────────────────────
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { StepResult, PlanResult, EvalResult } from '@/lib/agent/types';
import type { AgentStatus } from '@/hooks/useAgent';

const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  search:    { icon: '⌕',  label: 'Search',    color: '#6366f1' },
  retrieve:  { icon: '⬡',  label: 'Retrieve',  color: '#06b6d4' },
  reason:    { icon: '◎',  label: 'Reason',    color: '#f59e0b' },
  compute:   { icon: '∑',  label: 'Compute',   color: '#8b5cf6' },
  critique:  { icon: '⊘',  label: 'Critique',  color: '#ef4444' },
  synthesize:{ icon: '⊕',  label: 'Synthesize',color: '#10b981' },
};

interface Props {
  steps: StepResult[];
  currentStep: Partial<StepResult> | null;
  plan: PlanResult | null;
  evaluations: EvalResult[];
  loopCount: number;
  status: AgentStatus;
}

export function AgentTimeline({ steps, currentStep, plan, evaluations, loopCount, status }: Props) {
  const latestEval = evaluations.at(-1);

  return (
    <div className="agent-timeline">
      {/* Header */}
      <div className="timeline-header">
        <div className="timeline-meta">
          {loopCount > 0 && (
            <span className="loop-badge">Loop {loopCount}{plan ? `/${plan.maxSteps}` : ''}</span>
          )}
          {plan && (
            <span className="intent-badge">{plan.intent}</span>
          )}
        </div>
        {latestEval && (
          <div className="eval-action" data-action={latestEval.action}>
            {latestEval.action}
          </div>
        )}
      </div>

      {/* Steps track */}
      <div className="steps-track">
        <AnimatePresence mode="popLayout">
          {steps.map((step, i) => {
            const meta = TOOL_META[step.tool] ?? { icon: '◇', label: step.tool, color: '#64748b' };
            return (
              <motion.div
                key={step.stepId}
                layout
                initial={{ opacity: 0, x: -16, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 450, damping: 32, delay: i * 0.04 }}
                className={`step-node step-${step.status}`}
                style={{ '--tool-color': meta.color } as React.CSSProperties}
              >
                <div className="step-icon">{meta.icon}</div>
                <div className="step-body">
                  <div className="step-name">{meta.label}</div>
                  {step.latencyMs > 0 && (
                    <div className="step-meta">
                      {step.latencyMs < 1000 ? `${step.latencyMs}ms` : `${(step.latencyMs / 1000).toFixed(1)}s`}
                      {step.tokensUsed > 0 && ` · ${step.tokensUsed.toLocaleString()} tok`}
                    </div>
                  )}
                </div>
                <div className="step-status-icon">
                  {step.status === 'done' && '✓'}
                  {step.status === 'error' && '✗'}
                </div>
              </motion.div>
            );
          })}

          {/* Current running step */}
          {currentStep && (
            <motion.div
              key="current"
              layout
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              className="step-node step-running"
              style={{ '--tool-color': TOOL_META[currentStep.tool ?? '']?.color ?? '#6366f1' } as React.CSSProperties}
            >
              <div className="step-icon">{TOOL_META[currentStep.tool ?? '']?.icon ?? '◇'}</div>
              <div className="step-body">
                <div className="step-name">{TOOL_META[currentStep.tool ?? '']?.label ?? currentStep.tool}</div>
                <div className="step-meta">running…</div>
              </div>
              <motion.div
                className="thinking-dot"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Planning state */}
        {status === 'planning' && steps.length === 0 && !currentStep && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="planning-indicator"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="planning-spinner"
            />
            <span>Planning research strategy…</span>
          </motion.div>
        )}
      </div>

      {/* Evaluation strip */}
      {latestEval && latestEval.gaps.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="eval-strip"
        >
          <span className="eval-label">Gaps identified:</span>
          {latestEval.gaps.slice(0, 2).map((gap, i) => (
            <span key={i} className="eval-gap">{gap}</span>
          ))}
        </motion.div>
      )}

      <style jsx>{`
        .agent-timeline {
          background: #111113;
          border: 0.5px solid #27272a;
          border-radius: 10px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .timeline-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .timeline-meta { display: flex; gap: 6px; align-items: center; }
        .loop-badge {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          background: #1a1a2e;
          color: #818cf8;
          border: 0.5px solid #3730a3;
          padding: 2px 8px;
          border-radius: 9999px;
        }
        .intent-badge {
          font-size: 10px;
          color: #71717a;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .eval-action {
          font-size: 10px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 4px;
          background: #1a1a1f;
          border: 0.5px solid #27272a;
          color: #a1a1aa;
        }
        .eval-action[data-action='DONE'] { color: #10b981; border-color: #064e3b; }
        .eval-action[data-action='PIVOT'] { color: #f59e0b; border-color: #451a03; }
        .eval-action[data-action='EXPAND'] { color: #6366f1; border-color: #312e81; }
        .eval-action[data-action='FALLBACK'] { color: #ef4444; border-color: #450a0a; }
        .steps-track {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-height: 48px;
          align-items: flex-start;
        }
        .step-node {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 7px;
          border: 0.5px solid #27272a;
          background: #0f0f11;
          position: relative;
          transition: border-color 0.2s;
        }
        .step-node.step-done { border-color: color-mix(in srgb, var(--tool-color) 40%, transparent); }
        .step-node.step-running { border-color: var(--tool-color); box-shadow: 0 0 10px color-mix(in srgb, var(--tool-color) 20%, transparent); }
        .step-node.step-error { border-color: #450a0a; }
        .step-icon {
          font-size: 14px;
          color: var(--tool-color);
          width: 20px;
          text-align: center;
          flex-shrink: 0;
        }
        .step-body { display: flex; flex-direction: column; gap: 1px; }
        .step-name { font-size: 12px; font-weight: 500; color: #e4e4e7; }
        .step-meta { font-size: 10px; color: #52525b; font-family: 'JetBrains Mono', monospace; }
        .step-status-icon { font-size: 11px; }
        .step-done .step-status-icon { color: #10b981; }
        .step-error .step-status-icon { color: #ef4444; }
        .thinking-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--tool-color);
          flex-shrink: 0;
        }
        .planning-indicator {
          display: flex; align-items: center; gap: 8px;
          color: #52525b; font-size: 12px;
          padding: 8px 0;
        }
        .planning-spinner {
          width: 14px; height: 14px;
          border: 1.5px solid #27272a;
          border-top-color: #6366f1;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .eval-strip {
          display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
          padding-top: 8px;
          border-top: 0.5px solid #1a1a1f;
          overflow: hidden;
        }
        .eval-label { font-size: 10px; color: #52525b; text-transform: uppercase; letter-spacing: 0.06em; }
        .eval-gap {
          font-size: 10px; color: #71717a;
          background: #1a1a1f; border: 0.5px solid #27272a;
          padding: 2px 7px; border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
