// ─── src/components/graph/DAGGraph.tsx ───────────────────────────────────────
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { ExecutionDAG, DAGNode, AgentRole } from '@/lib/agent/types-v4';

const ROLE_CONFIG: Record<AgentRole, { color: string; glow: string; icon: string; shortLabel: string }> = {
  planner:     { color: '#6366f1', glow: '#6366f140', icon: '◈', shortLabel: 'Plan'    },
  researcher:  { color: '#06b6d4', glow: '#06b6d440', icon: '⬡', shortLabel: 'Research'},
  critic:      { color: '#f59e0b', glow: '#f59e0b40', icon: '⊘', shortLabel: 'Critique'},
  verifier:    { color: '#10b981', glow: '#10b98140', icon: '✓', shortLabel: 'Verify'  },
  synthesizer: { color: '#ec4899', glow: '#ec489940', icon: '⊕', shortLabel: 'Synth'   },
};

interface Props {
  dag: ExecutionDAG;
  activeNodeId: string | null;
}

export function DAGGraph({ dag, activeNodeId }: Props) {
  const nodeCount = dag.nodes.length;
  const nodeWidth = 96;
  const nodeHeight = 64;
  const hGap = 28;
  const totalW = nodeCount * nodeWidth + (nodeCount - 1) * hGap;
  const svgH = 140;

  // Lay nodes out horizontally
  const positions = dag.nodes.map((_, i) => ({
    x: i * (nodeWidth + hGap),
    y: 20,
  }));

  return (
    <div className="dag-wrapper">
      <div className="dag-label">Execution Graph</div>
      <div className="dag-scroll">
        <svg
          viewBox={`-10 0 ${totalW + 20} ${svgH}`}
          width={Math.min(totalW + 20, 700)}
          height={svgH}
          style={{ overflow: 'visible' }}
        >
          {/* Edges */}
          {dag.edges.map((edge, i) => {
            const fromIdx = dag.nodes.findIndex((n) => n.id === edge.from);
            const toIdx = dag.nodes.findIndex((n) => n.id === edge.to);
            if (fromIdx < 0 || toIdx < 0) return null;
            const x1 = positions[fromIdx].x + nodeWidth;
            const y1 = positions[fromIdx].y + nodeHeight / 2;
            const x2 = positions[toIdx].x;
            const y2 = positions[toIdx].y + nodeHeight / 2;
            const mx = (x1 + x2) / 2;
            const fromNode = dag.nodes[fromIdx];
            const toNode = dag.nodes[toIdx];
            const fromConf = ROLE_CONFIG[fromNode.role];
            const toConf = ROLE_CONFIG[toNode.role];
            const isDone = fromNode.status === 'done';
            const edgeColor = isDone ? fromConf.color : '#27272a';

            return (
              <g key={i}>
                <motion.path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={edgeColor}
                  strokeWidth="1.5"
                  strokeDasharray={edge.type === 'feedback' ? '4 3' : undefined}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: isDone ? 1 : 0.3, opacity: isDone ? 1 : 0.3 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                {isDone && (
                  <motion.circle
                    cx={x2 - 4}
                    cy={y2}
                    r="3"
                    fill={toConf.color}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 }}
                  />
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {dag.nodes.map((node, i) => {
            const { x, y } = positions[i];
            const cfg = ROLE_CONFIG[node.role];
            const isActive = node.id === activeNodeId;
            const isDone = node.status === 'done';
            const isError = node.status === 'error';
            const isPending = node.status === 'pending';

            const borderColor = isError ? '#ef4444' :
                                isDone ? cfg.color :
                                isActive ? cfg.color : '#27272a';
            const bgColor = isActive ? `${cfg.color}18` :
                            isDone ? `${cfg.color}10` : '#0f0f11';
            const textColor = isDone || isActive ? cfg.color : '#52525b';

            return (
              <g key={node.id}>
                {/* Glow when active */}
                {isActive && (
                  <motion.rect
                    x={x - 4} y={y - 4}
                    width={nodeWidth + 8} height={nodeHeight + 8}
                    rx="14"
                    fill={cfg.glow}
                    animate={{ opacity: [0.4, 0.8, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}

                {/* Node body */}
                <motion.rect
                  x={x} y={y}
                  width={nodeWidth} height={nodeHeight}
                  rx="10"
                  fill={bgColor}
                  stroke={borderColor}
                  strokeWidth={isDone || isActive ? 1.5 : 0.5}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08, type: 'spring', stiffness: 400, damping: 28 }}
                />

                {/* Icon */}
                <text
                  x={x + nodeWidth / 2} y={y + 26}
                  textAnchor="middle"
                  fill={textColor}
                  fontSize="16"
                  fontWeight="400"
                  style={{ transition: 'fill 0.3s' }}
                >{cfg.icon}</text>

                {/* Label */}
                <text
                  x={x + nodeWidth / 2} y={y + 44}
                  textAnchor="middle"
                  fill={textColor}
                  fontSize="10"
                  fontWeight="500"
                  letterSpacing="0.04em"
                  fontFamily="'JetBrains Mono', monospace"
                >{cfg.shortLabel.toUpperCase()}</text>

                {/* Status indicator */}
                {isDone && (
                  <motion.circle
                    cx={x + nodeWidth - 10} cy={y + 10} r="5"
                    fill={cfg.color}
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500 }}
                  />
                )}
                {isError && (
                  <circle cx={x + nodeWidth - 10} cy={y + 10} r="5" fill="#ef4444" />
                )}
                {isActive && (
                  <motion.circle
                    cx={x + nodeWidth - 10} cy={y + 10} r="5"
                    fill={cfg.color}
                    animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                )}

                {/* Confidence badge */}
                {node.confidence != null && isDone && (
                  <text
                    x={x + nodeWidth / 2} y={y + nodeHeight + 14}
                    textAnchor="middle"
                    fill={cfg.color}
                    fontSize="9"
                    fontFamily="'JetBrains Mono', monospace"
                  >{Math.round(node.confidence * 100)}%</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="dag-legend">
        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
          dag.nodes.some((n) => n.role === role as AgentRole) && (
            <div key={role} className="legend-item">
              <span style={{ color: cfg.color }}>{cfg.icon}</span>
              <span>{cfg.shortLabel}</span>
            </div>
          )
        ))}
      </div>

      <style jsx>{`
        .dag-wrapper {
          background: #0d0d0f;
          border: 0.5px solid #1e1e24;
          border-radius: 12px;
          padding: 14px 16px;
        }
        .dag-label {
          font-size: 10px; text-transform: uppercase;
          letter-spacing: 0.1em; color: #3f3f46;
          margin-bottom: 12px; font-family: 'JetBrains Mono', monospace;
        }
        .dag-scroll { overflow-x: auto; padding-bottom: 8px; }
        .dag-legend {
          display: flex; gap: 14px; flex-wrap: wrap;
          margin-top: 10px; padding-top: 10px;
          border-top: 0.5px solid #1a1a1f;
        }
        .legend-item { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #52525b; }
      `}</style>
    </div>
  );
}
