/**
 * Azure Adapter — DevOps & Automation Domain Module
 *
 * Discovers Azure DevOps projects, pipelines, repositories,
 * and Automation Accounts/Runbooks, mapping them into the knowledge graph.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge } from "./utils.js";

// =============================================================================
// Azure DevOps Discovery
// =============================================================================

/**
 * Discover Azure DevOps projects, pipelines, and repositories.
 * Note: DevOps manager takes `organization` instead of `subscriptionId`.
 */
export async function discoverDevOpsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getDevOpsManager();
  if (!mgr) return;

  const m = mgr as {
    listProjects?: () => Promise<unknown[]>;
    listPipelines?: (project: string) => Promise<unknown[]>;
    listRepositories?: (project: string) => Promise<unknown[]>;
  };

  const projects = await m.listProjects?.() ?? [];
  for (const raw of projects) {
    const p = raw as Record<string, unknown>;
    const id = (p["id"] as string) ?? "";
    const name = (p["name"] as string) ?? "devops-project";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "custom",
      nativeId: id,
      name,
      region: "global",
      account: ctx.subscriptionId,
      status: "running",
      tags: {},
      metadata: {
        azureResourceType: "microsoft.devops/project",
        state: (p["state"] as string) ?? null,
        visibility: (p["visibility"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover pipelines in this project
    const pipelines = await m.listPipelines?.(name) ?? [];
    for (const rawPl of pipelines) {
      const pl = rawPl as Record<string, unknown>;
      const plId = (pl["id"] as string) ?? String(pl["id"] ?? "");
      const plName = (pl["name"] as string) ?? "pipeline";

      const plNodeId = buildAzureNodeId(
        ctx.subscriptionId,
        "custom",
        `${id}/${plId}`,
      );
      nodes.push({
        id: plNodeId,
        provider: "azure",
        resourceType: "custom",
        nativeId: `${id}/${plId}`,
        name: plName,
        region: "global",
        account: ctx.subscriptionId,
        status: "running",
        tags: {},
        metadata: { azureResourceType: "microsoft.devops/pipeline" },
        costMonthly: null,
        owner: null,
        createdAt: null,
      });
      edges.push(makeAzureEdge(plNodeId, nodeId, "contains"));
    }

    // Discover repositories in this project
    const repos = await m.listRepositories?.(name) ?? [];
    for (const rawRepo of repos) {
      const r = rawRepo as Record<string, unknown>;
      const rId = (r["id"] as string) ?? "";
      const rName = (r["name"] as string) ?? "repo";

      const rNodeId = buildAzureNodeId(
        ctx.subscriptionId,
        "custom",
        `${id}/${rId}`,
      );
      nodes.push({
        id: rNodeId,
        provider: "azure",
        resourceType: "custom",
        nativeId: `${id}/${rId}`,
        name: rName,
        region: "global",
        account: ctx.subscriptionId,
        status: "running",
        tags: {},
        metadata: { azureResourceType: "microsoft.devops/repository" },
        costMonthly: null,
        owner: null,
        createdAt: null,
      });
      edges.push(makeAzureEdge(rNodeId, nodeId, "contains"));
    }
  }
}

// =============================================================================
// Automation Discovery
// =============================================================================

/**
 * Discover Azure Automation Accounts, Runbooks, and Schedules.
 */
export async function discoverAutomationDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getAutomationManager();
  if (!mgr) return;

  const m = mgr as {
    listAccounts?: () => Promise<unknown[]>;
    listRunbooks?: (rgName: string, accountName: string) => Promise<unknown[]>;
    listSchedules?: (rgName: string, accountName: string) => Promise<unknown[]>;
  };

  const accounts = await m.listAccounts?.() ?? [];
  for (const raw of accounts) {
    const a = raw as Record<string, unknown>;
    const id = (a["id"] as string) ?? "";
    const name = (a["name"] as string) ?? "automation-account";
    const location = (a["location"] as string) ?? "unknown";

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
      tags: (a["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.automation/automationaccounts",
        sku: (a["sku"] as Record<string, unknown>)?.["name"] ?? null,
        state: (a["state"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Extract RG and account name from id for child resources
    const rgMatch = id.match(/resourceGroups\/([^/]+)/i);
    const rgName = rgMatch?.[1] ?? "";
    const accountName = (a["name"] as string) ?? "";

    if (rgName && accountName) {
      // Discover runbooks
      const runbooks = await m.listRunbooks?.(rgName, accountName) ?? [];
      for (const rawRb of runbooks) {
        const rb = rawRb as Record<string, unknown>;
        const rbId = (rb["id"] as string) ?? "";
        const rbName = (rb["name"] as string) ?? "runbook";

        const rbNodeId = buildAzureNodeId(ctx.subscriptionId, "function", rbId);
        nodes.push({
          id: rbNodeId,
          provider: "azure",
          resourceType: "function",
          nativeId: rbId,
          name: rbName,
          region: location,
          account: ctx.subscriptionId,
          status: "running",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.automation/automationaccounts/runbooks",
            runbookType: (rb["runbookType"] as string) ?? null,
            state: (rb["state"] as string) ?? null,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(rbNodeId, nodeId, "contains"));
      }

      // Discover schedules
      const schedules = await m.listSchedules?.(rgName, accountName) ?? [];
      for (const rawSch of schedules) {
        const sch = rawSch as Record<string, unknown>;
        const schId = (sch["id"] as string) ?? "";
        const schName = (sch["name"] as string) ?? "schedule";

        const schNodeId = buildAzureNodeId(ctx.subscriptionId, "custom", schId);
        nodes.push({
          id: schNodeId,
          provider: "azure",
          resourceType: "custom",
          nativeId: schId,
          name: schName,
          region: location,
          account: ctx.subscriptionId,
          status: (sch["isEnabled"] as boolean) === false ? "stopped" : "running",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.automation/automationaccounts/schedules",
            frequency: (sch["frequency"] as string) ?? null,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(schNodeId, nodeId, "triggers"));
      }
    }
  }
}
