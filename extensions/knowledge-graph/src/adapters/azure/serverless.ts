/**
 * Azure Adapter — Serverless Domain Module
 *
 * Discovers Azure Functions and Web Apps via their respective managers.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper Functions resources via AzureFunctionsManager.
 */
export async function discoverFunctionsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getFunctionsManager();
  if (!mgr) return;

  const m = mgr as {
    listFunctionApps: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      state?: string;
      provisioningState?: string;
      defaultHostName?: string;
      httpsOnly?: boolean;
      functions?: string[];
      appServicePlanId?: string;
      storageAccountId?: string;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const apps = await m.listFunctionApps();
    for (const app of apps) {
      if (!app.id) continue;

      const existing = findNodeByNativeId(nodes, app.id);
      if (existing) {
        if (app.defaultHostName) existing.metadata.defaultHostName = app.defaultHostName;
        if (app.functions) existing.metadata.functionCount = app.functions.length;
        existing.metadata.httpsOnly = app.httpsOnly;
        existing.metadata.resourceSubtype = "function-app";
        existing.metadata.discoverySource = "functions-manager";

        // Link Function App → App Service Plan
        if (app.appServicePlanId) {
          const planNode = findNodeByNativeId(nodes, app.appServicePlanId);
          if (planNode) pushEdgeIfNew(edges, makeAzureEdge(existing.id, planNode.id, "runs-in", { field: "appServicePlan" }));
        }
        // Link Function App → Storage Account
        if (app.storageAccountId) {
          const storageNode = findNodeByNativeId(nodes, app.storageAccountId);
          if (storageNode) pushEdgeIfNew(edges, makeAzureEdge(existing.id, storageNode.id, "uses", { field: "storageAccount" }));
        }
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "serverless-function", app.id);
      const tags = app.tags ?? {};

      nodes.push({
        id: nodeId,
        name: app.name,
        resourceType: "serverless-function",
        provider: "azure",
        region: app.location,
        account: ctx.subscriptionId,
        nativeId: app.id,
        status: mapAzureStatus(app.provisioningState, app.state),
        tags,
        metadata: {
          resourceGroup: app.resourceGroup,
          resourceSubtype: "function-app",
          defaultHostName: app.defaultHostName,
          httpsOnly: app.httpsOnly,
          functionCount: app.functions?.length ?? 0,
          discoverySource: "functions-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Link Function App → App Service Plan
      if (app.appServicePlanId) {
        const planNode = findNodeByNativeId(nodes, app.appServicePlanId);
        if (planNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, planNode.id, "runs-in", { field: "appServicePlan" }));
      }
      // Link Function App → Storage Account
      if (app.storageAccountId) {
        const storageNode = findNodeByNativeId(nodes, app.storageAccountId);
        if (storageNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, storageNode.id, "uses", { field: "storageAccount" }));
      }
    }
  } catch {
    // Functions discovery failed
  }
}

/**
 * Discover deeper Web App resources via AzureWebAppManager.
 */
export async function discoverWebAppsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getWebAppManager();
  if (!mgr) return;

  const m = mgr as {
    listWebApps: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      state?: string;
      kind?: string;
      defaultHostName?: string;
      httpsOnly?: boolean;
      enabled?: boolean;
      appServicePlanId?: string;
      outboundIpAddresses?: string;
      linuxFxVersion?: string;
      tags?: Record<string, string>;
    }>>;
    listAppServicePlans: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      tier?: string;
      numberOfSites?: number;
      tags?: Record<string, string>;
    }>>;
  };

  // --- Web Apps ---
  try {
    const webApps = await m.listWebApps();
    for (const app of webApps) {
      if (!app.id) continue;

      const existing = findNodeByNativeId(nodes, app.id);
      if (existing) {
        if (app.defaultHostName) existing.metadata.defaultHostName = app.defaultHostName;
        if (app.kind) existing.metadata.appKind = app.kind;
        if (app.linuxFxVersion) existing.metadata.linuxFxVersion = app.linuxFxVersion;
        existing.metadata.httpsOnly = app.httpsOnly;
        existing.metadata.resourceSubtype = "web-app";
        existing.metadata.discoverySource = "webapp-manager";

        // Link to App Service Plan
        if (app.appServicePlanId) {
          const planNode = findNodeByNativeId(nodes, app.appServicePlanId);
          if (planNode) {
            pushEdgeIfNew(edges, makeAzureEdge(existing.id, planNode.id, "runs-in", { field: "appServicePlan" }));
          }
        }
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "serverless-function", app.id);
      const tags = app.tags ?? {};

      nodes.push({
        id: nodeId,
        name: app.name,
        resourceType: "serverless-function",
        provider: "azure",
        region: app.location,
        account: ctx.subscriptionId,
        nativeId: app.id,
        status: app.state === "Running" ? "running" : app.state === "Stopped" ? "stopped" : "unknown",
        tags,
        metadata: {
          resourceGroup: app.resourceGroup,
          resourceSubtype: "web-app",
          appKind: app.kind,
          defaultHostName: app.defaultHostName,
          httpsOnly: app.httpsOnly,
          enabled: app.enabled,
          linuxFxVersion: app.linuxFxVersion,
          discoverySource: "webapp-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Link web app → App Service Plan
      if (app.appServicePlanId) {
        const planNode = findNodeByNativeId(nodes, app.appServicePlanId);
        if (planNode) {
          pushEdgeIfNew(edges, makeAzureEdge(nodeId, planNode.id, "runs-in", { field: "appServicePlan" }));
        }
      }
    }
  } catch {
    // WebApp discovery failed
  }

  // --- App Service Plans ---
  try {
    const plans = await m.listAppServicePlans();
    for (const plan of plans) {
      if (!plan.id) continue;

      const existing = findNodeByNativeId(nodes, plan.id);
      if (existing) {
        if (plan.sku) existing.metadata.planSku = plan.sku;
        if (plan.tier) existing.metadata.planTier = plan.tier;
        existing.metadata.numberOfSites = plan.numberOfSites;
        existing.metadata.discoverySource = "webapp-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "compute", plan.id);
      const tags = plan.tags ?? {};

      nodes.push({
        id: nodeId,
        name: plan.name,
        resourceType: "compute",
        provider: "azure",
        region: plan.location,
        account: ctx.subscriptionId,
        nativeId: plan.id,
        status: "running",
        tags,
        metadata: {
          resourceGroup: plan.resourceGroup,
          resourceSubtype: "app-service-plan",
          planSku: plan.sku,
          planTier: plan.tier,
          numberOfSites: plan.numberOfSites,
          discoverySource: "webapp-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // App Service Plan discovery failed
  }
}

// =============================================================================
// Spring Apps Discovery
// =============================================================================

/**
 * Discover Azure Spring Apps service instances and apps.
 */
export async function discoverSpringAppsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSpringAppsManager();
  if (!mgr) return;

  const m = mgr as {
    listServices?: () => Promise<unknown[]>;
    listApps?: (rgName: string, serviceName: string) => Promise<unknown[]>;
  };

  const services = await m.listServices?.() ?? [];
  for (const raw of services) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "spring-apps";
    const location = (s["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "container", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "container",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.appplatform/spring",
        sku: (s["sku"] as Record<string, unknown>)?.["name"] ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover apps within this Spring service
    const rgMatch = id.match(/resourceGroups\/([^/]+)/i);
    const rgName = rgMatch?.[1] ?? "";
    if (rgName && name) {
      const apps = await m.listApps?.(rgName, name) ?? [];
      for (const rawApp of apps) {
        const app = rawApp as Record<string, unknown>;
        const appId = (app["id"] as string) ?? "";
        const appName = (app["name"] as string) ?? "spring-app";
        const props = (app["properties"] as Record<string, unknown>) ?? {};

        const appNodeId = buildAzureNodeId(ctx.subscriptionId, "serverless-function", appId);
        nodes.push({
          id: appNodeId,
          provider: "azure",
          resourceType: "serverless-function",
          nativeId: appId,
          name: appName,
          region: location,
          account: ctx.subscriptionId,
          status: (props["provisioningState"] as string) === "Succeeded" ? "running" : "unknown",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.appplatform/spring/apps",
            url: (props["url"] as string) ?? null,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(appNodeId, nodeId, "runs-in"));
      }
    }
  }
}

// =============================================================================
// Static Web Apps Discovery
// =============================================================================

/**
 * Discover Azure Static Web App instances.
 */
export async function discoverStaticWebAppsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getStaticWebAppsManager();
  if (!mgr) return;

  const m = mgr as {
    listStaticSites?: () => Promise<unknown[]>;
  };

  const sites = await m.listStaticSites?.() ?? [];
  for (const raw of sites) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "static-web-app";
    const location = (s["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "serverless-function", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "serverless-function",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.web/staticsites",
        defaultHostname: (s["defaultHostname"] as string) ?? null,
        sku: (s["sku"] as Record<string, unknown>)?.["name"] ?? null,
        repositoryUrl: (s["repositoryUrl"] as string) ?? null,
        branch: (s["branch"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}
