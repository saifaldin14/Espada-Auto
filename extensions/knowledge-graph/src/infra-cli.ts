/**
 * Infrastructure Knowledge Graph — Infra Scan CLI Commands
 *
 * Registers `espada infra` CLI subcommands for scanning Terraform state,
 * generating reports, and querying infrastructure intelligence.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { GraphEngine } from "./engine.js";
import { InMemoryGraphStorage } from "./storage/index.js";
import { SQLiteGraphStorage } from "./storage/index.js";
import { TerraformDiscoveryAdapter } from "./adapters/terraform.js";
import { AwsDiscoveryAdapter } from "./adapters/aws.js";
import type { AwsAdapterConfig } from "./adapters/aws.js";
import { AzureDiscoveryAdapter } from "./adapters/azure.js";
import { GcpDiscoveryAdapter } from "./adapters/gcp.js";
import { KubernetesDiscoveryAdapter } from "./adapters/kubernetes.js";
import { discoverCrossCloudRelationships, getCrossCloudSummary } from "./adapters/cross-cloud.js";
import { exportTopology, type ExportFormat } from "./export.js";
import { generateScanReport, type ReportFormat } from "./report.js";
import {
  InfraMonitor,
  SCHEDULE_PRESETS,
  BUILTIN_ALERT_RULES,
  getTimelineSummary,
  getGraphDiff,
  getCostTrend,
  CloudTrailEventSource,
  AzureActivityLogEventSource,
  GcpAuditLogEventSource,
  type SchedulePreset,
} from "./monitoring.js";
import {
  InMemoryTemporalStorage,
  takeSnapshot,
  getNodeHistory,
  diffTimestamps,
  getEvolutionSummary,
} from "./temporal.js";
import { parseIQL, executeQuery, IQLSyntaxError } from "./iql/index.js";
// queries.js helpers available if needed:
// import { findOrphans, findSinglePointsOfFailure } from "./queries.js";
import type { CloudProvider, GraphStorage } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export type InfraCliContext = {
  program: Command;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  workspaceDir?: string;
};

// =============================================================================
// CLI Registration
// =============================================================================

/**
 * Register `espada infra` CLI commands.
 */
export function registerInfraCli(ctx: InfraCliContext): void {
  const infra = ctx.program
    .command("infra")
    .description("Infrastructure intelligence — scan, analyze, and report");

  // ---------------------------------------------------------------------------
  // infra scan
  // ---------------------------------------------------------------------------
  infra
    .command("scan")
    .description("Scan infrastructure from Terraform state and generate a report")
    .option("--terraform <path>", "Path to terraform.tfstate file")
    .option("--db <path>", "Path to SQLite database for persistent graph (default: in-memory)")
    .option("-o, --output <format>", "Output format: terminal, markdown, html, json, mermaid, dot", "terminal")
    .option("--provider <provider>", "Filter by cloud provider")
    .option("--account <account>", "Default account/subscription ID")
    .option("--region <region>", "Default region")
    .option("--top <n>", "Show top N findings per section", "20")
    .option("--save <path>", "Save report to file")
    .action(async (opts: {
      terraform?: string;
      db?: string;
      output: string;
      provider?: string;
      account?: string;
      region?: string;
      top: string;
      save?: string;
    }) => {
      if (!opts.terraform) {
        // Auto-detect terraform.tfstate in current directory
        const defaultPath = resolve(process.cwd(), "terraform.tfstate");
        if (existsSync(defaultPath)) {
          opts.terraform = defaultPath;
        } else {
          ctx.logger.error(
            "No Terraform state file found. Use --terraform <path> or run from a directory with terraform.tfstate",
          );
          process.exitCode = 1;
          return;
        }
      }

      const statePath = resolve(opts.terraform);
      if (!existsSync(statePath)) {
        ctx.logger.error(`State file not found: ${statePath}`);
        process.exitCode = 1;
        return;
      }

      // Create storage (in-memory by default, SQLite if --db specified)
      let storage: GraphStorage;
      if (opts.db) {
        storage = new SQLiteGraphStorage(resolve(opts.db));
      } else {
        storage = new InMemoryGraphStorage();
      }
      await storage.initialize();

      // Create engine and adapter
      const engine = new GraphEngine({ storage });
      const adapter = new TerraformDiscoveryAdapter({
        statePath,
        defaultProvider: opts.provider as CloudProvider | undefined,
        defaultAccount: opts.account,
        defaultRegion: opts.region,
      });
      engine.registerAdapter(adapter);

      // Run discovery
      console.error("Scanning Terraform state...");
      const startMs = Date.now();
      const syncRecords = await engine.sync();
      const durationMs = Date.now() - startMs;

      const record = syncRecords[0];
      if (!record) {
        ctx.logger.error("Scan produced no results.");
        await storage.close();
        process.exitCode = 1;
        return;
      }

      if (record.errors.length > 0) {
        for (const err of record.errors) {
          ctx.logger.warn(`Warning: ${err}`);
        }
      }

      console.error(
        `Discovered ${record.nodesDiscovered} resources, ${record.edgesDiscovered} relationships in ${durationMs}ms`,
      );

      // Choose output path based on format
      const outputFormat = opts.output.toLowerCase();
      const topN = parseInt(opts.top, 10);

      if (outputFormat === "mermaid" || outputFormat === "dot" || outputFormat === "json-export") {
        // Export topology directly
        const format = outputFormat === "json-export" ? "json" : outputFormat as ExportFormat;
        const result = await exportTopology(storage, format, {
          includeCost: true,
          includeMetadata: true,
        });
        console.log(result.content);
        console.error(`\nExported ${result.nodeCount} nodes, ${result.edgeCount} edges (${format})`);
      } else {
        // Generate scan report
        const reportFormat = outputFormat as ReportFormat;
        const { formatted } = await generateScanReport(engine, storage, {
          format: reportFormat === "terminal" || reportFormat === "markdown" || reportFormat === "html" || reportFormat === "json"
            ? reportFormat
            : "terminal",
          focus: "full",
          topN,
          provider: opts.provider,
        });

        console.log(formatted);
      }

      // Save to file if requested
      if (opts.save) {
        const { writeFileSync } = await import("node:fs");
        const savePath = resolve(opts.save);

        // Determine save format from extension
        const ext = savePath.split(".").pop()?.toLowerCase();
        let saveFormat: ReportFormat = "markdown";
        if (ext === "html") saveFormat = "html";
        else if (ext === "json") saveFormat = "json";
        else if (ext === "md") saveFormat = "markdown";

        const { formatted: savedContent } = await generateScanReport(engine, storage, {
          format: saveFormat,
          focus: "full",
          topN,
          provider: opts.provider,
        });

        writeFileSync(savePath, savedContent, "utf-8");
        console.error(`Report saved to: ${savePath}`);
      }

      await storage.close();
    });

  // ---------------------------------------------------------------------------
  // infra report
  // ---------------------------------------------------------------------------
  infra
    .command("report")
    .description("Generate a detailed infrastructure report from existing graph")
    .option("--terraform <path>", "Path to terraform.tfstate file")
    .option("--db <path>", "Path to SQLite database")
    .option("-o, --output <format>", "Output format: terminal, markdown, html, json", "terminal")
    .option("--focus <area>", "Focus area: full, orphans, spof, cost, untagged", "full")
    .option("--provider <provider>", "Filter by cloud provider")
    .option("--top <n>", "Show top N findings per section", "20")
    .action(async (opts: {
      terraform?: string;
      db?: string;
      output: string;
      focus: string;
      provider?: string;
      top: string;
    }) => {
      // Need either --db or --terraform
      if (!opts.db && !opts.terraform) {
        // Try auto-detect
        const defaultPath = resolve(process.cwd(), "terraform.tfstate");
        if (existsSync(defaultPath)) {
          opts.terraform = defaultPath;
        } else {
          ctx.logger.error(
            "Provide --terraform <path> or --db <path> to generate a report.",
          );
          process.exitCode = 1;
          return;
        }
      }

      let storage: GraphStorage;
      let engine: GraphEngine;

      if (opts.db && existsSync(resolve(opts.db))) {
        // Use existing database
        storage = new SQLiteGraphStorage(resolve(opts.db));
        await storage.initialize();
        engine = new GraphEngine({ storage });
      } else if (opts.terraform) {
        // Scan terraform state first
        storage = new InMemoryGraphStorage();
        await storage.initialize();
        engine = new GraphEngine({ storage });
        const adapter = new TerraformDiscoveryAdapter({
          statePath: resolve(opts.terraform),
          defaultProvider: opts.provider as CloudProvider | undefined,
        });
        engine.registerAdapter(adapter);
        await engine.sync();
      } else {
        ctx.logger.error("No data source available.");
        process.exitCode = 1;
        return;
      }

      const { formatted } = await generateScanReport(engine, storage, {
        format: opts.output as ReportFormat,
        focus: opts.focus as "full" | "orphans" | "spof" | "cost" | "untagged",
        topN: parseInt(opts.top, 10),
        provider: opts.provider,
      });

      console.log(formatted);
      await storage.close();
    });

  // ---------------------------------------------------------------------------
  // infra drift
  // ---------------------------------------------------------------------------
  infra
    .command("drift")
    .description("Compare Terraform state vs live AWS resources to detect drift, shadow IT, and zombie state")
    .option("--terraform <path>", "Path to terraform.tfstate file")
    .option("--db <path>", "Path to SQLite database")
    .option("--aws-profile <profile>", "AWS CLI profile name")
    .option("--aws-region <region>", "AWS region to scan", "us-east-1")
    .option("--aws-account <account>", "AWS account ID")
    .option("-o, --output <format>", "Output format: terminal, json", "terminal")
    .action(async (opts: {
      terraform?: string;
      db?: string;
      awsProfile?: string;
      awsRegion: string;
      awsAccount?: string;
      output: string;
    }) => {
      // Require terraform state
      if (!opts.terraform) {
        const defaultPath = resolve(process.cwd(), "terraform.tfstate");
        if (existsSync(defaultPath)) {
          opts.terraform = defaultPath;
        } else {
          ctx.logger.error(
            "Provide --terraform <path> to specify the Terraform state file.",
          );
          process.exitCode = 1;
          return;
        }
      }

      const statePath = resolve(opts.terraform);
      if (!existsSync(statePath)) {
        ctx.logger.error(`State file not found: ${statePath}`);
        process.exitCode = 1;
        return;
      }

      // 1. Import Terraform state
      let storage: GraphStorage;
      if (opts.db) {
        storage = new SQLiteGraphStorage(resolve(opts.db));
      } else {
        storage = new InMemoryGraphStorage();
      }
      await storage.initialize();

      const tfEngine = new GraphEngine({ storage });
      const tfAdapter = new TerraformDiscoveryAdapter({ statePath });
      tfEngine.registerAdapter(tfAdapter);

      console.error("Importing Terraform state...");
      await tfEngine.sync();
      const tfNodes = await storage.queryNodes({});
      const tfByNativeId = new Map<string, typeof tfNodes[0]>();
      for (const node of tfNodes) {
        if (node.nativeId) tfByNativeId.set(node.nativeId, node);
      }

      // 2. Discover live AWS resources
      console.error("Discovering live AWS resources...");
      const awsConfig: AwsAdapterConfig = {
        regions: [opts.awsRegion],
        profile: opts.awsProfile,
        accountId: opts.awsAccount ?? "unknown",
      };
      const awsAdapter = new AwsDiscoveryAdapter(awsConfig);

      let awsResult;
      try {
        awsResult = await awsAdapter.discover();
      } catch (err) {
        ctx.logger.error(
          `AWS discovery failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        await storage.close();
        process.exitCode = 1;
        return;
      }

      const awsByNativeId = new Map<string, typeof awsResult.nodes[0]>();
      for (const node of awsResult.nodes) {
        if (node.nativeId) awsByNativeId.set(node.nativeId, node);
      }

      // 3. Cross-reference
      const shadowIT: Array<{ nativeId: string; name: string; resourceType: string }> = [];
      const zombieState: Array<{ nativeId: string; name: string; resourceType: string }> = [];
      const drifted: Array<{
        nativeId: string;
        name: string;
        resourceType: string;
        fields: Array<{ field: string; terraform: string; live: string }>;
      }> = [];
      const matched: string[] = [];

      // Find shadow IT: in AWS but not in Terraform
      for (const [nativeId, awsNode] of awsByNativeId) {
        if (!tfByNativeId.has(nativeId)) {
          shadowIT.push({
            nativeId,
            name: awsNode.name,
            resourceType: awsNode.resourceType,
          });
        }
      }

      // Find zombie state + drift: in Terraform
      for (const [nativeId, tfNode] of tfByNativeId) {
        const awsNode = awsByNativeId.get(nativeId);
        if (!awsNode) {
          zombieState.push({
            nativeId,
            name: tfNode.name,
            resourceType: tfNode.resourceType,
          });
        } else {
          matched.push(nativeId);
          // Check for field-level drift
          const fieldDiffs: Array<{ field: string; terraform: string; live: string }> = [];

          if (tfNode.status !== awsNode.status) {
            fieldDiffs.push({
              field: "status",
              terraform: tfNode.status,
              live: awsNode.status,
            });
          }
          if (tfNode.region !== awsNode.region) {
            fieldDiffs.push({
              field: "region",
              terraform: tfNode.region ?? "(none)",
              live: awsNode.region ?? "(none)",
            });
          }
          // Compare tags
          const tfTags = JSON.stringify(tfNode.tags ?? {});
          const awsTags = JSON.stringify(awsNode.tags ?? {});
          if (tfTags !== awsTags) {
            fieldDiffs.push({
              field: "tags",
              terraform: tfTags,
              live: awsTags,
            });
          }

          if (fieldDiffs.length > 0) {
            drifted.push({
              nativeId,
              name: tfNode.name,
              resourceType: tfNode.resourceType,
              fields: fieldDiffs,
            });
          }
        }
      }

      // 4. Output results
      if (opts.output === "json") {
        console.log(JSON.stringify({
          summary: {
            terraformResources: tfNodes.length,
            liveResources: awsResult.nodes.length,
            matched: matched.length,
            shadowIT: shadowIT.length,
            zombieState: zombieState.length,
            drifted: drifted.length,
          },
          shadowIT,
          zombieState,
          drifted,
        }, null, 2));
      } else {
        const lines: string[] = [
          "",
          "═══ Infrastructure Drift Report ═══",
          "",
          `  Terraform resources:  ${tfNodes.length}`,
          `  Live AWS resources:   ${awsResult.nodes.length}`,
          `  Matched:              ${matched.length}`,
          "",
        ];

        if (shadowIT.length > 0) {
          lines.push(`  ⚠  Shadow IT (in AWS, not in Terraform): ${shadowIT.length}`);
          for (const r of shadowIT.slice(0, 20)) {
            lines.push(`     • ${r.resourceType}: ${r.name} (${r.nativeId})`);
          }
          if (shadowIT.length > 20) {
            lines.push(`     … and ${shadowIT.length - 20} more`);
          }
          lines.push("");
        } else {
          lines.push("  ✓  No shadow IT detected");
          lines.push("");
        }

        if (zombieState.length > 0) {
          lines.push(`  ⚠  Zombie state (in Terraform, not in AWS): ${zombieState.length}`);
          for (const r of zombieState.slice(0, 20)) {
            lines.push(`     • ${r.resourceType}: ${r.name} (${r.nativeId})`);
          }
          if (zombieState.length > 20) {
            lines.push(`     … and ${zombieState.length - 20} more`);
          }
          lines.push("");
        } else {
          lines.push("  ✓  No zombie state detected");
          lines.push("");
        }

        if (drifted.length > 0) {
          lines.push(`  ⚠  Drifted resources: ${drifted.length}`);
          for (const r of drifted.slice(0, 20)) {
            lines.push(`     • ${r.resourceType}: ${r.name}`);
            for (const f of r.fields) {
              lines.push(`       ${f.field}: "${f.terraform}" → "${f.live}"`);
            }
          }
          if (drifted.length > 20) {
            lines.push(`     … and ${drifted.length - 20} more`);
          }
          lines.push("");
        } else {
          lines.push("  ✓  No field drift detected");
          lines.push("");
        }

        if (awsResult.errors.length > 0) {
          lines.push(`  Warnings (${awsResult.errors.length}):`);
          for (const err of awsResult.errors.slice(0, 10)) {
            lines.push(`     ⚡ ${err.resourceType}: ${err.message}`);
          }
          lines.push("");
        }

        console.log(lines.join("\n"));
      }

      await storage.close();
    });

  // ---------------------------------------------------------------------------
  // infra cloud-scan
  // ---------------------------------------------------------------------------
  infra
    .command("cloud-scan")
    .description("Scan live cloud resources from AWS, Azure, and/or GCP")
    .option("--db <path>", "Path to SQLite database for persistent graph", "infra-graph.db")
    .option("--terraform <path>", "Also import Terraform state")
    .option("--aws", "Scan AWS resources")
    .option("--aws-profile <profile>", "AWS CLI profile name")
    .option("--aws-region <region>", "AWS region(s), comma-separated", "us-east-1")
    .option("--aws-account <account>", "AWS account ID")
    .option("--azure", "Scan Azure resources")
    .option("--azure-subscription <id>", "Azure subscription ID")
    .option("--azure-tenant <id>", "Azure tenant ID")
    .option("--gcp", "Scan GCP resources")
    .option("--gcp-project <id>", "GCP project ID")
    .option("--gcp-key-file <path>", "GCP service account key file")
    .option("--k8s", "Scan Kubernetes resources")
    .option("--k8s-context <context>", "Kubernetes context name")
    .option("--k8s-kubeconfig <path>", "Path to kubeconfig file")
    .option("--k8s-cluster <name>", "Kubernetes cluster name")
    .option("--k8s-namespaces <ns>", "Comma-separated list of namespaces to scan")
    .option("--k8s-include-system", "Include system namespaces (kube-system, etc.)")
    .option("--cross-cloud", "Discover cross-cloud relationships after scanning", true)
    .option("-o, --output <format>", "Output format: terminal, markdown, html, json", "terminal")
    .option("--top <n>", "Show top N findings per section", "20")
    .action(async (opts: {
      db: string;
      terraform?: string;
      aws?: boolean;
      awsProfile?: string;
      awsRegion: string;
      awsAccount?: string;
      azure?: boolean;
      azureSubscription?: string;
      azureTenant?: string;
      gcp?: boolean;
      gcpProject?: string;
      gcpKeyFile?: string;
      k8s?: boolean;
      k8sContext?: string;
      k8sKubeconfig?: string;
      k8sCluster?: string;
      k8sNamespaces?: string;
      k8sIncludeSystem?: boolean;
      crossCloud: boolean;
      output: string;
      top: string;
    }) => {
      const enabledProviders = [
        opts.aws ? "aws" : null,
        opts.azure ? "azure" : null,
        opts.gcp ? "gcp" : null,
        opts.k8s ? "k8s" : null,
      ].filter(Boolean);

      if (enabledProviders.length === 0 && !opts.terraform) {
        ctx.logger.error("Specify at least one provider (--aws, --azure, --gcp, --k8s) or --terraform");
        process.exitCode = 1;
        return;
      }

      const storage = new SQLiteGraphStorage(resolve(opts.db));
      await storage.initialize();
      const engine = new GraphEngine({ storage });

      // Register Terraform adapter if specified
      if (opts.terraform) {
        const statePath = resolve(opts.terraform);
        if (!existsSync(statePath)) {
          ctx.logger.error(`State file not found: ${statePath}`);
          await storage.close();
          process.exitCode = 1;
          return;
        }
        engine.registerAdapter(new TerraformDiscoveryAdapter({ statePath }));
      }

      // Register AWS adapter
      if (opts.aws) {
        const awsConfig: AwsAdapterConfig = {
          regions: opts.awsRegion.split(",").map((r: string) => r.trim()),
          profile: opts.awsProfile,
          accountId: opts.awsAccount ?? "unknown",
        };
        engine.registerAdapter(new AwsDiscoveryAdapter(awsConfig));
      }

      // Register Azure adapter
      if (opts.azure) {
        if (!opts.azureSubscription) {
          ctx.logger.error("Azure requires --azure-subscription <id>");
          await storage.close();
          process.exitCode = 1;
          return;
        }
        engine.registerAdapter(new AzureDiscoveryAdapter({
          subscriptionId: opts.azureSubscription,
          tenantId: opts.azureTenant,
        }));
      }

      // Register GCP adapter
      if (opts.gcp) {
        if (!opts.gcpProject) {
          ctx.logger.error("GCP requires --gcp-project <id>");
          await storage.close();
          process.exitCode = 1;
          return;
        }
        engine.registerAdapter(new GcpDiscoveryAdapter({
          projectId: opts.gcpProject,
          keyFilePath: opts.gcpKeyFile,
        }));
      }

      // Register Kubernetes adapter
      if (opts.k8s) {
        engine.registerAdapter(new KubernetesDiscoveryAdapter({
          context: opts.k8sContext,
          kubeConfigPath: opts.k8sKubeconfig,
          clusterName: opts.k8sCluster,
          namespaces: opts.k8sNamespaces?.split(",").map((ns: string) => ns.trim()),
          includeSystem: opts.k8sIncludeSystem ?? false,
        }));
      }

      // Run discovery across all providers
      console.error(`Scanning: ${[opts.terraform ? "terraform" : null, ...enabledProviders].filter(Boolean).join(", ")}...`);
      const startMs = Date.now();
      const syncRecords = await engine.sync();
      const durationMs = Date.now() - startMs;

      let totalNodes = 0;
      let totalEdges = 0;
      const providerSummary: string[] = [];

      for (const record of syncRecords) {
        totalNodes += record.nodesDiscovered;
        totalEdges += record.edgesDiscovered;
        const status = record.errors.length > 0 ? "⚠" : "✓";
        providerSummary.push(
          `  ${status} ${record.provider}: ${record.nodesDiscovered} resources, ${record.edgesDiscovered} relationships`,
        );

        for (const err of record.errors) {
          ctx.logger.warn(`  [${record.provider}] ${err}`);
        }
      }

      console.error(`Discovered ${totalNodes} resources, ${totalEdges} relationships in ${durationMs}ms`);
      for (const line of providerSummary) console.error(line);

      // Cross-cloud relationship discovery
      if (opts.crossCloud && enabledProviders.length >= 2) {
        console.error("Analyzing cross-cloud relationships...");
        const crossResult = await discoverCrossCloudRelationships(storage);

        if (crossResult.edges.length > 0) {
          await storage.upsertEdges(crossResult.edges);
          console.error(`  Found ${crossResult.edges.length} cross-cloud relationships`);
          for (const match of crossResult.matches) {
            console.error(`    • ${match.reason} (confidence: ${(match.confidence * 100).toFixed(0)}%)`);
          }
        } else {
          console.error("  No cross-cloud relationships detected");
        }
      }

      // Generate report
      const { formatted } = await generateScanReport(engine, storage, {
        format: opts.output as ReportFormat,
        focus: "full",
        topN: parseInt(opts.top, 10),
      });
      console.log(formatted);

      // Show cross-cloud summary if applicable
      if (opts.crossCloud && enabledProviders.length >= 2) {
        const summary = await getCrossCloudSummary(storage);
        if (summary.totalCrossCloudEdges > 0) {
          console.error("\n  Cross-Cloud Summary:");
          for (const [pair, count] of Object.entries(summary.byProviderPair)) {
            console.error(`    ${pair}: ${count} relationships`);
          }
          if (summary.aiWorkloadConnections > 0) {
            console.error(`    AI workload connections: ${summary.aiWorkloadConnections}`);
          }
        }
      }

      await storage.close();
    });

  // ---------------------------------------------------------------------------
  // infra audit
  // ---------------------------------------------------------------------------
  infra
    .command("audit")
    .description("View the infrastructure change audit trail")
    .option("--terraform <path>", "Path to terraform.tfstate file")
    .option("--db <path>", "Path to SQLite database")
    .option("--initiator <name>", "Filter by who initiated the change")
    .option("--type <type>", "Filter by initiator type: human, agent, system")
    .option("--since <date>", "Show changes after this date (ISO 8601)")
    .option("--until <date>", "Show changes before this date (ISO 8601)")
    .option("--change-type <type>", "Filter by change type (e.g. node-created, node-updated)")
    .option("--limit <n>", "Maximum number of changes to show", "50")
    .option("-o, --output <format>", "Output format: terminal, json", "terminal")
    .action(async (opts: {
      terraform?: string;
      db?: string;
      initiator?: string;
      type?: string;
      since?: string;
      until?: string;
      changeType?: string;
      limit: string;
      output: string;
    }) => {
      if (!opts.db && !opts.terraform) {
        const defaultPath = resolve(process.cwd(), "terraform.tfstate");
        if (existsSync(defaultPath)) {
          opts.terraform = defaultPath;
        } else {
          ctx.logger.error("Provide --terraform <path> or --db <path> to access the graph.");
          process.exitCode = 1;
          return;
        }
      }

      let storage: GraphStorage;
      let engine: GraphEngine;

      if (opts.db && existsSync(resolve(opts.db))) {
        storage = new SQLiteGraphStorage(resolve(opts.db));
        await storage.initialize();
        engine = new GraphEngine({ storage });
      } else if (opts.terraform) {
        storage = new InMemoryGraphStorage();
        await storage.initialize();
        engine = new GraphEngine({ storage });
        const adapter = new TerraformDiscoveryAdapter({
          statePath: resolve(opts.terraform!),
        });
        engine.registerAdapter(adapter);
        await engine.sync();
      } else {
        ctx.logger.error("No data source available.");
        process.exitCode = 1;
        return;
      }

      const changes = await storage.getChanges({
        initiator: opts.initiator,
        initiatorType: opts.type as "human" | "agent" | "system" | undefined,
        since: opts.since,
        until: opts.until,
        changeType: opts.changeType as import("./types.js").GraphChangeType | undefined,
      });

      const limit = parseInt(opts.limit, 10);
      const limited = changes.slice(0, limit);

      if (opts.output === "json") {
        console.log(JSON.stringify(limited, null, 2));
      } else {
        if (limited.length === 0) {
          console.log("\n  No changes found matching the filters.\n");
        } else {
          const lines: string[] = [
            "",
            "═══ Infrastructure Audit Trail ═══",
            "",
            `  Showing ${limited.length}${changes.length > limit ? ` of ${changes.length}` : ""} changes`,
            "",
          ];

          for (const change of limited) {
            const initiatorStr = change.initiator
              ? ` by ${change.initiator} (${change.initiatorType ?? "unknown"})`
              : "";
            lines.push(`  [${change.detectedAt}] ${change.changeType}${initiatorStr}`);
            lines.push(`    Target: ${change.targetId}`);
            if (change.field) {
              lines.push(`    Field: ${change.field}`);
              if (change.previousValue) lines.push(`    Before: ${change.previousValue}`);
              if (change.newValue) lines.push(`    After: ${change.newValue}`);
            }
            if (change.correlationId) {
              lines.push(`    Correlation: ${change.correlationId}`);
            }
            lines.push("");
          }

          console.log(lines.join("\n"));
        }
      }

      await storage.close();
    });

  // ---------------------------------------------------------------------------
  // infra monitor
  // ---------------------------------------------------------------------------
  infra
    .command("monitor")
    .description("Start continuous infrastructure monitoring with alerts")
    .requiredOption("--db <path>", "Path to SQLite database")
    .option("--interval <preset>", "Sync interval: 5min, 15min, hourly, daily", "hourly")
    .option("--aws", "Enable AWS provider")
    .option("--azure", "Enable Azure provider")
    .option("--gcp", "Enable GCP provider")
    .option("--aws-region <region>", "AWS region", "us-east-1")
    .option("--aws-profile <profile>", "AWS CLI profile")
    .option("--azure-subscription <id>", "Azure subscription ID")
    .option("--gcp-project <id>", "GCP project ID")
    .option("--gcp-key-file <path>", "GCP service account key file")
    .option("--cloudtrail", "Enable AWS CloudTrail event source")
    .option("--activity-log", "Enable Azure Activity Log event source")
    .option("--audit-log", "Enable GCP Audit Log event source")
    .option("--webhook <url>", "Webhook URL for alert dispatch")
    .option("--no-builtin-alerts", "Disable built-in alert rules")
    .option("--once", "Run a single monitoring cycle and exit")
    .action(async (opts: {
      db: string;
      interval: string;
      aws?: boolean;
      azure?: boolean;
      gcp?: boolean;
      awsRegion: string;
      awsProfile?: string;
      azureSubscription?: string;
      gcpProject?: string;
      gcpKeyFile?: string;
      cloudtrail?: boolean;
      activityLog?: boolean;
      auditLog?: boolean;
      webhook?: string;
      builtinAlerts: boolean;
      once?: boolean;
    }) => {
      const storage = new SQLiteGraphStorage(resolve(opts.db));
      await storage.initialize();
      const engine = new GraphEngine({ storage });

      // Register provider adapters
      if (opts.aws) {
        engine.registerAdapter(new AwsDiscoveryAdapter({
          accountId: "self",
          regions: [opts.awsRegion],
          profile: opts.awsProfile,
        }));
      }
      if (opts.azure && opts.azureSubscription) {
        engine.registerAdapter(new AzureDiscoveryAdapter({
          subscriptionId: opts.azureSubscription,
        }));
      }
      if (opts.gcp && opts.gcpProject) {
        engine.registerAdapter(new GcpDiscoveryAdapter({
          projectId: opts.gcpProject,
          keyFilePath: opts.gcpKeyFile,
        }));
      }

      // Configure event sources
      const eventSources = [];
      if (opts.cloudtrail) {
        eventSources.push(new CloudTrailEventSource({
          region: opts.awsRegion,
          mutationsOnly: true,
        }));
      }
      if (opts.activityLog && opts.azureSubscription) {
        eventSources.push(new AzureActivityLogEventSource({
          subscriptionId: opts.azureSubscription,
        }));
      }
      if (opts.auditLog && opts.gcpProject) {
        eventSources.push(new GcpAuditLogEventSource({
          projectId: opts.gcpProject,
        }));
      }

      // Resolve interval
      const preset = opts.interval as SchedulePreset;
      const intervalMs = SCHEDULE_PRESETS[preset] ?? SCHEDULE_PRESETS.hourly;

      // Build alert destinations
      const alertDestinations: import("./monitoring.js").AlertDestination[] = [
        { type: "console" },
      ];
      if (opts.webhook) {
        alertDestinations.push({
          type: "webhook",
          url: opts.webhook,
        });
      }

      // Create monitor
      const monitor = new InfraMonitor({
        engine,
        storage,
        eventSources,
        config: {
          schedule: { intervalMs },
          alertRules: opts.builtinAlerts ? [...BUILTIN_ALERT_RULES] : [],
          alertDestinations,
        },
      });

      if (opts.once) {
        // Single cycle mode
        console.error("Running single monitoring cycle...\n");
        const result = await monitor.runSyncCycle();

        console.error(`  Sync completed in ${result.durationMs}ms`);
        for (const record of result.syncRecords) {
          console.error(`    ${record.provider}: ${record.nodesDiscovered} nodes, ${record.changesRecorded} changes (${record.status})`);
        }

        if (result.alerts.length > 0) {
          console.error(`\n  Alerts (${result.alerts.length}):`);
          for (const alert of result.alerts) {
            const severity = alert.severity === "critical" ? "CRITICAL" : "WARNING";
            console.error(`    [${severity}] ${alert.title}`);
            console.error(`      ${alert.message}`);
          }
        } else {
          console.error("\n  No alerts triggered.");
        }

        await storage.close();
      } else {
        // Continuous mode
        const intervalLabel = opts.interval in SCHEDULE_PRESETS ? opts.interval : "hourly";
        console.error(`Starting continuous monitoring (${intervalLabel} sync)...`);
        console.error("Press Ctrl+C to stop.\n");

        // Run initial cycle
        const initial = await monitor.runSyncCycle();
        console.error(`  Initial sync: ${initial.syncRecords.length} provider(s), ${initial.alerts.length} alert(s)\n`);

        await monitor.start();

        // Handle graceful shutdown
        const shutdown = () => {
          console.error("\nStopping monitor...");
          monitor.stop();
          void storage.close().then(() => process.exit(0));
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      }
    });

  // ---------------------------------------------------------------------------
  // infra timeline
  // ---------------------------------------------------------------------------
  infra
    .command("timeline")
    .description("View infrastructure change timeline and history")
    .option("--db <path>", "Path to SQLite database")
    .option("--terraform <path>", "Path to terraform.tfstate file")
    .option("--since <date>", "Start of time range (ISO 8601 or relative: 1h, 24h, 7d, 30d)")
    .option("--until <date>", "End of time range (ISO 8601)")
    .option("--node <id>", "Show timeline for a specific node")
    .option("--diff", "Show graph diff (created/deleted/modified)")
    .option("--cost-trend", "Show cost trend across syncs")
    .option("--limit <n>", "Maximum number of changes to show", "100")
    .option("-o, --output <format>", "Output format: terminal, json", "terminal")
    .action(async (opts: {
      db?: string;
      terraform?: string;
      since?: string;
      until?: string;
      node?: string;
      diff?: boolean;
      costTrend?: boolean;
      limit: string;
      output: string;
    }) => {
      if (!opts.db && !opts.terraform) {
        const defaultPath = resolve(process.cwd(), "terraform.tfstate");
        if (existsSync(defaultPath)) {
          opts.terraform = defaultPath;
        } else {
          ctx.logger.error("Provide --terraform <path> or --db <path> to access the graph.");
          process.exitCode = 1;
          return;
        }
      }

      let storage: GraphStorage;
      let engine: GraphEngine;

      if (opts.db && existsSync(resolve(opts.db))) {
        storage = new SQLiteGraphStorage(resolve(opts.db));
        await storage.initialize();
        engine = new GraphEngine({ storage });
      } else if (opts.terraform) {
        storage = new InMemoryGraphStorage();
        await storage.initialize();
        engine = new GraphEngine({ storage });
        const adapter = new TerraformDiscoveryAdapter({
          statePath: resolve(opts.terraform!),
        });
        engine.registerAdapter(adapter);
        await engine.sync();
      } else {
        ctx.logger.error("No data source available.");
        process.exitCode = 1;
        return;
      }

      // Resolve relative time strings
      const since = resolveRelativeTime(opts.since ?? "24h");

      if (opts.costTrend) {
        // Cost trend mode
        const trend = await getCostTrend(storage, parseInt(opts.limit, 10));
        if (opts.output === "json") {
          console.log(JSON.stringify(trend, null, 2));
        } else {
          console.log("\n═══ Cost Trend ═══\n");
          if (trend.length === 0) {
            console.log("  No sync records found.\n");
          } else {
            for (const point of trend) {
              console.log(`  [${point.timestamp}] ${point.provider}: ${point.nodesDiscovered} nodes, ${point.costChanges} cost changes`);
            }
            console.log("");
          }
        }
        await storage.close();
        return;
      }

      if (opts.node) {
        // Node-specific timeline
        const timeline = await engine.getTimeline(opts.node, parseInt(opts.limit, 10));
        if (opts.output === "json") {
          console.log(JSON.stringify(timeline, null, 2));
        } else {
          console.log(`\n═══ Timeline: ${opts.node} ═══\n`);
          if (timeline.length === 0) {
            console.log("  No changes recorded.\n");
          } else {
            for (const change of timeline) {
              const initiator = change.initiator ? ` by ${change.initiator}` : "";
              console.log(`  [${change.detectedAt}] ${change.changeType}${initiator}`);
              if (change.field) {
                console.log(`    ${change.field}: ${change.previousValue ?? "∅"} → ${change.newValue ?? "∅"}`);
              }
            }
            console.log("");
          }
        }
        await storage.close();
        return;
      }

      if (opts.diff) {
        // Graph diff mode
        const diff = await getGraphDiff(storage, since, opts.until);
        if (opts.output === "json") {
          console.log(JSON.stringify(diff, null, 2));
        } else {
          console.log(`\n═══ Graph Diff (${diff.since} → ${diff.until}) ═══\n`);
          if (diff.created.length > 0) {
            console.log(`  + Created (${diff.created.length}):`);
            for (const id of diff.created) {
              const node = await storage.getNode(id);
              console.log(`    ${node?.name ?? id} (${node?.provider ?? "?"}/${node?.resourceType ?? "?"})`);
            }
          }
          if (diff.deleted.length > 0) {
            console.log(`  - Deleted (${diff.deleted.length}):`);
            for (const id of diff.deleted) {
              console.log(`    ${id}`);
            }
          }
          const modifiedEntries = Object.entries(diff.modified);
          if (modifiedEntries.length > 0) {
            console.log(`  ~ Modified (${modifiedEntries.length}):`);
            for (const [id, changes] of modifiedEntries) {
              const node = await storage.getNode(id);
              console.log(`    ${node?.name ?? id}: ${changes.length} change(s)`);
              for (const c of changes.slice(0, 3)) {
                if (c.field) {
                  console.log(`      ${c.field}: ${c.previousValue ?? "∅"} → ${c.newValue ?? "∅"}`);
                }
              }
            }
          }
          if (diff.created.length === 0 && diff.deleted.length === 0 && modifiedEntries.length === 0) {
            console.log("  No changes in this time range.");
          }
          console.log("");
        }
        await storage.close();
        return;
      }

      // Default: timeline summary
      const summary = await getTimelineSummary(storage, since, opts.until);
      if (opts.output === "json") {
        console.log(JSON.stringify({
          ...summary,
          changes: summary.changes.slice(0, parseInt(opts.limit, 10)),
        }, null, 2));
      } else {
        console.log(`\n═══ Timeline Summary (${summary.since} → ${summary.until}) ═══\n`);
        console.log(`  Total changes: ${summary.totalChanges}`);
        console.log(`  Affected resources: ${summary.affectedResourceCount}`);

        if (Object.keys(summary.byType).length > 0) {
          console.log("\n  By type:");
          for (const [type, count] of Object.entries(summary.byType)) {
            console.log(`    ${type}: ${count}`);
          }
        }
        if (Object.keys(summary.byInitiator).length > 0) {
          console.log("\n  By initiator:");
          for (const [initiator, count] of Object.entries(summary.byInitiator)) {
            console.log(`    ${initiator}: ${count}`);
          }
        }

        // Show recent changes (limited)
        const limit = Math.min(parseInt(opts.limit, 10), summary.changes.length);
        if (limit > 0) {
          console.log(`\n  Recent changes (${limit} of ${summary.totalChanges}):`);
          for (const change of summary.changes.slice(0, limit)) {
            const initiator = change.initiator ? ` by ${change.initiator}` : "";
            console.log(`    [${change.detectedAt}] ${change.changeType}${initiator} — ${change.targetId}`);
          }
        }
        console.log("");
      }

      await storage.close();
    });

  // ===========================================================================
  // espada infra snapshot — Temporal knowledge graph operations
  // ===========================================================================

  infra
    .command("snapshot")
    .description("Manage infrastructure graph snapshots for time-travel queries")
    .option("--db <path>", "Path to SQLite database", "infra-graph.db")
    .option("--action <action>", "Action: create, list, diff, history, evolution", "list")
    .option("--label <label>", "Label for new snapshot (with --action create)")
    .option("--node <id>", "Node ID for history (with --action history)")
    .option("--from <ts>", "Start timestamp for diff (ISO 8601 or snapshot ID)")
    .option("--to <ts>", "End timestamp for diff (ISO 8601 or snapshot ID)")
    .option("--since <date>", "Start of period (ISO 8601 or relative: 1h, 24h, 7d)")
    .option("--until <date>", "End of period (ISO 8601)")
    .option("--limit <n>", "Max results", "20")
    .option("-o, --output <format>", "Output format: terminal, json", "terminal")
    .action(async (opts: {
      db: string;
      action: string;
      label?: string;
      node?: string;
      from?: string;
      to?: string;
      since?: string;
      until?: string;
      limit: string;
      output: string;
    }) => {
      const dbPath = resolve(opts.db);
      if (!existsSync(dbPath) && opts.action !== "create") {
        ctx.logger.error(`Database not found: ${dbPath}. Run 'espada infra scan' or 'cloud-scan' first.`);
        process.exitCode = 1;
        return;
      }

      const storage = new SQLiteGraphStorage(dbPath);
      await storage.initialize();
      const temporal = new InMemoryTemporalStorage(storage);
      await temporal.initializeTemporal();

      const limit = parseInt(opts.limit, 10);

      try {
        switch (opts.action) {
          // ── create ──
          case "create": {
            const snapshot = await takeSnapshot(temporal, "manual", opts.label);
            if (opts.output === "json") {
              console.log(JSON.stringify(snapshot, null, 2));
            } else {
              console.log("\n═══ Snapshot Created ═══\n");
              console.log(`  ID:    ${snapshot.id}`);
              console.log(`  Time:  ${snapshot.createdAt}`);
              console.log(`  Label: ${snapshot.label ?? "(none)"}`);
              console.log(`  Nodes: ${snapshot.nodeCount}`);
              console.log(`  Edges: ${snapshot.edgeCount}`);
              console.log(`  Cost:  $${snapshot.totalCostMonthly.toFixed(2)}/mo`);
              console.log("");
            }
            break;
          }

          // ── list ──
          case "list": {
            const snapshots = await temporal.listSnapshots({
              since: opts.since ? resolveRelativeTime(opts.since) : undefined,
              until: opts.until,
              limit,
            });
            if (opts.output === "json") {
              console.log(JSON.stringify(snapshots, null, 2));
            } else {
              console.log("\n═══ Snapshots ═══\n");
              if (snapshots.length === 0) {
                console.log("  No snapshots found.\n");
              } else {
                for (const s of snapshots) {
                  console.log(`  [${s.createdAt}] ${s.id} (${s.trigger}) — ${s.nodeCount} nodes, ${s.edgeCount} edges, $${s.totalCostMonthly.toFixed(2)}/mo${s.label ? ` "${s.label}"` : ""}`);
                }
                console.log("");
              }
            }
            break;
          }

          // ── diff ──
          case "diff": {
            if (!opts.from || !opts.to) {
              ctx.logger.error("--from and --to are required for diff action.");
              process.exitCode = 1;
              return;
            }

            const from = opts.from.startsWith("snap-") ? opts.from : resolveRelativeTime(opts.from);
            const to = opts.to.startsWith("snap-") ? opts.to : resolveRelativeTime(opts.to);

            const diff = await diffTimestamps(temporal, from, to);
            if (!diff) {
              ctx.logger.error("Could not find snapshots for the specified range.");
              process.exitCode = 1;
              return;
            }

            if (opts.output === "json") {
              console.log(JSON.stringify(diff, null, 2));
            } else {
              console.log(`\n═══ Snapshot Diff ═══\n`);
              console.log(`  From: ${diff.fromSnapshot.createdAt} (${diff.fromSnapshot.id})`);
              console.log(`  To:   ${diff.toSnapshot.createdAt} (${diff.toSnapshot.id})`);
              console.log(`  Cost delta: ${diff.costDelta >= 0 ? "+" : ""}$${diff.costDelta.toFixed(2)}/mo`);

              if (diff.addedNodes.length > 0) {
                console.log(`\n  + Added (${diff.addedNodes.length}):`);
                for (const n of diff.addedNodes.slice(0, limit)) {
                  console.log(`    ${n.name} (${n.provider}/${n.resourceType})`);
                }
              }
              if (diff.removedNodes.length > 0) {
                console.log(`\n  - Removed (${diff.removedNodes.length}):`);
                for (const n of diff.removedNodes.slice(0, limit)) {
                  console.log(`    ${n.name} (${n.provider}/${n.resourceType})`);
                }
              }
              if (diff.changedNodes.length > 0) {
                console.log(`\n  ~ Changed (${diff.changedNodes.length}):`);
                for (const c of diff.changedNodes.slice(0, limit)) {
                  console.log(`    ${c.before.name}: ${c.changedFields.join(", ")}`);
                }
              }
              console.log("");
            }
            break;
          }

          // ── history ──
          case "history": {
            if (!opts.node) {
              ctx.logger.error("--node <id> is required for history action.");
              process.exitCode = 1;
              return;
            }

            const history = await getNodeHistory(temporal, opts.node, limit);
            if (opts.output === "json") {
              console.log(JSON.stringify(history, null, 2));
            } else {
              console.log(`\n═══ Node History: ${opts.node} ═══\n`);
              if (history.length === 0) {
                console.log("  No history found.\n");
              } else {
                for (const entry of history) {
                  console.log(`  [${entry.snapshotCreatedAt}] status=${entry.node.status}, cost=$${entry.node.costMonthly?.toFixed(2) ?? "—"}/mo`);
                }
                console.log("");
              }
            }
            break;
          }

          // ── evolution ──
          case "evolution": {
            const summary = await getEvolutionSummary(
              temporal,
              opts.since ? resolveRelativeTime(opts.since) : undefined,
              opts.until,
            );
            if (opts.output === "json") {
              console.log(JSON.stringify(summary, null, 2));
            } else {
              console.log("\n═══ Infrastructure Evolution ═══\n");
              console.log(`  Snapshots: ${summary.snapshots.length}`);
              console.log(`  Net nodes added: ${summary.netChange.nodesAdded}`);
              console.log(`  Net nodes removed: ${summary.netChange.nodesRemoved}`);
              console.log(`  Cost delta: ${summary.netChange.costDelta >= 0 ? "+" : ""}$${summary.netChange.costDelta.toFixed(2)}/mo`);

              if (summary.nodeCountTrend.length > 0) {
                console.log("\n  Node count trend:");
                for (const p of summary.nodeCountTrend) {
                  console.log(`    ${p.timestamp.slice(0, 16)}: ${p.count} nodes`);
                }
              }
              if (summary.costTrend.length > 0) {
                console.log("\n  Cost trend:");
                for (const p of summary.costTrend) {
                  console.log(`    ${p.timestamp.slice(0, 16)}: $${p.cost.toFixed(2)}/mo`);
                }
              }
              console.log("");
            }
            break;
          }

          default:
            ctx.logger.error(`Unknown action: ${opts.action}. Use: create, list, diff, history, evolution`);
            process.exitCode = 1;
        }
      } finally {
        await storage.close();
      }
    });

  // ---------------------------------------------------------------------------
  // espada infra query — IQL interactive query
  // ---------------------------------------------------------------------------
  infra
    .command("query")
    .description("Execute an Infrastructure Query Language (IQL) query against the knowledge graph")
    .argument("<iql...>", "IQL query (e.g. FIND resources WHERE provider = 'aws')")
    .option("--db <path>", "SQLite database path", "infra-graph.db")
    .option("--output <format>", "Output format (json, terminal)", "terminal")
    .option("--limit <n>", "Max results (overrides LIMIT in query)", (v: string) => parseInt(v, 10))
    .action(async (iqlParts: string[], opts: { db: string; output: string; limit?: number }) => {
      const dbPath = resolve(opts.db);
      const iqlQuery = iqlParts.join(" ");

      if (!existsSync(dbPath)) {
        ctx.logger.error(`Database not found: ${dbPath}. Run 'espada infra scan' first.`);
        process.exitCode = 1;
        return;
      }

      const storage = new SQLiteGraphStorage(dbPath);
      try {
        await storage.initialize();

        // Parse and execute the IQL query
        const ast = parseIQL(iqlQuery);
        const result = await executeQuery(ast, {
          storage,
          defaultLimit: opts.limit ?? 200,
          maxTraversalDepth: 8,
        });

        if (opts.output === "json") {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Terminal output
        if (result.type === "find") {
          console.log(`\n  Found ${result.totalCount} resources (total cost: $${result.totalCost.toFixed(2)}/mo)\n`);
          if (result.nodes.length === 0) {
            console.log("  No matching resources.");
          } else {
            // Simple table output
            const maxName = Math.min(
              30,
              Math.max(4, ...result.nodes.map((n) => n.name.length)),
            );
            console.log(
              `  ${"Name".padEnd(maxName)}  ${"Provider".padEnd(10)}  ${"Type".padEnd(16)}  ${"Region".padEnd(14)}  ${"Status".padEnd(10)}  Cost/mo`,
            );
            console.log(`  ${"─".repeat(maxName)}  ${"─".repeat(10)}  ${"─".repeat(16)}  ${"─".repeat(14)}  ${"─".repeat(10)}  ${"─".repeat(10)}`);
            for (const n of result.nodes) {
              const cost = n.costMonthly != null ? `$${n.costMonthly.toFixed(2)}` : "—";
              console.log(
                `  ${n.name.slice(0, maxName).padEnd(maxName)}  ${n.provider.padEnd(10)}  ${n.resourceType.padEnd(16)}  ${n.region.padEnd(14)}  ${n.status.padEnd(10)}  ${cost}`,
              );
            }
          }
        } else if (result.type === "summarize") {
          console.log(`\n  Summary (total: ${result.total})\n`);
          if (result.groups.length > 0) {
            const keys = Object.keys(result.groups[0].key);
            const header = keys.map((k) => k.padEnd(16)).join("  ") + "  Value";
            console.log(`  ${header}`);
            console.log(`  ${keys.map(() => "─".repeat(16)).join("  ")}  ${"─".repeat(12)}`);
            for (const g of result.groups) {
              const vals = keys.map((k) => (g.key[k] ?? "—").padEnd(16)).join("  ");
              console.log(`  ${vals}  ${g.value.toFixed(2)}`);
            }
          }
        } else if (result.type === "path") {
          if (result.found) {
            console.log(`\n  Path found (${result.hops} hops):\n`);
            for (let i = 0; i < result.path.length; i++) {
              const n = result.path[i];
              console.log(`  ${i + 1}. ${n.name} (${n.resourceType})`);
              if (i < result.edges.length) {
                console.log(`     └─ ${result.edges[i].relationshipType} ─→`);
              }
            }
          } else {
            console.log("\n  No path found between the given resources.\n");
          }
        } else if (result.type === "diff") {
          console.log(`\n  Infrastructure Diff: ${result.fromTimestamp} → ${result.toTimestamp}\n`);
          console.log(`  Added: ${result.added}  Removed: ${result.removed}  Changed: ${result.changed}`);
          console.log(`  Cost delta: $${result.costDelta.toFixed(2)}/mo\n`);
          if (result.details.length > 0) {
            for (const d of result.details.slice(0, 50)) {
              const fields = d.changedFields ? ` (${d.changedFields.join(", ")})` : "";
              console.log(`  • ${d.change.toUpperCase()} ${d.name}${fields}`);
            }
          }
        }

        console.log("");
      } catch (err) {
        if (err instanceof IQLSyntaxError) {
          ctx.logger.error(`IQL syntax error: ${err.message}`);
        } else {
          ctx.logger.error(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      } finally {
        await storage.close();
      }
    });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve a relative time string (e.g. "1h", "24h", "7d", "30d") to an ISO 8601 timestamp.
 * If the input is already an ISO 8601 string, returns it unchanged.
 */
function resolveRelativeTime(input: string): string {
  const match = input.match(/^(\d+)(m|h|d|w)$/);
  if (!match) return input; // Already ISO 8601

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const msPerUnit: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() - value * msPerUnit[unit]).toISOString();
}
