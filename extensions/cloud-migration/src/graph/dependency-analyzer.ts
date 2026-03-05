/**
 * Graph — Dependency Analyzer
 *
 * Analyzes inter-resource dependencies discovered from the knowledge
 * graph to determine migration ordering, blast radius, and wave
 * planning.
 */

import type { NormalizedVM, NormalizedBucket, MigrationProvider } from "../types.js";

// =============================================================================
// Types
// =============================================================================

export interface ResourceNode {
  id: string;
  type: "vm" | "bucket" | "database" | "security-group" | "dns-zone" | "vpc" | "load-balancer";
  name: string;
  provider: MigrationProvider;
  region: string;
  metadata: Record<string, unknown>;
}

export interface ResourceEdge {
  source: string;
  target: string;
  type: "depends-on" | "communicates-with" | "stores-data-in" | "routes-to" | "secured-by";
  weight: number; // 0-1 criticality
  metadata?: Record<string, unknown>;
}

export interface DependencyGraph {
  nodes: ResourceNode[];
  edges: ResourceEdge[];
}

export interface MigrationWave {
  id: number;
  name: string;
  resources: ResourceNode[];
  dependencies: string[]; // IDs of resources this wave depends on (in prior waves)
  estimatedDurationMs: number;
  riskLevel: "low" | "medium" | "high";
}

export interface BlastRadius {
  sourceResource: string;
  directlyAffected: string[];
  transitivelyAffected: string[];
  totalAffected: number;
  criticalPath: boolean;
}

// =============================================================================
// Graph Analysis
// =============================================================================

/**
 * Build an adjacency list from edges.
 */
function buildAdjacencyList(
  graph: DependencyGraph,
): { forward: Map<string, string[]>; reverse: Map<string, string[]> } {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const node of graph.nodes) {
    forward.set(node.id, []);
    reverse.set(node.id, []);
  }

  for (const edge of graph.edges) {
    forward.get(edge.source)?.push(edge.target);
    reverse.get(edge.target)?.push(edge.source);
  }

  return { forward, reverse };
}

/**
 * Compute the topological ordering of resources for migration.
 * Resources with no dependencies come first.
 */
export function computeMigrationOrder(graph: DependencyGraph): ResourceNode[][] {
  const { forward, reverse } = buildAdjacencyList(graph);
  const inDegree = new Map<string, number>();

  // inDegree = number of dependencies (outgoing "depends-on" edges)
  // Nodes with zero dependencies are migrated first.
  for (const node of graph.nodes) {
    inDegree.set(node.id, forward.get(node.id)?.length ?? 0);
  }

  const layers: ResourceNode[][] = [];
  const remaining = new Set(graph.nodes.map((n) => n.id));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  while (remaining.size > 0) {
    const layer: ResourceNode[] = [];

    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        const node = nodeMap.get(id);
        if (node) layer.push(node);
      }
    }

    if (layer.length === 0) {
      // Cycle detected — add remaining as a single layer
      for (const id of remaining) {
        const node = nodeMap.get(id);
        if (node) layer.push(node);
      }
      layers.push(layer);
      break;
    }

    layers.push(layer);

    for (const node of layer) {
      remaining.delete(node.id);
      // When a dependency is resolved, dependents lose one dependency
      for (const dependent of reverse.get(node.id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
      }
    }
  }

  return layers;
}

/**
 * Generate migration waves from the dependency graph.
 */
export function generateMigrationWaves(graph: DependencyGraph): MigrationWave[] {
  const layers = computeMigrationOrder(graph);
  const { reverse } = buildAdjacencyList(graph);
  const waves: MigrationWave[] = [];

  for (let i = 0; i < layers.length; i++) {
    const resources = layers[i];
    const deps = new Set<string>();

    for (const resource of resources) {
      for (const depId of reverse.get(resource.id) ?? []) {
        deps.add(depId);
      }
    }

    // Risk assessment
    let riskLevel: MigrationWave["riskLevel"] = "low";
    if (resources.some((r) => r.type === "database" || r.type === "load-balancer")) {
      riskLevel = "high";
    } else if (resources.some((r) => r.type === "vm") && resources.length > 5) {
      riskLevel = "medium";
    }

    waves.push({
      id: i + 1,
      name: `Wave ${i + 1}`,
      resources,
      dependencies: Array.from(deps),
      estimatedDurationMs: resources.length * 300_000, // 5 min per resource estimate
      riskLevel,
    });
  }

  return waves;
}

/**
 * Compute the blast radius for a given resource.
 */
export function computeBlastRadius(
  graph: DependencyGraph,
  resourceId: string,
): BlastRadius {
  const { reverse } = buildAdjacencyList(graph);

  // BFS along reverse edges: if resourceId fails, all dependents are affected
  const directlyAffected = reverse.get(resourceId) ?? [];
  const visited = new Set<string>([resourceId]);
  const transitivelyAffected = new Set<string>();
  const queue = [...directlyAffected];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    transitivelyAffected.add(current);

    for (const next of reverse.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  // Check if on critical path (most dependents)
  let maxDependents = 0;
  for (const [_, deps] of reverse) {
    maxDependents = Math.max(maxDependents, deps.length);
  }
  const thisDependents = (reverse.get(resourceId) ?? []).length;
  const criticalPath = thisDependents >= maxDependents && thisDependents > 0;

  return {
    sourceResource: resourceId,
    directlyAffected,
    transitivelyAffected: Array.from(transitivelyAffected),
    totalAffected: transitivelyAffected.size,
    criticalPath,
  };
}

/**
 * Convert VMs and buckets into a dependency graph.
 * Uses naming conventions and tags to infer dependencies.
 */
export function inferDependencyGraph(params: {
  vms: NormalizedVM[];
  buckets: NormalizedBucket[];
}): DependencyGraph {
  const nodes: ResourceNode[] = [];
  const edges: ResourceEdge[] = [];

  // Add VM nodes
  for (const vm of params.vms) {
    nodes.push({
      id: vm.id,
      type: "vm",
      name: vm.name,
      provider: vm.provider,
      region: vm.region,
      metadata: { cpuCores: vm.cpuCores, memoryGB: vm.memoryGB },
    });
  }

  // Add bucket nodes
  for (const bucket of params.buckets) {
    nodes.push({
      id: bucket.id,
      type: "bucket",
      name: bucket.name,
      provider: bucket.provider,
      region: bucket.region,
      metadata: { sizeGB: Math.round(bucket.totalSizeBytes / (1024 * 1024 * 1024)) },
    });
  }

  // Infer VM → Bucket dependencies (by tag matching)
  for (const vm of params.vms) {
    const appTag = vm.tags?.app ?? vm.tags?.application;
    if (!appTag) continue;

    for (const bucket of params.buckets) {
      if (bucket.tags?.app === appTag || bucket.name.includes(appTag)) {
        edges.push({
          source: vm.id,
          target: bucket.id,
          type: "stores-data-in",
          weight: 0.8,
        });
      }
    }
  }

  // Infer VM → VM dependencies (by security group or subnet co-location)
  for (let i = 0; i < params.vms.length; i++) {
    for (let j = i + 1; j < params.vms.length; j++) {
      const a = params.vms[i];
      const b = params.vms[j];

      // Same subnet implies communication
      const aSubnets = new Set(a.networkInterfaces.map((n) => n.subnetId));
      const bSubnets = new Set(b.networkInterfaces.map((n) => n.subnetId));
      for (const subnet of aSubnets) {
        if (bSubnets.has(subnet)) {
          edges.push({
            source: a.id,
            target: b.id,
            type: "communicates-with",
            weight: 0.5,
          });
          break;
        }
      }
    }
  }

  return { nodes, edges };
}
