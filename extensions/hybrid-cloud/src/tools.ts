/**
 * Hybrid/Edge Infrastructure — Agent Tools
 *
 * Four unified tools for querying hybrid topology, edge sites,
 * Kubernetes fleet, and cross-boundary blast radius.
 */

import { Type } from "@sinclair/typebox";
import type { HybridDiscoveryCoordinator } from "./discovery-coordinator.js";
import type { CrossBoundaryAnalyzer } from "./cross-boundary-analysis.js";

// ── Local type mirrors (cross-extension rootDir pattern) ────────────────────

/** Minimal subset of EspadaPluginApi used by these tools. */
type EspadaPluginApi = {
  registerTool: (tool: {
    name: string;
    label: string;
    description: string;
    parameters: ReturnType<typeof Type.Object>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
      content: { type: "text"; text: string }[];
      details: Record<string, unknown>;
    }>;
  }, opts?: { names?: string[] }) => void;
};

/** Portable string enum helper (mirrors espada/plugin-sdk stringEnum). */
function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; title?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

// =============================================================================
// Constants
// =============================================================================

const PROVIDERS = ["aws", "azure", "azure-arc", "gcp", "gdc"] as const;
const CONNECTIVITY_STATUSES = ["connected", "degraded", "disconnected", "unknown"] as const;
const TARGET_TYPES = ["region", "site", "cluster"] as const;

// =============================================================================
// Tool Registration
// =============================================================================

/**
 * Register all hybrid/edge agent tools with the Espada plugin API.
 */
export function registerHybridTools(
  api: EspadaPluginApi,
  coordinator: HybridDiscoveryCoordinator,
  analyzer: CrossBoundaryAnalyzer,
): void {
  // ---------------------------------------------------------------------------
  // 1. Hybrid Topology
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "hybrid_topology",
      label: "Hybrid Topology",
      description:
        "Show full hybrid infrastructure topology: cloud regions, edge sites, " +
        "connectivity status, and resource counts across all providers. Use this " +
        "for an overview of hybrid/edge infrastructure.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter by cloud provider (default: all)",
          }),
        ),
        includeResources: Type.Optional(
          Type.Boolean({
            description: "Include resource-level detail (default: false)",
          }),
        ),
      }),
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const { provider, includeResources } = params as {
          provider?: string;
          includeResources?: boolean;
        };

        const topology = await coordinator.discoverAll();

        // Filter by provider if specified
        const regions = provider
          ? topology.cloudRegions.filter((r) => r.provider === provider)
          : topology.cloudRegions;

        const sites = provider
          ? topology.edgeSites.filter((s) => s.provider === provider)
          : topology.edgeSites;

        const clusters = provider
          ? topology.fleetClusters.filter((c) => c.provider === provider)
          : topology.fleetClusters;

        const lines: string[] = [
          "## Hybrid Infrastructure Topology",
          "",
          `**Cloud Regions:** ${regions.length}`,
          `**Edge Sites:** ${sites.length}`,
          `**Fleet Clusters:** ${clusters.length}`,
          `**Connected Sites:** ${topology.summary.connectedSites}`,
          `**Disconnected Sites:** ${topology.summary.disconnectedSites}`,
          "",
        ];

        if (regions.length > 0) {
          lines.push(
            "### Cloud Regions",
            "| Provider | Region | Resources | Edge Sites |",
            "|----------|--------|-----------|------------|",
            ...regions.map(
              (r) => `| ${r.provider} | ${r.region} | ${r.resourceCount} | ${r.edgeSites.length} |`,
            ),
            "",
          );
        }

        if (sites.length > 0) {
          lines.push(
            "### Edge Sites",
            "| Site | Provider | Status | Parent Region | Resources |",
            "|------|----------|--------|---------------|-----------|",
            ...sites.map(
              (s) =>
                `| ${s.name} | ${s.provider} | ${s.status} | ${s.parentCloudRegion} | ${s.resourceCount} |`,
            ),
            "",
          );
        }

        if (includeResources && clusters.length > 0) {
          lines.push(
            "### Fleet Clusters",
            "| Cluster | Provider | K8s Version | Nodes | Status | Connectivity |",
            "|---------|----------|-------------|-------|--------|-------------|",
            ...clusters.map(
              (c) =>
                `| ${c.name} | ${c.provider} | ${c.kubernetesVersion} | ${c.nodeCount} | ${c.status} | ${c.connectivity} |`,
            ),
            "",
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            cloudRegions: regions.length,
            edgeSites: sites.length,
            fleetClusters: clusters.length,
            connectedSites: topology.summary.connectedSites,
            disconnectedSites: topology.summary.disconnectedSites,
          },
        };
      },
    },
    { names: ["hybrid_topology"] },
  );

  // ---------------------------------------------------------------------------
  // 2. Hybrid Sites
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "hybrid_sites",
      label: "Edge/On-Prem Sites",
      description:
        "List edge and on-premises sites with their status, connectivity, " +
        "capabilities, and resource counts. Filter by provider or connectivity status.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter by cloud provider",
          }),
        ),
        status: Type.Optional(
          stringEnum(CONNECTIVITY_STATUSES, {
            description: "Filter by connectivity status",
          }),
        ),
      }),
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const { provider, status } = params as {
          provider?: string;
          status?: string;
        };

        let sites = await coordinator.discoverEdgeSites();

        if (provider) {
          sites = sites.filter((s) => s.provider === provider);
        }
        if (status) {
          sites = sites.filter((s) => s.status === status);
        }

        const lines: string[] = [
          `## Edge/On-Premises Sites (${sites.length})`,
          "",
        ];

        if (sites.length === 0) {
          lines.push("No sites found matching the specified filters.");
        } else {
          lines.push(
            "| Site | Provider | Status | Region | Resources | Clusters | Capabilities | Last Sync |",
            "|------|----------|--------|--------|-----------|----------|-------------|-----------|",
            ...sites.map(
              (s) =>
                `| ${s.name} | ${s.provider} | ${s.status} | ${s.parentCloudRegion} | ${s.resourceCount} | ${s.managedClusters.length} | ${s.capabilities.join(", ")} | ${s.lastSyncAt} |`,
            ),
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            siteCount: sites.length,
            byStatus: {
              connected: sites.filter((s) => s.status === "connected").length,
              degraded: sites.filter((s) => s.status === "degraded").length,
              disconnected: sites.filter((s) => s.status === "disconnected").length,
              unknown: sites.filter((s) => s.status === "unknown").length,
            },
          },
        };
      },
    },
    { names: ["hybrid_sites"] },
  );

  // ---------------------------------------------------------------------------
  // 3. Hybrid Fleet
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "hybrid_fleet",
      label: "Kubernetes Fleet",
      description:
        "Show all Kubernetes clusters across all providers and locations — " +
        "cloud-hosted, on-premises, and edge. Includes version, node count, " +
        "fleet membership, and connectivity status.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter by cloud provider",
          }),
        ),
        fleetId: Type.Optional(
          Type.String({
            description: "Filter by fleet ID (GKE fleets only)",
          }),
        ),
      }),
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const { provider, fleetId } = params as {
          provider?: string;
          fleetId?: string;
        };

        let clusters = await coordinator.discoverFleet();

        if (provider) {
          clusters = clusters.filter((c) => c.provider === provider);
        }
        if (fleetId) {
          clusters = clusters.filter((c) => c.fleetId === fleetId);
        }

        // Fleet drift analysis
        const drift = analyzer.fleetDriftAnalysis(clusters);

        const lines: string[] = [
          `## Kubernetes Fleet (${clusters.length} clusters)`,
          "",
          `**Fleet Consistency Score:** ${drift.score}/100`,
          "",
        ];

        if (drift.versionSkew.length > 0) {
          lines.push(
            "### Version Skew",
            ...drift.versionSkew.map(
              (v) => `- ⚠️ **${v.cluster}** running ${v.version}`,
            ),
            "",
          );
        }

        if (clusters.length > 0) {
          lines.push(
            "### Clusters",
            "| Cluster | Provider | K8s Version | Nodes | Status | Connectivity | Managed By | Fleet |",
            "|---------|----------|-------------|-------|--------|-------------|------------|-------|",
            ...clusters.map(
              (c) =>
                `| ${c.name} | ${c.provider} | ${c.kubernetesVersion} | ${c.nodeCount} | ${c.status} | ${c.connectivity} | ${c.managedBy} | ${c.fleetId ?? "—"} |`,
            ),
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            clusterCount: clusters.length,
            consistencyScore: drift.score,
            versionSkew: drift.versionSkew,
            byProvider: Object.fromEntries(
              [...new Set(clusters.map((c) => c.provider))].map((p) => [
                p,
                clusters.filter((c) => c.provider === p).length,
              ]),
            ),
          },
        };
      },
    },
    { names: ["hybrid_fleet"] },
  );

  // ---------------------------------------------------------------------------
  // 4. Hybrid Blast Radius
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "hybrid_blast_radius",
      label: "Hybrid Blast Radius",
      description:
        "Analyze blast radius across cloud and edge boundaries. " +
        "Shows what happens if a cloud region goes down, an edge site goes offline, " +
        "or a cluster fails — including which sites can operate disconnected.",
      parameters: Type.Object({
        target: Type.String({
          description: "Target ID — cloud region name, site ID, or cluster ID",
        }),
        targetType: stringEnum(TARGET_TYPES, {
          description: "Type of target: region, site, or cluster",
        }),
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Cloud provider (required for region targets)",
          }),
        ),
      }),
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const { target, targetType, provider } = params as {
          target: string;
          targetType: "region" | "site" | "cluster";
          provider?: string;
        };

        const lines: string[] = [];

        if (targetType === "region") {
          const cloudProvider = (provider ?? "aws") as Parameters<
            typeof analyzer.cloudRegionImpact
          >[1];
          const topology = await coordinator.discoverAll();

          const impact = await analyzer.cloudRegionImpact(
            target,
            cloudProvider,
            topology.edgeSites,
            topology.fleetClusters,
          );

          lines.push(
            `## Cloud Region Impact: ${target} (${impact.provider})`,
            "",
            `**Affected Edge Sites:** ${impact.affectedSites.length}`,
            `**Affected Clusters:** ${impact.affectedClusters.length}`,
            `**Affected Resources:** ${impact.affectedResources}`,
            `**Can Operate Disconnected:** ${impact.canOperateDisconnected.length}`,
            `**Will Fail:** ${impact.willFail.length}`,
            "",
          );

          if (impact.canOperateDisconnected.length > 0) {
            lines.push(
              "### Sites with Disconnected-Ops Capability",
              ...impact.canOperateDisconnected.map(
                (s) => `- ✅ **${s.name}** (${s.resourceCount} resources)`,
              ),
              "",
            );
          }

          if (impact.willFail.length > 0) {
            lines.push(
              "### Sites That Will Fail",
              ...impact.willFail.map(
                (s) => `- ❌ **${s.name}** (${s.resourceCount} resources, no disconnected-ops)`,
              ),
              "",
            );
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: {
              targetType,
              target,
              provider: impact.provider,
              affectedSites: impact.affectedSites.length,
              affectedClusters: impact.affectedClusters.length,
              affectedResources: impact.affectedResources,
              canOperateDisconnected: impact.canOperateDisconnected.length,
              willFail: impact.willFail.length,
            },
          };
        }

        if (targetType === "site") {
          const impact = await analyzer.edgeSiteImpact(target);

          lines.push(
            `## Edge Site Impact: ${target}`,
            "",
            `**Blast Radius:** ${impact.blastRadius} resources`,
            `**Cloud Dependencies:** ${impact.cloudDependencies.length}`,
            "",
          );

          if (impact.cloudDependencies.length > 0) {
            lines.push(
              "### Cloud Dependencies",
              ...impact.cloudDependencies.map(
                (d) => `- ${d.name} (${d.resourceType}, ${d.provider})`,
              ),
              "",
            );
          }

          if (impact.dataFlowImpact.length > 0) {
            lines.push(
              "### Data Flow Impact",
              ...impact.dataFlowImpact.map((d) => `- ${d}`),
              "",
            );
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: {
              targetType,
              target,
              blastRadius: impact.blastRadius,
              cloudDependencies: impact.cloudDependencies.length,
              dataFlowImpact: impact.dataFlowImpact.length,
            },
          };
        }

        // targetType === "cluster"
        // Use disconnected operation assessment to check cluster impact
        const topology = await coordinator.discoverAll();
        const targetCluster = topology.fleetClusters.find(
          (c) => c.id === target || c.name === target,
        );

        if (!targetCluster) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Cluster "${target}" not found in hybrid topology.`,
              },
            ],
            details: { targetType, target, error: "not_found" },
          };
        }

        const assessment = await analyzer.disconnectedOperationAssessment([
          targetCluster,
        ]);

        const category = assessment.fullyDisconnectable.length > 0
          ? "fully-disconnectable"
          : assessment.partiallyDisconnectable.length > 0
            ? "partially-disconnectable"
            : "requires-connectivity";

        lines.push(
          `## Cluster Impact: ${targetCluster.name}`,
          "",
          `**Provider:** ${targetCluster.provider}`,
          `**K8s Version:** ${targetCluster.kubernetesVersion}`,
          `**Nodes:** ${targetCluster.nodeCount}`,
          `**Status:** ${targetCluster.status}`,
          `**Disconnected Operation:** ${category}`,
          "",
        );

        if (assessment.partiallyDisconnectable.length > 0) {
          lines.push(
            "### Cloud Dependencies (non-critical)",
            ...assessment.partiallyDisconnectable[0]!.cloudDependencies.map(
              (d) => `- ${d.name} (${d.resourceType})`,
            ),
            "",
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            targetType,
            target,
            cluster: targetCluster.name,
            category,
            provider: targetCluster.provider,
          },
        };
      },
    },
    { names: ["hybrid_blast_radius"] },
  );
}
