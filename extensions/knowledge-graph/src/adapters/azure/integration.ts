/**
 * Azure Adapter — Integration Domain Module
 *
 * Discovers API Management services/APIs, Logic App workflows,
 * and Data Factory pipelines, mapping them into the knowledge graph.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge } from "./utils.js";

// =============================================================================
// API Management Discovery
// =============================================================================

/**
 * Discover Azure API Management services, APIs, and subscriptions.
 */
export async function discoverAPIManagementDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getAPIManagementManager();
  if (!mgr) return;

  const m = mgr as {
    listServices?: () => Promise<unknown[]>;
    listAPIs?: (rgName: string, serviceName: string) => Promise<unknown[]>;
  };

  const services = await m.listServices?.() ?? [];
  for (const raw of services) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "apim-service";
    const location = (s["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "api-gateway", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "api-gateway",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.apimanagement/service",
        sku: (s["sku"] as Record<string, unknown>)?.["name"] ?? null,
        gatewayUrl: (s["gatewayUrl"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover APIs within this APIM service
    const rgMatch = id.match(/resourceGroups\/([^/]+)/i);
    const rgName = rgMatch?.[1] ?? "";
    if (rgName && name) {
      const apis = await m.listAPIs?.(rgName, name) ?? [];
      for (const rawApi of apis) {
        const api = rawApi as Record<string, unknown>;
        const apiId = (api["id"] as string) ?? "";
        const apiName = (api["displayName"] as string) ?? (api["name"] as string) ?? "api";

        const apiNodeId = buildAzureNodeId(ctx.subscriptionId, "custom", apiId);
        nodes.push({
          id: apiNodeId,
          provider: "azure",
          resourceType: "custom",
          nativeId: apiId,
          name: apiName,
          region: location,
          account: ctx.subscriptionId,
          status: "running",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.apimanagement/service/apis",
            path: (api["path"] as string) ?? null,
            protocols: (api["protocols"] as string[]) ?? [],
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(apiNodeId, nodeId, "exposes"));
      }
    }
  }
}

// =============================================================================
// Logic Apps Discovery
// =============================================================================

/**
 * Discover Azure Logic App standard/consumption workflows.
 */
export async function discoverLogicAppsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getLogicManager();
  if (!mgr) return;

  const m = mgr as {
    listWorkflows?: () => Promise<unknown[]>;
  };

  const workflows = await m.listWorkflows?.() ?? [];
  for (const raw of workflows) {
    const w = raw as Record<string, unknown>;
    const id = (w["id"] as string) ?? "";
    const name = (w["name"] as string) ?? "logic-app";
    const location = (w["location"] as string) ?? "unknown";
    const state = (w["state"] as string) ?? "";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "serverless-function", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "serverless-function",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: state.toLowerCase() === "disabled" ? "stopped" : "running",
      tags: (w["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.logic/workflows",
        sku: ((w["sku"] as Record<string, unknown>)?.["name"] as string) ?? null,
        state,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}

// =============================================================================
// Data Factory Discovery
// =============================================================================

/**
 * Discover Azure Data Factory instances and pipelines.
 */
export async function discoverDataFactoryDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getDataFactoryManager();
  if (!mgr) return;

  const m = mgr as {
    listFactories?: () => Promise<unknown[]>;
    listPipelines?: (rgName: string, factoryName: string) => Promise<unknown[]>;
  };

  const factories = await m.listFactories?.() ?? [];
  for (const raw of factories) {
    const f = raw as Record<string, unknown>;
    const id = (f["id"] as string) ?? "";
    const name = (f["name"] as string) ?? "data-factory";
    const location = (f["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "custom",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (f["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.datafactory/factories",
        provisioningState: (f["provisioningState"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover pipelines within this factory
    const rgMatch = id.match(/resourceGroups\/([^/]+)/i);
    const rgName = rgMatch?.[1] ?? "";
    if (rgName && name) {
      const pipelines = await m.listPipelines?.(rgName, name) ?? [];
      for (const rawPl of pipelines) {
        const pl = rawPl as Record<string, unknown>;
        const plId = (pl["id"] as string) ?? "";
        const plName = (pl["name"] as string) ?? "pipeline";

        const plNodeId = buildAzureNodeId(ctx.subscriptionId, "custom", plId);
        nodes.push({
          id: plNodeId,
          provider: "azure",
          resourceType: "custom",
          nativeId: plId,
          name: plName,
          region: location,
          account: ctx.subscriptionId,
          status: "running",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.datafactory/factories/pipelines",
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(plNodeId, nodeId, "contains"));
      }
    }
  }
}
