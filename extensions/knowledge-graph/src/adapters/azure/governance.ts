/**
 * Azure Adapter — Governance Domain Module
 *
 * Discovers Azure Policy assignments/definitions and Compliance posture,
 * mapping them into the knowledge graph as policy and custom nodes.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge } from "./utils.js";

// =============================================================================
// Policy Discovery
// =============================================================================

/**
 * Discover Azure Policy assignments and definitions.
 * Creates policy nodes and links them to the resources they govern.
 */
export async function discoverPolicyDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getPolicyManager();
  if (!mgr) return;

  const m = mgr as {
    listAssignments?: (scope?: string) => Promise<unknown[]>;
    listDefinitions?: () => Promise<unknown[]>;
    getComplianceState?: (scope?: string) => Promise<unknown>;
  };

  // Discover policy assignments
  const assignments = await m.listAssignments?.() ?? [];
  for (const raw of assignments) {
    const a = raw as Record<string, unknown>;
    const id = (a["id"] as string) ?? "";
    const name = (a["displayName"] as string) ?? (a["name"] as string) ?? "policy-assignment";
    const scope = (a["scope"] as string) ?? "";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "policy", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "policy",
      nativeId: id,
      name,
      region: "global",
      account: ctx.subscriptionId,
      status: "running",
      tags: {},
      metadata: {
        policyDefinitionId: (a["policyDefinitionId"] as string) ?? null,
        scope,
        enforcementMode: (a["enforcementMode"] as string) ?? "Default",
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Link assignment to its scope (e.g. resource group or subscription)
    if (scope) {
      const scopeNode = nodes.find(
        (n) => n.nativeId?.toLowerCase() === scope.toLowerCase(),
      );
      if (scopeNode) {
        edges.push(makeAzureEdge(nodeId, scopeNode.id, "secures"));
      }
    }
  }
}

// =============================================================================
// Compliance Discovery
// =============================================================================

/**
 * Discover compliance status across frameworks (e.g. CIS, NIST).
 */
export async function discoverComplianceDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getComplianceManager();
  if (!mgr) return;

  const m = mgr as {
    listViolations?: (rg?: string) => Promise<unknown[]>;
    getComplianceStatus?: (frameworkId?: string) => Promise<unknown>;
  };

  // Discover compliance violations and tag affected nodes
  const violations = await m.listViolations?.() ?? [];
  for (const raw of violations) {
    const v = raw as Record<string, unknown>;
    const resourceId = (v["resourceId"] as string) ?? "";
    const severity = (v["severity"] as string) ?? "medium";
    const rule = (v["ruleId"] as string) ?? (v["ruleName"] as string) ?? "";

    // Find the resource node and attach compliance metadata
    const target = nodes.find(
      (n) => n.nativeId?.toLowerCase() === resourceId.toLowerCase(),
    );
    if (target && target.metadata) {
      const existing = (target.metadata["complianceViolations"] as string[]) ?? [];
      existing.push(`${rule}:${severity}`);
      target.metadata["complianceViolations"] = existing;
      target.metadata["complianceStatus"] = "non-compliant";
    }
  }
}
