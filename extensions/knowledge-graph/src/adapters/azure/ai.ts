/**
 * Azure Adapter — AI Domain Module
 *
 * Discovers Cognitive Services accounts (Azure OpenAI, etc.) and
 * ML workspace resources via AzureAIManager.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper AI resources via AzureAIManager.
 */
export async function discoverAIDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getAIManager();
  if (!mgr) return;

  const m = mgr as {
    listAccounts: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      kind?: string;
      sku?: string;
      endpoint?: string;
      provisioningState?: string;
      capabilities?: string[];
      customSubDomainName?: string;
      tags?: Record<string, string>;
    }>>;
    listDeployments: (rg: string, accountName: string) => Promise<Array<{
      id?: string;
      name: string;
      model?: { format?: string; name?: string; version?: string };
      sku?: { name?: string; capacity?: number };
      provisioningState?: string;
    }>>;
  };

  try {
    const accounts = await m.listAccounts();
    for (const acct of accounts) {
      if (!acct.id) continue;

      const existing = findNodeByNativeId(nodes, acct.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "custom", acct.id);

      if (existing) {
        if (acct.kind) existing.metadata.cognitiveKind = acct.kind;
        if (acct.endpoint) existing.metadata.endpoint = acct.endpoint;
        if (acct.customSubDomainName) existing.metadata.customSubDomain = acct.customSubDomainName;
        existing.metadata.isAiWorkload = true;
        if (acct.kind === "OpenAI") existing.metadata.isAzureOpenAI = true;
        existing.metadata.discoverySource = "ai-manager";
      } else {
        const tags = acct.tags ?? {};
        nodes.push({
          id: nodeId,
          name: acct.name,
          resourceType: "custom",
          provider: "azure",
          region: acct.location,
          account: ctx.subscriptionId,
          nativeId: acct.id,
          status: mapAzureStatus(acct.provisioningState),
          tags,
          metadata: {
            resourceGroup: acct.resourceGroup,
            resourceSubtype: "cognitive-services",
            cognitiveKind: acct.kind,
            aiSku: acct.sku,
            endpoint: acct.endpoint,
            customSubDomain: acct.customSubDomainName,
            capabilities: acct.capabilities,
            isAiWorkload: true,
            isAzureOpenAI: acct.kind === "OpenAI",
            discoverySource: "ai-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Discover model deployments
      try {
        const deployments = await m.listDeployments(acct.resourceGroup, acct.name);
        for (const deploy of deployments) {
          const deployId = deploy.id ?? `${acct.id}/deployments/${deploy.name}`;
          if (findNodeByNativeId(nodes, deployId)) continue;

          const deployNodeId = buildAzureNodeId(ctx.subscriptionId, "custom", deployId);
          nodes.push({
            id: deployNodeId,
            name: deploy.name,
            resourceType: "custom",
            provider: "azure",
            region: acct.location,
            account: ctx.subscriptionId,
            nativeId: deployId,
            status: mapAzureStatus(deploy.provisioningState),
            tags: {},
            metadata: {
              resourceGroup: acct.resourceGroup,
              resourceSubtype: "ai-deployment",
              modelName: deploy.model?.name,
              modelVersion: deploy.model?.version,
              modelFormat: deploy.model?.format,
              deploySku: deploy.sku?.name,
              deployCapacity: deploy.sku?.capacity,
              isAiWorkload: true,
              discoverySource: "ai-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(deployNodeId, nodeId, "deployed-at", {
            field: "aiDeployment",
            model: deploy.model?.name,
          }));
        }
      } catch {
        // Deployment enumeration failed
      }
    }
  } catch {
    // AI discovery failed
  }
}
