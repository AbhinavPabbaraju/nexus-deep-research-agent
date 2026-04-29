// ─── src/components/EvaluationPanel.tsx ──────────────────────────────────────
'use client';

import { motion } from 'framer-motion';
import type { EvaluationResult } from '@/lib/agent/types-v4';

interface Props { evaluation: EvaluationResult }

const METRICS = [
  { key: 'factualAccuracy', label: 'Factual Accuracy', color: '#6366f1', weight: '35%' },
  { key: 'completeness',    label: 'Completeness',     color: '#06b6d4', weight: '25%' },
  { key: 'coherence',       label: 'Coherence',        color: '#10b981', weight: '25%' },
  { key: 'citationQuality', label: 'Citation Quality', color: '#f59e0b', weight: '15%' },
] as const;

function ScoreBar({ value, color, delay = 0 }: { value: number; color: string; delay?: number }) {
  return (
    <div style={{ height: 4, background: '#1a1a1f', borderRadius: 2, overflow: 'hidden' }}>
      <motion.div
        style={{ height: '100%', background: color, borderRadius: 2 }}
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

export function EvaluationPanel({ evaluation }: Props) {
  const overall = evaluation.overallScore;
  const overallColor = overall >= 0.8 ? '#10b981' : overall >= 0.6 ? '#f59e0b' : '#ef4444';
  const calGrade = evaluation.calibrationError < 0.1 ? 'Excellent' :
                   evaluation.calibrationError < 0.2 ? 'Good' : 'Poor';

  return (
    <motion.div
      className="eval-panel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      <div className="eval-header">
        <span className="eval-title">Quality Evaluation</span>
        <motion.div
          className="overall-score"
          style={{ color: overallColor }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, delay: 0.2 }}
        >
          {Math.round(overall * 100)}
          <span className="score-unit">/100</span>
        </motion.div>
      </div>

      <div className="metrics-grid">
        {METRICS.map(({ key, label, color, weight }, i) => {
          const val = evaluation[key];
          return (
            <div key={key} className="metric-item">
              <div className="metric-row">
                <span className="metric-label">{label}</span>
                <span className="metric-weight">{weight}</span>
                <span className="metric-value" style={{ color }}>
                  {Math.round(val * 100)}%
                </span>
              </div>
              <ScoreBar value={val} color={color} delay={i * 0.1} />
            </div>
          );
        })}
      </div>

      <div className="eval-footer">
        <div className="cal-box">
          <div className="cal-label">Calibration</div>
          <div className="cal-value" style={{ color: evaluation.calibrationError < 0.15 ? '#10b981' : '#f59e0b' }}>
            {calGrade} <span style={{ color: '#52525b', fontSize: 10 }}>({(evaluation.calibrationError * 100).toFixed(1)}% err)</span>
          </div>
        </div>
        {evaluation.regressionVsBaseline !== 0 && (
          <div className="regression-box">
            <div className="cal-label">vs Baseline</div>
            <div className="cal-value" style={{ color: evaluation.regressionVsBaseline > 0 ? '#10b981' : '#ef4444' }}>
              {evaluation.regressionVsBaseline > 0 ? '+' : ''}{(evaluation.regressionVsBaseline * 100).toFixed(1)}%
            </div>
          </div>
        )}
        {evaluation.issues.length > 0 && (
          <div className="issues-list">
            <div className="cal-label" style={{ marginBottom: 4 }}>Issues</div>
            {evaluation.issues.slice(0, 2).map((issue, i) => (
              <div key={i} className="issue-item">· {issue}</div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .eval-panel { background: #0d0d0f; border: 0.5px solid #1e1e24; border-radius: 12px; padding: 14px 16px; }
        .eval-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .eval-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #3f3f46; font-family: 'JetBrains Mono', monospace; }
        .overall-score { font-size: 28px; font-weight: 700; font-family: 'JetBrains Mono', monospace; display: flex; align-items: baseline; gap: 2px; }
        .score-unit { font-size: 12px; color: #52525b; font-weight: 400; }
        .metrics-grid { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
        .metric-item { display: flex; flex-direction: column; gap: 5px; }
        .metric-row { display: flex; align-items: center; gap: 6px; }
        .metric-label { font-size: 11px; color: #71717a; flex: 1; }
        .metric-weight { font-size: 9px; color: #3f3f46; font-family: 'JetBrains Mono', monospace; }
        .metric-value { font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono', monospace; min-width: 32px; text-align: right; }
        .eval-footer { border-top: 0.5px solid #1a1a1f; padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .cal-box, .regression-box { display: flex; align-items: center; justify-content: space-between; }
        .cal-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #3f3f46; }
        .cal-value { font-size: 12px; font-weight: 500; }
        .issues-list { padding-top: 4px; }
        .issue-item { font-size: 11px; color: #71717a; line-height: 1.7; }
      `}</style>
    </motion.div>
  );
}
