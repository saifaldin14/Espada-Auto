/**
 * Codify — generate Terraform from graph resources.
 */

import type { CodifyNode, HCLGenerationResult } from "./hcl-generator.js";
import { codifyNodes, generateImportCommand, generateResourceBlock } from "./hcl-generator.js";

export interface CodifyFilter {
  provider?: string;
  resourceType?: string;
  region?: string;
  tag?: string;
}

/**
 * Filter graph nodes for codification.
 */
export function filterNodes(nodes: CodifyNode[], filter: CodifyFilter): CodifyNode[] {
  let result = nodes;
  if (filter.provider) {
    result = result.filter((n) => n.provider === filter.provider);
  }
  if (filter.resourceType) {
    result = result.filter((n) => n.resourceType === filter.resourceType);
  }
  if (filter.region) {
    result = result.filter((n) => n.region === filter.region);
  }
  if (filter.tag) {
    result = result.filter((n) => Object.keys(n.tags).includes(filter.tag!));
  }
  return result;
}

/**
 * Codify from graph nodes with optional filter.
 */
export function codifyFromNodes(
  nodes: CodifyNode[],
  filter?: CodifyFilter,
): HCLGenerationResult {
  const filtered = filter ? filterNodes(nodes, filter) : nodes;
  return codifyNodes(filtered);
}

/**
 * Codify a subgraph — a node and its N-hop dependencies.
 */
export function codifySubgraph(
  nodes: CodifyNode[],
  edges: Array<{ sourceId: string; targetId: string }>,
  rootNodeId: string,
  depth: number,
): HCLGenerationResult {
  const included = new Set<string>();
  const queue: Array<{ id: string; level: number }> = [{ id: rootNodeId, level: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (included.has(current.id)) continue;
    included.add(current.id);

    if (current.level < depth) {
      // Find dependencies (edges where this node depends on target)
      const deps = edges.filter(
        (e) => e.sourceId === current.id || e.targetId === current.id,
      );
      for (const dep of deps) {
        const neighborId = dep.sourceId === current.id ? dep.targetId : dep.sourceId;
        if (!included.has(neighborId)) {
          queue.push({ id: neighborId, level: current.level + 1 });
        }
      }
    }
  }

  const subgraphNodes = nodes.filter((n) => included.has(n.id));
  return codifyNodes(subgraphNodes);
}

/**
 * Plan the import order based on dependency edges.
 * Dependencies are imported before the resources that depend on them.
 */
export function planImportOrder(
  nodes: CodifyNode[],
  edges: Array<{ sourceId: string; targetId: string; relationshipType?: string }>,
): CodifyNode[] {
  // Build adjacency list (depends-on edges)
  const dependsOn = new Map<string, Set<string>>();
  for (const node of nodes) {
    dependsOn.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (edge.relationshipType === "depends-on") {
      dependsOn.get(edge.sourceId)?.add(edge.targetId);
    }
  }

  // Topological sort (Kahn's algorithm)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
  }
  for (const [_source, deps] of dependsOn) {
    for (const dep of deps) {
      if (inDegree.has(dep)) {
        // The dependency should come first; increment in-degree of source
      }
    }
  }
  // Reverse: resources with no dependencies first
  for (const [source, deps] of dependsOn) {
    for (const _dep of deps) {
      inDegree.set(source, (inDegree.get(source) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: CodifyNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    // Find nodes that depend on this one
    for (const [source, deps] of dependsOn) {
      if (deps.has(id)) {
        const newDeg = (inDegree.get(source) ?? 1) - 1;
        inDegree.set(source, newDeg);
        if (newDeg === 0) queue.push(source);
      }
    }
  }

  // Any remaining (cycles) — append in original order
  for (const node of nodes) {
    if (!sorted.includes(node)) sorted.push(node);
  }

  return sorted;
}

/**
 * Generate import commands in dependency order.
 */
export function generateOrderedImports(
  nodes: CodifyNode[],
  edges: Array<{ sourceId: string; targetId: string; relationshipType?: string }>,
): string[] {
  const ordered = planImportOrder(nodes, edges);
  const commands: string[] = [];

  for (const node of ordered) {
    const resource = generateResourceBlock(node);
    if (resource) {
      commands.push(generateImportCommand(resource, node.nativeId));
    }
  }

  return commands;
}
