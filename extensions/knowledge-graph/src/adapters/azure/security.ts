/**
 * Azure Adapter — Security Domain Module
 *
 * Discovers Key Vaults, Security Center assessments, and IAM role assignments
 * via respective Azure security managers.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper Key Vault resources.
 */
export async function discoverKeyVaultDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getKeyVaultManager();
  if (!mgr) return;

  const m = mgr as {
    listVaults: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      vaultUri?: string;
      provisioningState?: string;
      tenantId?: string;
      sku?: string;
      enableSoftDelete?: boolean;
      enablePurgeProtection?: boolean;
      softDeleteRetentionInDays?: number;
      networkAcls?: { virtualNetworkRules?: Array<{ id?: string }> };
      privateEndpointConnections?: Array<{ privateEndpointId?: string }>;
      tags?: Record<string, string>;
    }>>;
    listSecrets: (vaultUrl: string) => Promise<Array<{
      id?: string;
      name: string;
      enabled?: boolean;
      contentType?: string;
    }>>;
  };

  try {
    const vaults = await m.listVaults();
    for (const vault of vaults) {
      if (!vault.id) continue;

      const existing = findNodeByNativeId(nodes, vault.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "secret", vault.id);

      if (existing) {
        if (vault.vaultUri) existing.metadata.vaultUri = vault.vaultUri;
        existing.metadata.softDelete = vault.enableSoftDelete;
        existing.metadata.purgeProtection = vault.enablePurgeProtection;
        existing.metadata.softDeleteRetentionDays = vault.softDeleteRetentionInDays;
        existing.metadata.discoverySource = "keyvault-manager";
      } else {
        const tags = vault.tags ?? {};
        nodes.push({
          id: nodeId,
          name: vault.name,
          resourceType: "secret",
          provider: "azure",
          region: vault.location,
          account: ctx.subscriptionId,
          nativeId: vault.id,
          status: mapAzureStatus(vault.provisioningState),
          tags,
          metadata: {
            resourceGroup: vault.resourceGroup,
            vaultUri: vault.vaultUri,
            kvSku: vault.sku,
            softDelete: vault.enableSoftDelete,
            purgeProtection: vault.enablePurgeProtection,
            softDeleteRetentionDays: vault.softDeleteRetentionInDays,
            discoverySource: "keyvault-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Link Key Vault → VNet rules
      for (const rule of vault.networkAcls?.virtualNetworkRules ?? []) {
        if (rule.id) {
          const subnetNode = findNodeByNativeId(nodes, rule.id);
          if (subnetNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, subnetNode.id, "secured-by", { field: "networkAcls.virtualNetworkRules" }));
        }
      }
      // Link Key Vault → private endpoints
      for (const pe of vault.privateEndpointConnections ?? []) {
        if (pe.privateEndpointId) {
          const peNode = findNodeByNativeId(nodes, pe.privateEndpointId);
          if (peNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, peNode.id, "peers-with", { field: "privateEndpointConnections" }));
        }
      }

      // Count secrets for metadata enrichment
      if (vault.vaultUri) {
        try {
          const secrets = await m.listSecrets(vault.vaultUri);
          const targetNode = existing ?? nodes.find((n) => n.id === nodeId);
          if (targetNode) {
            targetNode.metadata.secretCount = secrets.length;
          }
        } catch {
          // Secret listing may fail due to access policies
        }
      }
    }
  } catch {
    // Key Vault discovery failed
  }
}

/**
 * Discover Security Center assessments and enrich nodes with security posture.
 */
export async function discoverSecurityPosture(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSecurityManager();
  if (!mgr) return;

  const m = mgr as {
    getSecureScores: () => Promise<Array<{
      id?: string;
      displayName?: string;
      currentScore?: number;
      maxScore?: number;
      percentage?: number;
    }>>;
    listAssessments: (scope?: string) => Promise<Array<{
      id?: string;
      resourceId?: string;
      displayName?: string;
      status?: { code?: string; description?: string };
      severity?: string;
    }>>;
  };

  // Enrich nodes with security assessment status
  try {
    const assessments = await m.listAssessments();
    for (const assessment of assessments) {
      if (!assessment.resourceId) continue;

      const node = findNodeByNativeId(nodes, assessment.resourceId);
      if (!node) continue;

      // Track security findings on the node
      if (!node.metadata.securityFindings) {
        node.metadata.securityFindings = [];
      }
      (node.metadata.securityFindings as unknown[]).push({
        name: assessment.displayName,
        status: assessment.status?.code,
        severity: assessment.severity,
      });
    }
  } catch {
    // Security assessments failed
  }

  // Get overall secure score and attach to subscription-level metadata
  try {
    const scores = await m.getSecureScores();
    if (scores.length > 0) {
      const primaryScore = scores[0];
      // Attach secure score to all Azure nodes as provider-level metadata
      for (const node of nodes) {
        if (node.provider === "azure" && !node.metadata.secureScore) {
          node.metadata.secureScore = primaryScore?.percentage;
        }
      }
    }
  } catch {
    // Secure score retrieval failed
  }
}

/**
 * Discover IAM role assignments and link identities to resources.
 */
export async function discoverIAMDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getIAMManager();
  if (!mgr) return;

  const m = mgr as {
    listRoleAssignments: (scope?: string) => Promise<Array<{
      id?: string;
      principalId?: string;
      principalType?: string;
      roleDefinitionId?: string;
      scope?: string;
    }>>;
  };

  try {
    const assignments = await m.listRoleAssignments();
    for (const assignment of assignments) {
      if (!assignment.scope || !assignment.principalId) continue;

      // Find the resource node this assignment targets
      const targetNode = findNodeByNativeId(nodes, assignment.scope);
      if (!targetNode) continue;

      // Find identity node for the principal
      const identityNode = nodes.find((n) =>
        n.resourceType === "identity" &&
        n.provider === "azure" &&
        n.metadata.principalId === assignment.principalId,
      );

      if (identityNode) {
        pushEdgeIfNew(edges, makeAzureEdge(identityNode.id, targetNode.id, "authenticated-by", {
          field: "roleAssignment",
          principalType: assignment.principalType,
          roleDefinitionId: assignment.roleDefinitionId,
        }));
      }
    }
  } catch {
    // IAM discovery failed
  }
}
