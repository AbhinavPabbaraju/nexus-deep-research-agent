import type {
  AgentRole,
  DAGEdge,
  DAGNode,
  DomainMode,
  ExecutionDAG,
  ResearchDepth,
  ToolPlan,
} from '@/lib/agent/types-v4';

interface DAGBuildInput {
  query: string;
  depth: ResearchDepth;
  domain: DomainMode;
  hasDocuments: boolean;
  hasMemory: boolean;
}

const ROLE_META: Record<AgentRole, { estimatedMs: number; label: string; schemaName: string; timeoutMs: number }> = {
  planner: { estimatedMs: 3_000, label: 'Deterministic Planner', schemaName: 'PlannerOutput', timeoutMs: 8_000 },
  retriever: { estimatedMs: 5_000, label: 'Evidence Retriever', schemaName: 'EvidencePack', timeoutMs: 12_000 },
  memory: { estimatedMs: 2_000, label: 'Memory Lookup', schemaName: 'MemoryPack', timeoutMs: 5_000 },
  researcher: { estimatedMs: 15_000, label: 'Deep Researcher', schemaName: 'ResearchOutput', timeoutMs: 45_000 },
  critic: { estimatedMs: 10_000, label: 'Adversarial Critic', schemaName: 'CritiqueOutput', timeoutMs: 30_000 },
  verifier: { estimatedMs: 8_000, label: 'Claim Verifier', schemaName: 'VerificationResult', timeoutMs: 30_000 },
  synthesizer: { estimatedMs: 12_000, label: 'Report Synthesizer', schemaName: 'SynthesisOutput', timeoutMs: 45_000 },
};

const DEPTH_ROLES: Record<ResearchDepth, AgentRole[]> = {
  quick: ['planner', 'retriever', 'researcher', 'synthesizer'],
  standard: ['planner', 'retriever', 'memory', 'researcher', 'critic', 'synthesizer'],
  deep: ['planner', 'retriever', 'memory', 'researcher', 'critic', 'verifier', 'synthesizer'],
  exhaustive: ['planner', 'retriever', 'memory', 'researcher', 'critic', 'verifier', 'critic', 'synthesizer'],
};

function toolsForRole(role: AgentRole, input: DAGBuildInput): ToolPlan[] {
  const keyBase = `${input.domain}:${input.depth}:${input.query}`;

  if (role === 'retriever') {
    return [
      {
        name: input.hasDocuments ? 'retrieve' : 'web_search',
        purpose: input.hasDocuments ? 'Retrieve document evidence' : 'Collect external evidence',
        input: { query: input.query, documentScoped: input.hasDocuments },
        idempotencyKey: `${keyBase}:retriever`,
        timeoutMs: 12_000,
      },
      {
        name: 'rerank',
        purpose: 'Rerank evidence candidates before agent consumption',
        input: { query: input.query, topK: 8 },
        idempotencyKey: `${keyBase}:rerank`,
        timeoutMs: 8_000,
      },
    ];
  }

  if (role === 'memory') {
    return [{
      name: 'memory_lookup',
      purpose: 'Load durable user or project memory relevant to the query',
      input: { query: input.query, enabled: input.hasMemory },
      idempotencyKey: `${keyBase}:memory`,
      timeoutMs: 5_000,
    }];
  }

  if (role === 'verifier') {
    return [{
      name: 'compute',
      purpose: 'Check numeric consistency and confidence calibration',
      input: { query: input.query },
      idempotencyKey: `${keyBase}:verify-compute`,
      timeoutMs: 6_000,
    }];
  }

  return [];
}

function makeNode(role: AgentRole, idx: number, dependsOn: string[], input: DAGBuildInput): DAGNode {
  const meta = ROLE_META[role];
  return {
    id: `${role}-${idx}`,
    role,
    label: meta.label + (role === 'critic' && idx > 5 ? ' II' : ''),
    dependsOn,
    status: dependsOn.length === 0 ? 'ready' : 'pending',
    retryCount: 0,
    canParallelize: role === 'retriever' || role === 'memory',
    requiredTools: toolsForRole(role, input),
    schemaName: meta.schemaName,
    timeoutMs: meta.timeoutMs,
  };
}

export function buildDAG(input: DAGBuildInput): ExecutionDAG {
  const roles = DEPTH_ROLES[input.depth] ?? DEPTH_ROLES.standard;
  const nodes: DAGNode[] = [];
  const edges: DAGEdge[] = [];
  const roleIds: string[] = [];

  roles.forEach((role, idx) => {
    let dependsOn: string[] = [];

    if (role !== 'planner') {
      const plannerId = roleIds.find((id) => id.startsWith('planner-'));
      const retrieverId = roleIds.find((id) => id.startsWith('retriever-'));
      const memoryId = roleIds.find((id) => id.startsWith('memory-'));
      const lastResearcherId = [...roleIds].reverse().find((id) => id.startsWith('researcher-'));
      const lastCriticId = [...roleIds].reverse().find((id) => id.startsWith('critic-'));
      const verifierId = [...roleIds].reverse().find((id) => id.startsWith('verifier-'));

      if (role === 'retriever' || role === 'memory') dependsOn = plannerId ? [plannerId] : [];
      if (role === 'researcher') dependsOn = [retrieverId, memoryId].filter(Boolean) as string[];
      if (role === 'critic') dependsOn = [lastResearcherId, verifierId].filter(Boolean) as string[];
      if (role === 'verifier') dependsOn = [lastResearcherId, lastCriticId].filter(Boolean) as string[];
      if (role === 'synthesizer') {
        dependsOn = [lastResearcherId, lastCriticId, verifierId].filter(Boolean) as string[];
      }
    }

    const node = makeNode(role, idx, dependsOn, input);
    roleIds.push(node.id);
    nodes.push(node);
  });

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const dependency = nodes.find((n) => n.id === dep);
      const edgeType: DAGEdge['type'] =
        node.role === 'critic' ? 'feedback' :
        node.role === 'verifier' ? 'conditional' :
        dependency?.canParallelize ? 'parallel' : 'sequential';

      edges.push({
        from: dep,
        to: node.id,
        type: edgeType,
        label: edgeType === 'feedback' ? 'challenges' : edgeType === 'conditional' ? 'verifies' : undefined,
      });
    }
  }

  const criticalPath = nodes
    .filter((node) => !node.canParallelize || node.role === 'researcher' || node.role === 'synthesizer')
    .map((node) => node.id);

  const estimatedDurationMs = roles.reduce((sum, role) => sum + ROLE_META[role].estimatedMs, 0);
  return { nodes, edges, criticalPath, estimatedDurationMs };
}

export function topoSort(dag: ExecutionDAG): string[][] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of dag.nodes) {
    inDegree.set(node.id, node.dependsOn.length);
    adj.set(node.id, []);
  }

  for (const edge of dag.edges) {
    adj.get(edge.from)?.push(edge.to);
  }

  const batches: string[][] = [];
  let ready = dag.nodes.filter((node) => node.dependsOn.length === 0).map((node) => node.id);

  while (ready.length > 0) {
    batches.push([...ready]);
    const next: string[] = [];

    for (const id of ready) {
      for (const neighbor of adj.get(id) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) next.push(neighbor);
      }
    }

    ready = next;
  }

  return batches;
}

export function updateNode(dag: ExecutionDAG, id: string, patch: Partial<DAGNode>): ExecutionDAG {
  return {
    ...dag,
    nodes: dag.nodes.map((node) => node.id === id ? { ...node, ...patch } : node),
  };
}
