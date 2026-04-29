'use client';

import { motion } from 'framer-motion';
import type { AgentRole, ExecutionDAG } from '@/lib/agent/types-v4';

const ROLE_CONFIG: Record<AgentRole, { color: string; glow: string; icon: string; shortLabel: string }> = {
  planner: { color: '#7c9cff', glow: '#7c9cff40', icon: 'P', shortLabel: 'Plan' },
  retriever: { color: '#22d3ee', glow: '#22d3ee40', icon: 'R', shortLabel: 'Retrieve' },
  memory: { color: '#a78bfa', glow: '#a78bfa40', icon: 'M', shortLabel: 'Memory' },
  researcher: { color: '#06b6d4', glow: '#06b6d440', icon: 'F', shortLabel: 'Research' },
  critic: { color: '#f59e0b', glow: '#f59e0b40', icon: 'C', shortLabel: 'Critique' },
  verifier: { color: '#10b981', glow: '#10b98140', icon: 'V', shortLabel: 'Verify' },
  synthesizer: { color: '#ec4899', glow: '#ec489940', icon: 'S', shortLabel: 'Synth' },
};

interface Props {
  dag: ExecutionDAG;
  activeNodeId: string | null;
}

export function DAGGraph({ dag, activeNodeId }: Props) {
  const nodeWidth = 98;
  const nodeHeight = 64;
  const hGap = 30;
  const nodeCount = dag.nodes.length;
  const totalW = nodeCount * nodeWidth + (nodeCount - 1) * hGap;
  const svgH = 150;
  const positions = dag.nodes.map((_, i) => ({ x: i * (nodeWidth + hGap), y: 22 }));

  return (
    <div className="dag-wrapper">
      <div className="dag-topline">
        <div>
          <div className="dag-label">Execution Graph</div>
          <div className="dag-subtitle">Deterministic DAG with parallel evidence and memory stages</div>
        </div>
        <div className="dag-meta">{dag.nodes.length} nodes</div>
      </div>

      <div className="dag-scroll">
        <svg
          viewBox={`-10 0 ${Math.max(totalW + 20, 700)} ${svgH}`}
          width={Math.max(totalW + 20, 700)}
          height={svgH}
          style={{ overflow: 'visible' }}
        >
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
            const fromCfg = ROLE_CONFIG[fromNode.role];
            const toCfg = ROLE_CONFIG[toNode.role];
            const isComplete = ['done', 'degraded'].includes(fromNode.status);
            const edgeColor = isComplete ? fromCfg.color : '#2a2f3a';

            return (
              <g key={`${edge.from}-${edge.to}-${i}`}>
                <motion.path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={edgeColor}
                  strokeWidth="1.5"
                  strokeDasharray={edge.type === 'feedback' ? '4 3' : edge.type === 'parallel' ? '2 4' : undefined}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: isComplete ? 1 : 0.35, opacity: isComplete ? 1 : 0.35 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                {isComplete && (
                  <motion.circle
                    cx={x2 - 4}
                    cy={y2}
                    r="3"
                    fill={toCfg.color}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 }}
                  />
                )}
              </g>
            );
          })}

          {dag.nodes.map((node, i) => {
            const { x, y } = positions[i];
            const cfg = ROLE_CONFIG[node.role];
            const isActive = node.id === activeNodeId;
            const isDone = node.status === 'done';
            const isDegraded = node.status === 'degraded';
            const isError = node.status === 'error';
            const borderColor = isError ? '#ff5c7a' : isDone ? cfg.color : isDegraded ? '#f5c542' : isActive ? cfg.color : '#2a2f3a';
            const bgColor = isActive ? `${cfg.color}18` : isDone ? `${cfg.color}10` : '#11131a';
            const textColor = isDone || isActive ? cfg.color : isDegraded ? '#f5c542' : '#9aa4b2';

            return (
              <g key={node.id}>
                {isActive && (
                  <motion.rect
                    x={x - 4}
                    y={y - 4}
                    width={nodeWidth + 8}
                    height={nodeHeight + 8}
                    rx="8"
                    fill={cfg.glow}
                    animate={{ opacity: [0.35, 0.75, 0.35] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                )}

                <motion.rect
                  x={x}
                  y={y}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="8"
                  fill={bgColor}
                  stroke={borderColor}
                  strokeWidth={isDone || isActive || isDegraded ? 1.5 : 0.5}
                  initial={{ opacity: 0, scale: 0.88 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05, type: 'spring', stiffness: 420, damping: 30 }}
                />

                <text
                  x={x + nodeWidth / 2}
                  y={y + 26}
                  textAnchor="middle"
                  fill={textColor}
                  fontSize="15"
                  fontWeight="700"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {cfg.icon}
                </text>

                <text
                  x={x + nodeWidth / 2}
                  y={y + 44}
                  textAnchor="middle"
                  fill={textColor}
                  fontSize="9"
                  fontWeight="600"
                  letterSpacing="0"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {cfg.shortLabel.toUpperCase()}
                </text>

                {(isDone || isError || isActive || isDegraded) && (
                  <motion.circle
                    cx={x + nodeWidth - 10}
                    cy={y + 10}
                    r="5"
                    fill={isError ? '#ff5c7a' : isDegraded ? '#f5c542' : cfg.color}
                    initial={{ scale: 0 }}
                    animate={isActive ? { scale: [1, 1.5, 1], opacity: [1, 0.45, 1] } : { scale: 1, opacity: 1 }}
                    transition={{ duration: isActive ? 1 : 0.2, repeat: isActive ? Infinity : 0 }}
                  />
                )}

                {node.confidence != null && (isDone || isDegraded) && (
                  <text
                    x={x + nodeWidth / 2}
                    y={y + nodeHeight + 14}
                    textAnchor="middle"
                    fill={isDegraded ? '#f5c542' : cfg.color}
                    fontSize="9"
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {Math.round(node.confidence * 100)}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

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
          background: #11131a;
          border: 1px solid #2a2f3a;
          border-radius: 8px;
          padding: 14px 16px;
        }
        .dag-topline {
          align-items: flex-start;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .dag-label {
          color: #f4f6fa;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .dag-subtitle {
          color: #6f7a8a;
          font-size: 11px;
          margin-top: 3px;
        }
        .dag-meta {
          color: #9aa4b2;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
        }
        .dag-scroll {
          overflow-x: auto;
          padding-bottom: 8px;
        }
        .dag-legend {
          border-top: 1px solid #20242d;
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          margin-top: 10px;
          padding-top: 10px;
        }
        .legend-item {
          align-items: center;
          color: #9aa4b2;
          display: flex;
          font-size: 10px;
          gap: 5px;
        }
      `}</style>
    </div>
  );
}
