import { ResourceResolutionError } from "./errors.js";
import type { ResourceGraphChain, ResourceGraphNode } from "./types.js";

export const MAX_REFERENCE_HOPS = 32;

export type ResourceGraphEdge = Readonly<{
  readonly from: string;
  readonly to: string;
}>;

export type ResourceGraph = Readonly<{
  readonly nodes: readonly ResourceGraphNode[];
  readonly edges: readonly ResourceGraphEdge[];
}>;

export type ResourceGraphState = {
  readonly nodes: Map<string, ResourceGraphNode>;
  readonly edges: Map<string, Set<string>>;
};

export function createResourceGraphState(): ResourceGraphState {
  return { nodes: new Map(), edges: new Map() };
}

/** Typed canonical identity: the same directory may provide three node kinds. */
export function canonicalGraphKey(node: ResourceGraphNode): string {
  return `${node.kind}\u0000${node.origin.kind}\u0000${node.origin.path}`;
}

export function graphNodeLabel(node: ResourceGraphNode): string {
  return `${node.kind}:${String(node.locator)}`;
}

export function addResourceGraphNode(
  graph: ResourceGraphState,
  node: ResourceGraphNode,
): string {
  const key = canonicalGraphKey(node);
  if (!graph.nodes.has(key)) graph.nodes.set(key, Object.freeze({ ...node }));
  return key;
}

export function addResourceGraphEdge(
  graph: ResourceGraphState,
  from: ResourceGraphNode,
  to: ResourceGraphNode,
): void {
  const fromKey = addResourceGraphNode(graph, from);
  const toKey = addResourceGraphNode(graph, to);
  const targets = graph.edges.get(fromKey) ?? new Set<string>();
  targets.add(toKey);
  graph.edges.set(fromKey, targets);
}

export function snapshotResourceGraph(
  graph: ResourceGraphState,
): ResourceGraph {
  const keys = [...graph.nodes.keys()].sort();
  const nodes = keys.map((key) => graph.nodes.get(key) as ResourceGraphNode);
  const edges: ResourceGraphEdge[] = [];
  for (const from of [...graph.edges.keys()].sort()) {
    for (const to of [...(graph.edges.get(from) ?? [])].sort()) {
      edges.push(Object.freeze({ from, to }));
    }
  }
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

export function assertResourceGraphStep(
  path: readonly ResourceGraphNode[],
  node: ResourceGraphNode,
  hops: number,
): void {
  const key = canonicalGraphKey(node);
  const existing = path.findIndex((entry) => canonicalGraphKey(entry) === key);
  const chain = [...path, node] as unknown as ResourceGraphChain;
  if (existing >= 0) {
    throw new ResourceResolutionError({
      code: "resource-cycle",
      message: `resource graph cycle: ${chain.map(graphNodeLabel).join(" -> ")}`,
      chain,
    });
  }
  if (hops > MAX_REFERENCE_HOPS) {
    throw new ResourceResolutionError({
      code: "resource-depth-exceeded",
      message: `resource reference depth limit of ${MAX_REFERENCE_HOPS} exceeded: ${chain
        .map(graphNodeLabel)
        .join(" -> ")}`,
      chain,
    });
  }
}
