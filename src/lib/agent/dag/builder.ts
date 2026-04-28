// ─── src/lib/agent/dag/builder.ts ─────────────────────────────────────────────
// Builds an execution DAG from a research plan. Nodes = agent roles.
// Topological sort ensures dependencies are respected. Parallel groups
// are identified for concurrent execution.

import { v4 as uuidv4 } from 'uuid';
import type { ExecutionDAG, DAGNode, DAGEdge, AgentRole } from '@/lib/agent/types-v4';
import type { ResearchDepth, DomainMode } from '@/lib/agent/types-v4';

interface DAGBuildInput {
  query: string;
  depth: ResearchDepth;
  domain: DomainMode;
  hasDocuments: boolean;
  hasMemory: boolean;
}

// Role metadata
const ROLE_META: Record<AgentRole, { estimatedMs: number; label: string }> = {
  planner:     { estimatedMs: 5_000,  label: 'Research Planner'   },
  researcher:  { estimatedMs: 15_000, label: 'Deep Researcher'    },
  critic:      { estimatedMs: 10_000, label: 'Adversarial Critic' },
  verifier:    { estimatedMs: 8_000,  label: 'Fact Verifier'      },
  synthesizer: { estimatedMs: 12_000, label: 'Report Synthesizer' },
};

// Depth → which roles to include
const DEPTH_ROLES: Record<ResearchDepth, AgentRole[]> = {
  quick:      ['planner', 'researcher', 'synthesizer'],
  standard:   ['planner', 'researcher', 'critic', 'synthesizer'],
  deep:       ['planner', 'researcher', 'critic', 'verifier', 'synthesizer'],
  exhaustive: ['planner', 'researcher', 'critic', 'verifier', 'critic', 'synthesizer'],
};

export function buildDAG(input: DAGBuildInput): ExecutionDAG {
  const roles = DEPTH_ROLES[input.depth] ?? DEPTH_ROLES.standard;
  const nodes: DAGNode[] = [];
  const edges: DAGEdge[] = [];

  // Build nodes
  const roleIds: string[] = [];
  roles.forEach((role, idx) => {
    const id = `${role}-${idx}`;
    roleIds.push(id);
    nodes.push({
      id,
      role,
      label: ROLE_META[role].label + (role === 'critic' && idx > 2 ? ' II' : ''),
      dependsOn: idx === 0 ? [] : [roleIds[idx - 1]],
      status: 'pending',
      retryCount: 0,
      canParallelize: false,
    });
  });

  // Researcher and critic can potentially run in parallel after planner
  // (researcher on sub-query 1, critic on sub-query 2 simultaneously)
  if (input.depth === 'deep' || input.depth === 'exhaustive') {
    // Find researcher node — it can parallelize with initial retrieval
    const resNode = nodes.find((n) => n.role === 'researcher');
    if (resNode) resNode.canParallelize = true;
  }

  // Build edges
  for (let i = 1; i < roleIds.length; i++) {
    const edgeType = nodes[i].role === 'critic' ? 'feedback' :
                     nodes[i].role === 'verifier' ? 'conditional' : 'sequential';
    edges.push({
      from: roleIds[i - 1],
      to: roleIds[i],
      type: edgeType,
      label: edgeType === 'feedback' ? 'challenges →' :
             edgeType === 'conditional' ? 'verifies →' : '→',
    });
  }

  // Critical path = all nodes (linear for now, parallel optimization possible)
  const criticalPath = roleIds;

  const estimatedDurationMs = roles.reduce(
    (sum, r) => sum + ROLE_META[r].estimatedMs, 0
  );

  return { nodes, edges, criticalPath, estimatedDurationMs };
}

// ── Topological sort ──────────────────────────────────────────────────────────
export function topoSort(dag: ExecutionDAG): string[][] {
  // Returns batches of node IDs that can run in parallel
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of dag.nodes) {
    inDegree.set(node.id, node.dependsOn.length);
    adj.set(node.id, []);
  }

  for (const edge of dag.edges) {
    adj.get(edge.from)!.push(edge.to);
  }

  const batches: string[][] = [];
  let ready = dag.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id);

  while (ready.length > 0) {
    batches.push([...ready]);
    const next: string[] = [];
    for (const id of ready) {
      for (const neighbor of (adj.get(id) ?? [])) {
        const deg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) next.push(neighbor);
      }
    }
    ready = next;
  }

  return batches;
}

// ── Update DAG node status ────────────────────────────────────────────────────
export function updateNode(dag: ExecutionDAG, id: string, patch: Partial<DAGNode>): ExecutionDAG {
  return {
    ...dag,
    nodes: dag.nodes.map((n) => n.id === id ? { ...n, ...patch } : n),
  };
}
