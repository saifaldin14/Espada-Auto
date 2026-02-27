/**
 * Infrastructure Knowledge Graph — Infrastructure Scan Report
 *
 * Generates comprehensive scan reports from the knowledge graph.
 * Supports terminal (ANSI), Markdown, HTML, and JSON output formats.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphStats,
  NodeFilter,
} from "./types.js";
import {
  findOrphans,
  findSinglePointsOfFailure,
  findCriticalNodes,
  type CriticalNode,
} from "./queries.js";
import { GraphEngine } from "./engine.js";

// =============================================================================
// Types
// =============================================================================

export type ReportFormat = "terminal" | "markdown" | "html" | "json";

export type ReportFindings = {
  orphanedResources: GraphNode[];
  orphanedMonthlyCost: number;
  singlePointsOfFailure: GraphNode[];
  spofBlastRadii: Map<string, number>;
  untaggedResources: GraphNode[];
  gpuInstances: GraphNode[];
  gpuIdleCost: number;
  criticalNodes: CriticalNode[];
  topCostlyResources: GraphNode[];
};

export type ScanReport = {
  generatedAt: string;
  stats: GraphStats;
  findings: ReportFindings;
  providers: string[];
  regions: string[];
  totalMonthlyCost: number;
};

export type ReportOptions = {
  /** Output format. */
  format?: ReportFormat;
  /** Focus on a specific finding type. */
  focus?: "orphans" | "spof" | "cost" | "untagged" | "full";
  /** Max resources to show per section. */
  topN?: number;
  /** Filter to specific provider. */
  provider?: string;
};

// =============================================================================
// Report Generation
// =============================================================================

/**
 * Generate a comprehensive scan report from the knowledge graph.
 */
export async function generateScanReport(
  engine: GraphEngine,
  storage: GraphStorage,
  options: ReportOptions = {},
): Promise<{ report: ScanReport; formatted: string }> {
  const stats = await engine.getStats();
  const topN = options.topN ?? 20;

  const filter: NodeFilter = options.provider
    ? { provider: options.provider as GraphNode["provider"] }
    : {};

  // Gather findings in parallel
  const [
    allNodes,
    orphans,
    spofs,
    critical,
  ] = await Promise.all([
    storage.queryNodes(filter),
    findOrphans(storage, filter),
    findSinglePointsOfFailure(storage, filter),
    findCriticalNodes(storage, filter, 10),
  ]);

  // Calculate SPOF blast radii
  const spofBlastRadii = new Map<string, number>();
  for (const spof of spofs) {
    try {
      const blast = await engine.getBlastRadius(spof.id, 3);
      spofBlastRadii.set(spof.id, blast.nodes.size);
    } catch {
      spofBlastRadii.set(spof.id, 0);
    }
  }

  // Find untagged resources
  const untaggedResources = allNodes.filter(
    (n) => Object.keys(n.tags).length === 0,
  );

  // Find GPU instances
  const gpuInstances = allNodes.filter((n) => {
    const meta = n.metadata as Record<string, unknown>;
    return meta["isGpuInstance"] === true || meta["aiWorkload"] === true;
  });

  // Estimate idle GPU cost (heuristic: GPU instances that are "running" with no connections)
  const gpuOrphans = gpuInstances.filter((g) =>
    orphans.some((o) => o.id === g.id),
  );
  const gpuIdleCost = gpuOrphans.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

  // Orphan cost
  const orphanedMonthlyCost = orphans.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

  // Top costly resources
  const topCostlyResources = [...allNodes]
    .filter((n) => n.costMonthly != null && n.costMonthly > 0)
    .sort((a, b) => (b.costMonthly ?? 0) - (a.costMonthly ?? 0))
    .slice(0, topN);

  // Unique providers and regions
  const providers = [...new Set(allNodes.map((n) => n.provider))];
  const regions = [...new Set(allNodes.map((n) => n.region).filter((r) => r !== "unknown"))];

  const findings: ReportFindings = {
    orphanedResources: orphans,
    orphanedMonthlyCost,
    singlePointsOfFailure: spofs,
    spofBlastRadii,
    untaggedResources,
    gpuInstances,
    gpuIdleCost,
    criticalNodes: critical,
    topCostlyResources,
  };

  const report: ScanReport = {
    generatedAt: new Date().toISOString(),
    stats,
    findings,
    providers,
    regions,
    totalMonthlyCost: stats.totalCostMonthly,
  };

  const format = options.format ?? "terminal";
  const focus = options.focus ?? "full";
  const formatted = formatReport(report, format, focus, topN);

  return { report, formatted };
}

// =============================================================================
// Formatting
// =============================================================================

function formatReport(
  report: ScanReport,
  format: ReportFormat,
  focus: string,
  topN: number,
): string {
  switch (format) {
    case "terminal":
      return formatTerminal(report, focus, topN);
    case "markdown":
      return formatMarkdown(report, focus, topN);
    case "json":
      return formatJson(report);
    case "html":
      return formatHtml(report, focus, topN);
  }
}

// =============================================================================
// Terminal Format (ANSI)
// =============================================================================

function formatTerminal(report: ScanReport, focus: string, topN: number): string {
  const lines: string[] = [];
  const { stats, findings } = report;

  // Header box
  lines.push("");
  lines.push("\x1b[1;36m╔══════════════════════════════════════════════════════════════╗\x1b[0m");
  lines.push("\x1b[1;36m║\x1b[0m\x1b[1;37m              ESPADA INFRASTRUCTURE SCAN                      \x1b[0m\x1b[1;36m║\x1b[0m");
  lines.push("\x1b[1;36m╠══════════════════════════════════════════════════════════════╣\x1b[0m");
  lines.push("\x1b[1;36m║\x1b[0m                                                              \x1b[1;36m║\x1b[0m");
  lines.push(`\x1b[1;36m║\x1b[0m  Resources:     \x1b[1;37m${pad(String(stats.totalNodes), 6)}\x1b[0m across ${report.providers.length} provider(s)${" ".repeat(Math.max(0, 18 - String(report.providers.length).length))}  \x1b[1;36m║\x1b[0m`);
  lines.push(`\x1b[1;36m║\x1b[0m  Relationships: \x1b[1;37m${pad(String(stats.totalEdges), 6)}\x1b[0m dependencies mapped${" ".repeat(15)}  \x1b[1;36m║\x1b[0m`);
  lines.push(`\x1b[1;36m║\x1b[0m  Monthly Cost:  \x1b[1;33m${pad(fmtCost(stats.totalCostMonthly), 12)}\x1b[0m (estimated)${" ".repeat(14)}  \x1b[1;36m║\x1b[0m`);
  lines.push("\x1b[1;36m║\x1b[0m                                                              \x1b[1;36m║\x1b[0m");

  // Findings
  const hasFindings =
    findings.orphanedResources.length > 0 ||
    findings.singlePointsOfFailure.length > 0 ||
    findings.untaggedResources.length > 0 ||
    findings.gpuInstances.length > 0;

  if (hasFindings) {
    lines.push("\x1b[1;36m║\x1b[0m  \x1b[1;33m⚠ FINDINGS\x1b[0m                                                  \x1b[1;36m║\x1b[0m");
    lines.push("\x1b[1;36m║\x1b[0m  \x1b[2m──────────\x1b[0m                                                  \x1b[1;36m║\x1b[0m");

    if (findings.orphanedResources.length > 0) {
      lines.push(`\x1b[1;36m║\x1b[0m  \x1b[1;31m${pad(String(findings.orphanedResources.length), 3)} orphaned resource(s)\x1b[0m${" ".repeat(14)}\x1b[1;33m${pad(fmtCost(findings.orphanedMonthlyCost) + "/mo wasted", 20)}\x1b[0m  \x1b[1;36m║\x1b[0m`);
    }

    if (findings.singlePointsOfFailure.length > 0) {
      const maxBlast = Math.max(...[...findings.spofBlastRadii.values()]);
      lines.push(`\x1b[1;36m║\x1b[0m  \x1b[1;31m${pad(String(findings.singlePointsOfFailure.length), 3)} single point(s) of failure\x1b[0m${" ".repeat(8)}\x1b[1;33mblast radius: ${maxBlast} nodes\x1b[0m  \x1b[1;36m║\x1b[0m`);
    }

    if (findings.untaggedResources.length > 0) {
      lines.push(`\x1b[1;36m║\x1b[0m  \x1b[1;31m${pad(String(findings.untaggedResources.length), 3)} resource(s) with no tags\x1b[0m${" ".repeat(10)}ungovernable${" ".repeat(8)}  \x1b[1;36m║\x1b[0m`);
    }

    if (findings.gpuInstances.length > 0) {
      lines.push(`\x1b[1;36m║\x1b[0m  \x1b[1;35m${pad(String(findings.gpuInstances.length), 3)} GPU/AI instance(s)\x1b[0m${" ".repeat(16)}\x1b[1;33m${pad(fmtCost(findings.gpuIdleCost) + "/mo idle ", 20)}\x1b[0m  \x1b[1;36m║\x1b[0m`);
    }
  } else {
    lines.push("\x1b[1;36m║\x1b[0m  \x1b[1;32m✓ No critical findings\x1b[0m                                     \x1b[1;36m║\x1b[0m");
  }

  lines.push("\x1b[1;36m║\x1b[0m                                                              \x1b[1;36m║\x1b[0m");
  lines.push("\x1b[1;36m╚══════════════════════════════════════════════════════════════╝\x1b[0m");

  // Detail sections based on focus
  if (focus === "full" || focus === "orphans") {
    if (findings.orphanedResources.length > 0) {
      lines.push("");
      lines.push("\x1b[1;33m━ Orphaned Resources\x1b[0m (no inbound/outbound edges — cleanup candidates)");
      lines.push("");
      lines.push(terminalTable(
        ["Name", "Type", "Provider", "Region", "Cost/mo"],
        findings.orphanedResources.slice(0, topN).map((n) => [
          truncate(n.name, 30),
          n.resourceType,
          n.provider,
          n.region,
          fmtCost(n.costMonthly),
        ]),
      ));
    }
  }

  if (focus === "full" || focus === "spof") {
    if (findings.singlePointsOfFailure.length > 0) {
      lines.push("");
      lines.push("\x1b[1;31m━ Single Points of Failure\x1b[0m (removal disconnects the graph)");
      lines.push("");
      lines.push(terminalTable(
        ["Name", "Type", "Provider", "Blast Radius"],
        findings.singlePointsOfFailure.slice(0, topN).map((n) => [
          truncate(n.name, 30),
          n.resourceType,
          n.provider,
          `${findings.spofBlastRadii.get(n.id) ?? "?"} nodes`,
        ]),
      ));
    }
  }

  if (focus === "full" || focus === "cost") {
    if (findings.topCostlyResources.length > 0) {
      lines.push("");
      lines.push("\x1b[1;33m━ Top Resource Costs\x1b[0m");
      lines.push("");
      lines.push(terminalTable(
        ["Name", "Type", "Provider", "Cost/mo"],
        findings.topCostlyResources.slice(0, topN).map((n) => [
          truncate(n.name, 30),
          n.resourceType,
          n.provider,
          fmtCost(n.costMonthly),
        ]),
      ));
    }

    // Cost breakdown by resource type
    if (Object.keys(report.stats.nodesByResourceType).length > 0) {
      lines.push("");
      lines.push("\x1b[1;33m━ Resource Count by Type\x1b[0m");
      lines.push("");
      lines.push(terminalTable(
        ["Type", "Count"],
        Object.entries(report.stats.nodesByResourceType)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([t, c]) => [t, String(c)]),
      ));
    }
  }

  if (focus === "full" || focus === "untagged") {
    if (findings.untaggedResources.length > 0) {
      lines.push("");
      lines.push("\x1b[1;33m━ Untagged Resources\x1b[0m (governance gaps)");
      lines.push("");
      lines.push(terminalTable(
        ["Name", "Type", "Provider", "Region"],
        findings.untaggedResources.slice(0, topN).map((n) => [
          truncate(n.name, 30),
          n.resourceType,
          n.provider,
          n.region,
        ]),
      ));
    }
  }

  lines.push("");
  return lines.join("\n");
}

// =============================================================================
// Markdown Format
// =============================================================================

function formatMarkdown(report: ScanReport, focus: string, topN: number): string {
  const lines: string[] = [];
  const { stats, findings } = report;

  lines.push("# Espada Infrastructure Scan Report");
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Providers:** ${report.providers.join(", ")}`);
  lines.push(`**Regions:** ${report.regions.join(", ")}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total Resources | ${stats.totalNodes} |`);
  lines.push(`| Total Relationships | ${stats.totalEdges} |`);
  lines.push(`| Estimated Monthly Cost | ${fmtCost(stats.totalCostMonthly)} |`);
  lines.push(`| Orphaned Resources | ${findings.orphanedResources.length} (${fmtCost(findings.orphanedMonthlyCost)}/mo wasted) |`);
  lines.push(`| Single Points of Failure | ${findings.singlePointsOfFailure.length} |`);
  lines.push(`| Untagged Resources | ${findings.untaggedResources.length} |`);
  lines.push(`| GPU/AI Instances | ${findings.gpuInstances.length} |`);
  lines.push("");

  if (focus === "full" || focus === "orphans") {
    if (findings.orphanedResources.length > 0) {
      lines.push("## Orphaned Resources");
      lines.push("");
      lines.push("| Name | Type | Provider | Region | Cost/mo |");
      lines.push("|---|---|---|---|---|");
      for (const n of findings.orphanedResources.slice(0, topN)) {
        lines.push(`| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.region} | ${fmtCost(n.costMonthly)} |`);
      }
      lines.push("");
    }
  }

  if (focus === "full" || focus === "spof") {
    if (findings.singlePointsOfFailure.length > 0) {
      lines.push("## Single Points of Failure");
      lines.push("");
      lines.push("| Name | Type | Provider | Blast Radius |");
      lines.push("|---|---|---|---|");
      for (const n of findings.singlePointsOfFailure.slice(0, topN)) {
        lines.push(`| ${n.name} | ${n.resourceType} | ${n.provider} | ${findings.spofBlastRadii.get(n.id) ?? "?"} nodes |`);
      }
      lines.push("");
    }
  }

  if (focus === "full" || focus === "cost") {
    if (findings.topCostlyResources.length > 0) {
      lines.push("## Top Costly Resources");
      lines.push("");
      lines.push("| Name | Type | Provider | Cost/mo |");
      lines.push("|---|---|---|---|");
      for (const n of findings.topCostlyResources.slice(0, topN)) {
        lines.push(`| ${n.name} | ${n.resourceType} | ${n.provider} | ${fmtCost(n.costMonthly)} |`);
      }
      lines.push("");
    }
  }

  if (focus === "full" || focus === "untagged") {
    if (findings.untaggedResources.length > 0) {
      lines.push("## Untagged Resources");
      lines.push("");
      lines.push("| Name | Type | Provider | Region |");
      lines.push("|---|---|---|---|");
      for (const n of findings.untaggedResources.slice(0, topN)) {
        lines.push(`| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.region} |`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// =============================================================================
// JSON Format
// =============================================================================

function formatJson(report: ScanReport): string {
  return JSON.stringify(
    {
      generatedAt: report.generatedAt,
      stats: {
        totalNodes: report.stats.totalNodes,
        totalEdges: report.stats.totalEdges,
        totalCostMonthly: report.stats.totalCostMonthly,
        providers: report.providers,
        regions: report.regions,
        nodesByProvider: report.stats.nodesByProvider,
        nodesByResourceType: report.stats.nodesByResourceType,
      },
      findings: {
        orphanedResources: report.findings.orphanedResources.map(simplifyNode),
        orphanedMonthlyCost: report.findings.orphanedMonthlyCost,
        singlePointsOfFailure: report.findings.singlePointsOfFailure.map((n) => ({
          ...simplifyNode(n),
          blastRadius: report.findings.spofBlastRadii.get(n.id) ?? 0,
        })),
        untaggedResources: report.findings.untaggedResources.map(simplifyNode),
        gpuInstances: report.findings.gpuInstances.map(simplifyNode),
        gpuIdleCost: report.findings.gpuIdleCost,
        topCostlyResources: report.findings.topCostlyResources.map(simplifyNode),
      },
    },
    null,
    2,
  );
}

function simplifyNode(n: GraphNode) {
  return {
    id: n.id,
    name: n.name,
    resourceType: n.resourceType,
    provider: n.provider,
    region: n.region,
    status: n.status,
    costMonthly: n.costMonthly,
    tags: n.tags,
  };
}

// =============================================================================
// HTML Format
// =============================================================================

function formatHtml(report: ScanReport, focus: string, topN: number): string {
  // Build HTML directly from report data (structured output, not markdown conversion)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Espada Infrastructure Scan Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; background: #f8f9fa; }
    h1 { color: #0d1117; border-bottom: 2px solid #0969da; padding-bottom: 8px; }
    h2 { color: #24292f; margin-top: 32px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #d0d7de; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; font-weight: 600; }
    tr:nth-child(even) { background: #f6f8fa; }
    .summary-box { background: #fff; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px 24px; margin: 16px 0; }
    .finding-warning { color: #cf222e; font-weight: 600; }
    .finding-cost { color: #bf8700; font-weight: 600; }
    .meta { color: #656d76; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Espada Infrastructure Scan Report</h1>
  <p class="meta">Generated: ${report.generatedAt} | Providers: ${report.providers.join(", ")} | Regions: ${report.regions.join(", ")}</p>

  <div class="summary-box">
    <h2>Summary</h2>
    <table>
      <tr><td>Total Resources</td><td><strong>${report.stats.totalNodes}</strong></td></tr>
      <tr><td>Total Relationships</td><td><strong>${report.stats.totalEdges}</strong></td></tr>
      <tr><td>Estimated Monthly Cost</td><td class="finding-cost"><strong>${fmtCost(report.stats.totalCostMonthly)}</strong></td></tr>
      <tr><td>Orphaned Resources</td><td class="finding-warning">${report.findings.orphanedResources.length} (${fmtCost(report.findings.orphanedMonthlyCost)}/mo wasted)</td></tr>
      <tr><td>Single Points of Failure</td><td class="finding-warning">${report.findings.singlePointsOfFailure.length}</td></tr>
      <tr><td>Untagged Resources</td><td>${report.findings.untaggedResources.length}</td></tr>
      <tr><td>GPU/AI Instances</td><td>${report.findings.gpuInstances.length}</td></tr>
    </table>
  </div>

  ${buildHtmlFindingSection("Orphaned Resources", report.findings.orphanedResources.slice(0, topN), ["Name", "Type", "Provider", "Region", "Cost/mo"], (n) => [n.name, n.resourceType, n.provider, n.region, fmtCost(n.costMonthly)], focus === "full" || focus === "orphans")}

  ${buildHtmlFindingSection("Single Points of Failure", report.findings.singlePointsOfFailure.slice(0, topN), ["Name", "Type", "Provider", "Blast Radius"], (n) => [n.name, n.resourceType, n.provider, `${report.findings.spofBlastRadii.get(n.id) ?? "?"} nodes`], focus === "full" || focus === "spof")}

  ${buildHtmlFindingSection("Top Costly Resources", report.findings.topCostlyResources.slice(0, topN), ["Name", "Type", "Provider", "Cost/mo"], (n) => [n.name, n.resourceType, n.provider, fmtCost(n.costMonthly)], focus === "full" || focus === "cost")}

  ${buildHtmlFindingSection("Untagged Resources", report.findings.untaggedResources.slice(0, topN), ["Name", "Type", "Provider", "Region"], (n) => [n.name, n.resourceType, n.provider, n.region], focus === "full" || focus === "untagged")}

</body>
</html>`;
}

function buildHtmlFindingSection(
  title: string,
  items: GraphNode[],
  headers: string[],
  rowFn: (n: GraphNode) => string[],
  show: boolean,
): string {
  if (!show || items.length === 0) return "";

  const headerRow = headers.map((h) => `<th>${h}</th>`).join("");
  const rows = items
    .map((n) => {
      const cells = rowFn(n).map((c) => `<td>${escapeHtml(c)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n      ");

  return `
  <h2>${title}</h2>
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// =============================================================================
// Helpers
// =============================================================================

function fmtCost(cost: number | null | undefined): string {
  if (cost == null) return "—";
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${cost.toFixed(2)}`;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function truncate(s: string, max = 30): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function terminalTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => ` ${(c ?? "").padEnd(widths[i]!)} `).join("│");

  return [
    `\x1b[2m${formatRow(headers)}\x1b[0m`,
    `\x1b[2m${sep}\x1b[0m`,
    ...rows.map(formatRow),
  ].join("\n");
}
