/**
 * Azure Adapter — Utility Functions
 *
 * Node ID generation, status mapping, and helper functions used
 * across all Azure domain modules.
 */

import type { GraphNodeInput, GraphEdgeInput, GraphRelationshipType, GraphResourceType } from "../../types.js";

// =============================================================================
// Node ID
// =============================================================================

/**
 * Build a deterministic graph node ID for an Azure resource.
 */
export function buildAzureNodeId(
  subscriptionId: string,
  resourceType: GraphResourceType,
  nativeId: string,
): string {
  return `azure:${subscriptionId}:${resourceType}:${hashResourceId(nativeId)}`;
}

function hashResourceId(id: string): string {
  const parts = id.split("/");
  return parts.slice(-2).join("/").toLowerCase().replace(/[^a-z0-9-/]/g, "");
}

// =============================================================================
// Edge Builder
// =============================================================================

/**
 * Build a graph edge with consistent ID format.
 */
export function makeAzureEdge(
  sourceNodeId: string,
  targetNodeId: string,
  relationship: GraphRelationshipType,
  metadata?: Record<string, unknown>,
): GraphEdgeInput {
  return {
    id: `${sourceNodeId}--${relationship}--${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
    relationshipType: relationship,
    confidence: 0.9,
    discoveredVia: "api-field",
    metadata: metadata ?? {},
  };
}

// =============================================================================
// Status Mapping
// =============================================================================

/**
 * Map Azure provisioning/power state to graph node status.
 */
export function mapAzureStatus(
  provisioningState?: string,
  powerState?: string,
): GraphNodeInput["status"] {
  const ps = provisioningState?.toLowerCase();
  const pw = powerState?.toLowerCase();

  if (pw) {
    if (pw.includes("running")) return "running";
    if (pw.includes("stopped") || pw.includes("deallocated")) return "stopped";
  }

  if (ps === "succeeded" || ps === "running") return "running";
  if (ps === "creating" || ps === "updating") return "creating";
  if (ps === "deleting") return "deleting";
  if (ps === "failed") return "error";

  return "running";
}

// =============================================================================
// Node Lookup
// =============================================================================

/**
 * Find a node by its native Azure resource ID (case-insensitive).
 */
export function findNodeByNativeId(
  nodes: GraphNodeInput[],
  nativeId: string,
): GraphNodeInput | undefined {
  const lower = nativeId.toLowerCase();
  return nodes.find((n) => n.nativeId.toLowerCase() === lower);
}

/**
 * Push an edge only if it doesn't duplicate an existing one.
 */
export function pushEdgeIfNew(
  edges: GraphEdgeInput[],
  edge: GraphEdgeInput,
): void {
  if (!edges.some((e) => e.id === edge.id)) {
    edges.push(edge);
  }
}
