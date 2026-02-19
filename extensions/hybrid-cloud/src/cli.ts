/**
 * Hybrid/Edge Infrastructure — CLI Commands
 *
 * Registers `espada hybrid` subcommands for managing hybrid/edge
 * infrastructure from the terminal.
 */

import type { Command } from "commander";
import type { HybridDiscoveryCoordinator } from "./discovery-coordinator.js";
import type { CrossBoundaryAnalyzer } from "./cross-boundary-analysis.js";
import type { CloudProvider, ConnectivityStatus } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export type CliContext = {
  program: Command;
  config: unknown;
  workspaceDir?: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

// =============================================================================
// Helpers
// =============================================================================

/** Simple table formatter for terminal output. */
function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => ` ${(c ?? "").padEnd(widths[i]!)} `).join("│");

  return [formatRow(headers), sep, ...rows.map(formatRow)].join("\n");
}

/** Connectivity status indicator. */
function statusIcon(status: ConnectivityStatus): string {
  switch (status) {
    case "connected":
      return "●";
    case "degraded":
      return "◐";
    case "disconnected":
      return "○";
    default:
      return "?";
  }
}

// =============================================================================
// CLI Registration
// =============================================================================

/**
 * Register `espada hybrid` CLI commands.
 */
export function registerHybridCli(
  ctx: CliContext,
  coordinator: HybridDiscoveryCoordinator,
  analyzer: CrossBoundaryAnalyzer,
): void {
  const hybrid = ctx.program
    .command("hybrid")
    .description("Hybrid/edge infrastructure commands");

  // ---------------------------------------------------------------------------
  // hybrid status
  // ---------------------------------------------------------------------------
  hybrid
    .command("status")
    .description("Overview of all hybrid/edge infrastructure")
    .action(async () => {
      const topology = await coordinator.discoverAll();
      const health = await coordinator.healthCheckAll();

      console.log("\n⬡ Hybrid Infrastructure Overview\n");

      // Provider health
      const healthRows = [...health.entries()].map(([provider, ok]) => [
        provider,
        ok ? "● healthy" : "○ unreachable",
      ]);

      if (healthRows.length > 0) {
        console.log("Providers:");
        console.log(table(["Provider", "Status"], healthRows));
        console.log();
      }

      // Summary
      console.log(
        table(
          ["Metric", "Value"],
          [
            ["Cloud Regions", String(topology.cloudRegions.length)],
            ["Edge Sites", String(topology.edgeSites.length)],
            ["Fleet Clusters", String(topology.fleetClusters.length)],
            ["Connected Sites", String(topology.summary.connectedSites)],
            ["Disconnected Sites", String(topology.summary.disconnectedSites)],
            ["Edge Resources", String(topology.summary.totalEdgeResources)],
          ],
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // hybrid sites
  // ---------------------------------------------------------------------------
  hybrid
    .command("sites")
    .description("List edge sites with connectivity status")
    .option("--provider <provider>", "Filter by cloud provider")
    .option("--status <status>", "Filter by connectivity status")
    .action(async (opts: { provider?: string; status?: string }) => {
      let sites = await coordinator.discoverEdgeSites();

      if (opts.provider) {
        sites = sites.filter((s) => s.provider === opts.provider);
      }
      if (opts.status) {
        sites = sites.filter((s) => s.status === opts.status);
      }

      console.log(`\n⬡ Edge Sites (${sites.length})\n`);

      if (sites.length === 0) {
        console.log("No sites found.");
        return;
      }

      console.log(
        table(
          ["Status", "Site", "Provider", "Region", "Resources", "Clusters", "Capabilities"],
          sites.map((s) => [
            statusIcon(s.status),
            s.name,
            s.provider,
            s.parentCloudRegion,
            String(s.resourceCount),
            String(s.managedClusters.length),
            s.capabilities.join(", "),
          ]),
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // hybrid fleet
  // ---------------------------------------------------------------------------
  hybrid
    .command("fleet")
    .description("Cross-provider Kubernetes fleet view")
    .option("--provider <provider>", "Filter by cloud provider")
    .option("--fleet-id <fleetId>", "Filter by fleet ID")
    .action(async (opts: { provider?: string; fleetId?: string }) => {
      let clusters = await coordinator.discoverFleet();

      if (opts.provider) {
        clusters = clusters.filter((c) => c.provider === opts.provider);
      }
      if (opts.fleetId) {
        clusters = clusters.filter((c) => c.fleetId === opts.fleetId);
      }

      const drift = analyzer.fleetDriftAnalysis(clusters);

      console.log(`\n⬡ Kubernetes Fleet (${clusters.length} clusters)\n`);
      console.log(`Fleet Consistency Score: ${drift.score}/100\n`);

      if (drift.versionSkew.length > 0) {
        console.log("Version Skew:");
        for (const v of drift.versionSkew) {
          console.log(`  ⚠ ${v.cluster}: ${v.version}`);
        }
        console.log();
      }

      if (clusters.length === 0) {
        console.log("No clusters found.");
        return;
      }

      console.log(
        table(
          ["Cluster", "Provider", "K8s", "Nodes", "Status", "Connectivity", "Managed By", "Fleet"],
          clusters.map((c) => [
            c.name,
            c.provider,
            c.kubernetesVersion,
            String(c.nodeCount),
            c.status,
            c.connectivity,
            c.managedBy,
            c.fleetId ?? "—",
          ]),
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // hybrid topology
  // ---------------------------------------------------------------------------
  hybrid
    .command("topology")
    .description("Full topology (text table or --format mermaid)")
    .option("--format <format>", "Output format: text or mermaid", "text")
    .option("--provider <provider>", "Filter by provider")
    .action(async (opts: { format: string; provider?: string }) => {
      const topology = await coordinator.discoverAll();

      const regions = opts.provider
        ? topology.cloudRegions.filter((r) => r.provider === opts.provider)
        : topology.cloudRegions;

      const sites = opts.provider
        ? topology.edgeSites.filter((s) => s.provider === opts.provider)
        : topology.edgeSites;

      if (opts.format === "mermaid") {
        const lines: string[] = ["graph TD"];

        for (const region of regions) {
          const regionId = `region_${region.region.replace(/[^a-zA-Z0-9]/g, "_")}`;
          lines.push(`  ${regionId}["☁ ${region.region}<br/>${region.resourceCount} resources"]`);

          for (const site of region.edgeSites) {
            const siteId = `site_${site.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const icon = site.status === "connected" ? "🟢" : site.status === "degraded" ? "🟡" : "🔴";
            lines.push(`  ${siteId}["${icon} ${site.name}<br/>${site.resourceCount} resources"]`);
            lines.push(`  ${regionId} --> ${siteId}`);
          }
        }

        // Orphan sites (no matching region)
        const regionNames = new Set(regions.map((r) => r.region));
        for (const site of sites) {
          if (!regionNames.has(site.parentCloudRegion)) {
            const siteId = `site_${site.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
            lines.push(`  ${siteId}["⬡ ${site.name}<br/>${site.resourceCount} resources"]`);
          }
        }

        console.log(lines.join("\n"));
      } else {
        // Text table
        console.log("\n⬡ Hybrid Topology\n");

        if (regions.length > 0) {
          console.log("Cloud Regions:");
          console.log(
            table(
              ["Provider", "Region", "Resources", "Edge Sites"],
              regions.map((r) => [
                r.provider,
                r.region,
                String(r.resourceCount),
                String(r.edgeSites.length),
              ]),
            ),
          );
          console.log();
        }

        if (sites.length > 0) {
          console.log("Edge Sites:");
          console.log(
            table(
              ["Status", "Site", "Provider", "Parent Region", "Resources"],
              sites.map((s) => [
                statusIcon(s.status),
                s.name,
                s.provider,
                s.parentCloudRegion,
                String(s.resourceCount),
              ]),
            ),
          );
          console.log();
        }

        if (topology.connections.length > 0) {
          console.log("Connections:");
          console.log(
            table(
              ["From", "To", "Status", "Latency", "Bandwidth"],
              topology.connections.map((c) => [
                c.from,
                c.to,
                c.status,
                c.latencyMs != null ? `${c.latencyMs}ms` : "—",
                c.bandwidth ?? "—",
              ]),
            ),
          );
        }
      }
    });

  // ---------------------------------------------------------------------------
  // hybrid sync
  // ---------------------------------------------------------------------------
  hybrid
    .command("sync")
    .description("Trigger hybrid discovery across all providers")
    .option("--provider <provider>", "Sync only a specific provider")
    .action(async (opts: { provider?: string }) => {
      console.log("Starting hybrid infrastructure sync...\n");

      const start = Date.now();

      if (opts.provider) {
        // Sync a single provider
        const sites = await coordinator.discoverEdgeSites();
        const clusters = await coordinator.discoverFleet();
        const filtered = {
          sites: sites.filter((s) => s.provider === opts.provider),
          clusters: clusters.filter((c) => c.provider === opts.provider),
        };

        console.log(
          table(
            ["Metric", "Count"],
            [
              ["Sites Discovered", String(filtered.sites.length)],
              ["Clusters Discovered", String(filtered.clusters.length)],
              ["Duration", `${Date.now() - start}ms`],
            ],
          ),
        );
      } else {
        // Full sync
        const topology = await coordinator.discoverAll();

        console.log(
          table(
            ["Metric", "Count"],
            [
              ["Cloud Regions", String(topology.cloudRegions.length)],
              ["Edge Sites", String(topology.edgeSites.length)],
              ["Fleet Clusters", String(topology.fleetClusters.length)],
              ["Connections", String(topology.connections.length)],
              ["Duration", `${Date.now() - start}ms`],
            ],
          ),
        );
      }
    });

  // ---------------------------------------------------------------------------
  // hybrid blast-radius
  // ---------------------------------------------------------------------------
  hybrid
    .command("blast-radius")
    .description("Cross-boundary blast radius analysis")
    .argument("<target>", "Target: cloud region name, site ID, or cluster ID")
    .option("-t, --type <type>", "Target type: region, site, or cluster", "region")
    .option("--provider <provider>", "Cloud provider (for region targets)")
    .action(async (target: string, opts: { type: string; provider?: string }) => {
      const topology = await coordinator.discoverAll();

      if (opts.type === "region") {
        const provider = (opts.provider ?? "aws") as CloudProvider;
        const impact = await analyzer.cloudRegionImpact(
          target,
          provider,
          topology.edgeSites,
          topology.fleetClusters,
        );

        console.log(`\n⬡ Cloud Region Impact: ${target} (${provider})\n`);
        console.log(
          table(
            ["Metric", "Value"],
            [
              ["Affected Sites", String(impact.affectedSites.length)],
              ["Affected Clusters", String(impact.affectedClusters.length)],
              ["Affected Resources", String(impact.affectedResources)],
              ["Can Operate Disconnected", String(impact.canOperateDisconnected.length)],
              ["Will Fail", String(impact.willFail.length)],
            ],
          ),
        );

        if (impact.willFail.length > 0) {
          console.log("\nSites That Will Fail:");
          for (const s of impact.willFail) {
            console.log(`  ✗ ${s.name} (${s.resourceCount} resources)`);
          }
        }
      } else if (opts.type === "site") {
        const impact = await analyzer.edgeSiteImpact(target);

        console.log(`\n⬡ Edge Site Impact: ${target}\n`);
        console.log(
          table(
            ["Metric", "Value"],
            [
              ["Blast Radius", String(impact.blastRadius)],
              ["Cloud Dependencies", String(impact.cloudDependencies.length)],
              ["Data Flow Impact", String(impact.dataFlowImpact.length)],
            ],
          ),
        );
      } else {
        // Cluster
        const cluster = topology.fleetClusters.find(
          (c) => c.id === target || c.name === target,
        );

        if (!cluster) {
          console.log(`Cluster "${target}" not found.`);
          return;
        }

        const assessment = await analyzer.disconnectedOperationAssessment([cluster]);
        const category = assessment.fullyDisconnectable.length > 0
          ? "fully-disconnectable"
          : assessment.partiallyDisconnectable.length > 0
            ? "partially-disconnectable"
            : "requires-connectivity";

        console.log(`\n⬡ Cluster Impact: ${cluster.name}\n`);
        console.log(
          table(
            ["Metric", "Value"],
            [
              ["Provider", cluster.provider],
              ["K8s Version", cluster.kubernetesVersion],
              ["Nodes", String(cluster.nodeCount)],
              ["Status", cluster.status],
              ["Disconnected Operation", category],
            ],
          ),
        );
      }
    });

  // ---------------------------------------------------------------------------
  // hybrid assess
  // ---------------------------------------------------------------------------
  hybrid
    .command("assess")
    .description("Disconnected operation assessment + DR posture")
    .option("--dr", "Include DR posture analysis")
    .action(async (opts: { dr?: boolean }) => {
      const topology = await coordinator.discoverAll();
      const assessment = await analyzer.disconnectedOperationAssessment(
        topology.fleetClusters,
      );

      console.log("\n⬡ Disconnected Operation Assessment\n");

      if (assessment.fullyDisconnectable.length > 0) {
        console.log(`Fully Disconnectable (${assessment.fullyDisconnectable.length}):`);
        for (const c of assessment.fullyDisconnectable) {
          console.log(`  ✓ ${c.name} (${c.provider}, ${c.nodeCount} nodes)`);
        }
        console.log();
      }

      if (assessment.partiallyDisconnectable.length > 0) {
        console.log(`Partially Disconnectable (${assessment.partiallyDisconnectable.length}):`);
        for (const { cluster, cloudDependencies } of assessment.partiallyDisconnectable) {
          console.log(`  ◐ ${cluster.name} — loses: ${cloudDependencies.map((d) => d.name).join(", ")}`);
        }
        console.log();
      }

      if (assessment.requiresConnectivity.length > 0) {
        console.log(`Requires Connectivity (${assessment.requiresConnectivity.length}):`);
        for (const c of assessment.requiresConnectivity) {
          console.log(`  ✗ ${c.name} (${c.provider})`);
        }
        console.log();
      }

      if (opts.dr) {
        const dr = analyzer.hybridDRPosture(topology.edgeSites, topology.fleetClusters);

        console.log(`\n⬡ Hybrid DR Posture (Score: ${dr.overallScore}/100)\n`);

        if (dr.singleRegionRisks.length > 0) {
          console.log("Single-Region Risks:");
          console.log(
            table(
              ["Region", "Edge Sites", "Failover"],
              dr.singleRegionRisks.map((r) => [
                r.region,
                String(r.edgeSites),
                r.canFailover ? "✓" : "✗",
              ]),
            ),
          );
          console.log();
        }

        if (dr.recommendations.length > 0) {
          console.log("Recommendations:");
          for (const rec of dr.recommendations) {
            console.log(`  → ${rec}`);
          }
        }
      }
    });
}
