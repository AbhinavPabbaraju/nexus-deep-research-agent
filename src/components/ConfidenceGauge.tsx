// ─── src/components/ConfidenceGauge.tsx ──────────────────────────────────────
'use client';

import { motion } from 'framer-motion';

interface Props {
  value: number;        // 0–100
  history?: number[];   // per-loop confidence values
  size?: 'sm' | 'md';
}

const ARC_LENGTH = 157; // half-circle arc at r=50

export function ConfidenceGauge({ value, history = [], size = 'md' }: Props) {
  const clamped = Math.min(100, Math.max(0, value));
  const offset = ARC_LENGTH * (1 - clamped / 100);
  const color = clamped >= 80 ? '#10b981' : clamped >= 60 ? '#f59e0b' : '#ef4444';
  const dim = size === 'sm' ? 80 : 120;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg viewBox="0 0 120 70" width={dim} style={{ overflow: 'visible' }}>
        {/* Track */}
        <path d="M10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#27272a" strokeWidth="7" strokeLinecap="round" />
        {/* Value arc */}
        <motion.path
          d="M10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          initial={{ strokeDashoffset: ARC_LENGTH }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 80, damping: 20, delay: 0.1 }}
          style={{ filter: `drop-shadow(0 0 4px ${color}60)` }}
        />
        {/* Glow dot at tip */}
        <motion.circle
          r="4"
          fill={color}
          animate={{
            cx: 60 + 50 * Math.cos(Math.PI * (1 - clamped / 100)),
            cy: 60 - 50 * Math.sin(Math.PI * (1 - clamped / 100)),
          }}
          transition={{ type: 'spring', stiffness: 80, damping: 20 }}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
        {/* Labels */}
        <text x="10" y="72" textAnchor="middle" fill="#3f3f46" fontSize="8">0</text>
        <text x="110" y="72" textAnchor="middle" fill="#3f3f46" fontSize="8">100</text>
        {/* Center value */}
        <motion.text
          x="60" y="52"
          textAnchor="middle"
          fill={color}
          fontSize="22"
          fontWeight="700"
          fontFamily="'JetBrains Mono', monospace"
          animate={{ opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 2, repeat: value < 80 ? Infinity : 0 }}
        >
          {clamped}
        </motion.text>
        <text x="60" y="65" textAnchor="middle" fill="#52525b" fontSize="7" letterSpacing="0.1em">CONFIDENCE</text>
      </svg>

      {/* Mini sparkline */}
      {history.length > 1 && (
        <svg viewBox={`0 0 ${history.length * 12} 20`} width={Math.min(80, history.length * 12)} height={20}>
          <polyline
            points={history.map((v, i) => `${i * 12 + 6},${20 - (v / 100) * 16}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.6"
          />
          {history.map((v, i) => (
            <circle key={i} cx={i * 12 + 6} cy={20 - (v / 100) * 16} r="2" fill={color} opacity="0.8" />
          ))}
        </svg>
      )}
    </div>
  );
}
