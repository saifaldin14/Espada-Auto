/**
 * Azure Core Services Extension — Espada Plugin Entry Point
 *
 * Registers Azure services with the Espada ecosystem, providing CLI commands,
 * gateway methods, and agent tools for Azure infrastructure management.
 */

import type { EspadaPluginApi, EspadaPluginCliContext } from "espada/plugin-sdk";
import { formatErrorMessage } from "./src/retry.js";
import { enableAzureDiagnostics } from "./src/diagnostics.js";

// Managers — imported for types, instantiated in service start()
import { createCredentialsManager, type AzureCredentialsManager } from "./src/credentials/index.js";
import { createCLIWrapper, type AzureCLIWrapper } from "./src/cli/index.js";
import { AzureContextManager } from "./src/context/index.js";
import { AzureServiceDiscovery } from "./src/discovery/index.js";
import { AzureTaggingManager } from "./src/tagging/index.js";
import { AzureActivityLogManager } from "./src/activitylog/index.js";
import { AzureVMManager } from "./src/vms/index.js";
import { AzureFunctionsManager } from "./src/functions/index.js";
import { AzureContainerManager } from "./src/containers/index.js";
import { AzureStorageManager } from "./src/storage/index.js";
import { AzureSQLManager } from "./src/sql/index.js";
import { AzureCosmosDBManager } from "./src/cosmosdb/index.js";
import { AzureNetworkManager } from "./src/network/index.js";
import { AzureKeyVaultManager } from "./src/keyvault/index.js";
import { AzureMonitorManager } from "./src/monitor/index.js";
import { AzureIAMManager } from "./src/iam/index.js";
import { AzureCostManager } from "./src/cost/index.js";
import { AzureServiceBusManager } from "./src/servicebus/index.js";
import { AzureEventGridManager } from "./src/eventgrid/index.js";
import { AzureDNSManager } from "./src/dns/index.js";
import { AzureRedisManager } from "./src/redis/index.js";
import { AzureCDNManager } from "./src/cdn/index.js";
import { AzureSecurityManager } from "./src/security/index.js";
import { AzurePolicyManager } from "./src/policy/index.js";
import { AzureBackupManager } from "./src/backup/index.js";
import { AzureAIManager } from "./src/ai/index.js";
import { AzureDevOpsManager, DevOpsPATManager, createPATManager } from "./src/devops/index.js";
import { AzureAPIManagementManager } from "./src/apimanagement/index.js";
import { AzureLogicAppsManager } from "./src/logic/index.js";
import { AzureResourceManager } from "./src/resources/index.js";
import { AzureSubscriptionManager } from "./src/subscriptions/index.js";
import { AzureGuardrailsManager, createGuardrailsManager } from "./src/guardrails/index.js";
import { AzureComplianceManager } from "./src/compliance/index.js";
import { AzureAutomationManager } from "./src/automation/index.js";

// Orchestration (IDIO)
import { Orchestrator, registerBuiltinSteps, clearStepRegistry, listBlueprints, getBlueprint, validatePlan } from "./src/orchestration/index.js";
import type { OrchestrationOptions } from "./src/orchestration/index.js";

// Advisor (project analysis + recommendation engine)
import { analyzeProject, recommend, recommendAndPlan } from "./src/advisor/index.js";

import type { AzurePluginConfig } from "./src/types.js";

// Theme helper for CLI output
const theme = {
  error: (s: string) => `\x1b[31m${s}\x1b[0m`,
  success: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  info: (s: string) => `\x1b[34m${s}\x1b[0m`,
  muted: (s: string) => `\x1b[90m${s}\x1b[0m`,
} as const;

// Store plugin logger
let pluginLogger: EspadaPluginApi["logger"] | null = null;

// Manager instances — initialized in service start(), nulled in stop()
let credentialsManager: AzureCredentialsManager | null = null;
let cliWrapper: AzureCLIWrapper | null = null;
let contextManager: AzureContextManager | null = null;
let serviceDiscovery: AzureServiceDiscovery | null = null;
let taggingManager: AzureTaggingManager | null = null;
let activityLogManager: AzureActivityLogManager | null = null;
let vmManager: AzureVMManager | null = null;
let functionsManager: AzureFunctionsManager | null = null;
let containerManager: AzureContainerManager | null = null;
let storageManager: AzureStorageManager | null = null;
let sqlManager: AzureSQLManager | null = null;
let cosmosDBManager: AzureCosmosDBManager | null = null;
let networkManager: AzureNetworkManager | null = null;
let keyVaultManager: AzureKeyVaultManager | null = null;
let monitorManager: AzureMonitorManager | null = null;
let iamManager: AzureIAMManager | null = null;
let costManager: AzureCostManager | null = null;
let serviceBusManager: AzureServiceBusManager | null = null;
let eventGridManager: AzureEventGridManager | null = null;
let dnsManager: AzureDNSManager | null = null;
let redisManager: AzureRedisManager | null = null;
let cdnManager: AzureCDNManager | null = null;
let securityManager: AzureSecurityManager | null = null;
let policyManager: AzurePolicyManager | null = null;
let backupManager: AzureBackupManager | null = null;
let aiManager: AzureAIManager | null = null;
let devOpsManager: AzureDevOpsManager | null = null;
let patManager: DevOpsPATManager | null = null;
let apimManager: AzureAPIManagementManager | null = null;
let logicManager: AzureLogicAppsManager | null = null;
let resourceManager: AzureResourceManager | null = null;
let subscriptionManager: AzureSubscriptionManager | null = null;
let guardrailsManager: AzureGuardrailsManager | null = null;
let complianceManager: AzureComplianceManager | null = null;
let automationManager: AzureAutomationManager | null = null;
let orchestrator: Orchestrator | null = null;

// Config schema using TypeBox
import { Type, type Static } from "@sinclair/typebox";

const configSchema = Type.Object({
  defaultSubscription: Type.Optional(Type.String({ description: "Default Azure subscription ID" })),
  defaultRegion: Type.Optional(Type.String({ description: "Default Azure region (e.g. eastus)" })),
  defaultTenantId: Type.Optional(Type.String({ description: "Default Azure AD tenant ID" })),
  credentialMethod: Type.Optional(
    Type.String({
      description: "Credential method: default | cli | service-principal | managed-identity | interactive",
    })
  ),
  devOpsOrganization: Type.Optional(Type.String({ description: "Azure DevOps organization name" })),
  tagConfig: Type.Optional(
    Type.Object({
      requiredTags: Type.Optional(Type.Array(Type.String())),
      optionalTags: Type.Optional(Type.Array(Type.String())),
    })
  ),
  defaultTags: Type.Optional(
    Type.Array(Type.Object({ key: Type.String(), value: Type.String() }))
  ),
  retryConfig: Type.Optional(
    Type.Object({
      maxAttempts: Type.Optional(Type.Number()),
      minDelayMs: Type.Optional(Type.Number()),
      maxDelayMs: Type.Optional(Type.Number()),
    })
  ),
  diagnostics: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      verbose: Type.Optional(Type.Boolean()),
    })
  ),
});

type AzureExtensionConfig = Static<typeof configSchema>;

function getDefaultConfig(): AzureExtensionConfig {
  return {
    defaultRegion: "eastus",
    credentialMethod: "default",
    retryConfig: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 30000 },
    diagnostics: { enabled: false, verbose: false },
  };
}

/**
 * Azure plugin definition
 */
const plugin = {
  id: "azure",
  name: "Azure Core Services",
  description: "Comprehensive Azure infrastructure management with VMs, Storage, KeyVault, and more",
  version: "1.0.0",
  configSchema,

  register(api: EspadaPluginApi) {
    api.logger.info("Registering Azure extension");
    pluginLogger = api.logger;

    const config = (api.pluginConfig as AzureExtensionConfig) ?? getDefaultConfig();

    if (config.diagnostics?.enabled) {
      enableAzureDiagnostics();
      api.logger.info("Azure diagnostics enabled");
    }

    // =========================================================================
    // CLI Commands
    // =========================================================================
    api.registerCli((ctx: EspadaPluginCliContext) => {
      const az = ctx.program.command("azure").description("Azure infrastructure management");

      // --- VM commands ---
      const vmCmd = az.command("vm").description("Virtual Machine management");

      vmCmd
        .command("list")
        .description("List virtual machines")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            const vms = await vmManager.listVMs(options.resourceGroup ? { resourceGroup: options.resourceGroup } : undefined);
            if (vms.length === 0) { console.log("No VMs found"); return; }
            console.log("\nVirtual Machines:\n");
            for (const vm of vms) {
              console.log(`  ${vm.id}`);
              console.log(`    Name: ${vm.name}`);
              console.log(`    Size: ${vm.vmSize}`);
              console.log(`    State: ${vm.powerState}`);
              console.log(`    Location: ${vm.location}`);
              console.log();
            }
          } catch (error) {
            console.error(theme.error(`Failed to list VMs: ${formatErrorMessage(error)}`));
          }
        });

      vmCmd
        .command("start <resourceGroup> <vmName>")
        .description("Start a virtual machine")
        .action(async (resourceGroup: string, vmName: string) => {
          if (!vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            await vmManager.startVM(resourceGroup, vmName);
            console.log(theme.success(`Started VM: ${vmName}`));
          } catch (error) {
            console.error(theme.error(`Failed to start VM: ${formatErrorMessage(error)}`));
          }
        });

      vmCmd
        .command("stop <resourceGroup> <vmName>")
        .description("Stop a virtual machine")
        .action(async (resourceGroup: string, vmName: string) => {
          if (!vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            await vmManager.stopVM(resourceGroup, vmName);
            console.log(theme.success(`Stopped VM: ${vmName}`));
          } catch (error) {
            console.error(theme.error(`Failed to stop VM: ${formatErrorMessage(error)}`));
          }
        });

      vmCmd
        .command("restart <resourceGroup> <vmName>")
        .description("Restart a virtual machine")
        .action(async (resourceGroup: string, vmName: string) => {
          if (!vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            await vmManager.restartVM(resourceGroup, vmName);
            console.log(theme.success(`Restarted VM: ${vmName}`));
          } catch (error) {
            console.error(theme.error(`Failed to restart VM: ${formatErrorMessage(error)}`));
          }
        });

      // --- Storage commands ---
      const storageCmd = az.command("storage").description("Storage account management");

      storageCmd
        .command("list")
        .description("List storage accounts")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!storageManager) { console.error(theme.error("Storage manager not initialized")); return; }
          try {
            const accounts = await storageManager.listStorageAccounts(options.resourceGroup);
            if (accounts.length === 0) { console.log("No storage accounts found"); return; }
            console.log("\nStorage Accounts:\n");
            for (const sa of accounts) {
              console.log(`  ${sa.name}`);
              console.log(`    Kind: ${sa.kind}`);
              console.log(`    SKU: ${sa.sku}`);
              console.log(`    Location: ${sa.location}`);
              console.log();
            }
          } catch (error) {
            console.error(theme.error(`Failed to list storage accounts: ${formatErrorMessage(error)}`));
          }
        });

      storageCmd
        .command("containers <resourceGroup> <accountName>")
        .description("List containers in a storage account")
        .action(async (resourceGroup: string, accountName: string) => {
          if (!storageManager) { console.error(theme.error("Storage manager not initialized")); return; }
          try {
            const containers = await storageManager.listContainers(resourceGroup, accountName);
            if (containers.length === 0) { console.log("No containers found"); return; }
            console.log(`\nContainers in ${accountName}:\n`);
            for (const c of containers) {
              console.log(`  ${c.name}  ${theme.muted(c.publicAccess ?? "none")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list blobs: ${formatErrorMessage(error)}`));
          }
        });

      // --- Resource Group commands ---
      const rgCmd = az.command("rg").description("Resource group management");

      rgCmd
        .command("list")
        .description("List resource groups")
        .action(async () => {
          if (!resourceManager) { console.error(theme.error("Resource manager not initialized")); return; }
          try {
            const groups = await resourceManager.listResourceGroups();
            if (groups.length === 0) { console.log("No resource groups found"); return; }
            console.log("\nResource Groups:\n");
            for (const rg of groups) {
              console.log(`  ${rg.name}  ${theme.muted(rg.location)}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list resource groups: ${formatErrorMessage(error)}`));
          }
        });

      // --- Functions commands ---
      const funcCmd = az.command("functions").description("Azure Functions management");

      funcCmd
        .command("list")
        .description("List function apps")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!functionsManager) { console.error(theme.error("Functions manager not initialized")); return; }
          try {
            const apps = await functionsManager.listFunctionApps(options.resourceGroup);
            if (apps.length === 0) { console.log("No function apps found"); return; }
            console.log("\nFunction Apps:\n");
            for (const app of apps) {
              console.log(`  ${app.name}  ${theme.muted(app.state ?? "")}  ${app.defaultHostName ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list function apps: ${formatErrorMessage(error)}`));
          }
        });

      // --- AKS / Containers commands ---
      const aksCmd = az.command("aks").description("Azure Kubernetes Service management");

      aksCmd
        .command("list")
        .description("List AKS clusters")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!containerManager) { console.error(theme.error("Container manager not initialized")); return; }
          try {
            const clusters = await containerManager.listAKSClusters(options.resourceGroup);
            if (clusters.length === 0) { console.log("No AKS clusters found"); return; }
            console.log("\nAKS Clusters:\n");
            for (const c of clusters) {
              console.log(`  ${c.name}  ${theme.muted(c.kubernetesVersion ?? "")}  ${c.powerState ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list AKS clusters: ${formatErrorMessage(error)}`));
          }
        });

      // --- KeyVault commands ---
      const kvCmd = az.command("keyvault").description("Key Vault management");

      kvCmd
        .command("list")
        .description("List Key Vaults")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!keyVaultManager) { console.error(theme.error("KeyVault manager not initialized")); return; }
          try {
            const vaults = await keyVaultManager.listVaults(options.resourceGroup);
            if (vaults.length === 0) { console.log("No key vaults found"); return; }
            console.log("\nKey Vaults:\n");
            for (const v of vaults) {
              console.log(`  ${v.name}  ${theme.muted(v.location ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list key vaults: ${formatErrorMessage(error)}`));
          }
        });

      // --- SQL commands ---
      const sqlCmd = az.command("sql").description("Azure SQL management");

      sqlCmd
        .command("list")
        .description("List SQL servers")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!sqlManager) { console.error(theme.error("SQL manager not initialized")); return; }
          try {
            const servers = await sqlManager.listServers(options.resourceGroup);
            if (servers.length === 0) { console.log("No SQL servers found"); return; }
            console.log("\nSQL Servers:\n");
            for (const s of servers) {
              console.log(`  ${s.name}  ${theme.muted(s.fullyQualifiedDomainName ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list SQL servers: ${formatErrorMessage(error)}`));
          }
        });

      // --- Cost commands ---
      const costCmd = az.command("cost").description("Cost management");

      costCmd
        .command("query")
        .description("Query current costs")
        .option("--timeframe <tf>", "Timeframe: MonthToDate, BillingMonthToDate, etc.", "MonthToDate")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { timeframe?: string };
          if (!costManager) { console.error(theme.error("Cost manager not initialized")); return; }
          try {
            const result = await costManager.queryCosts({ timeframe: options.timeframe });
            console.log("\nCost Query Results:\n");
            if (result.columns.length > 0) {
              console.log(`  Columns: ${result.columns.map((c) => c.name).join(", ")}`);
            }
            console.log(`  Rows: ${result.rows.length}`);
            for (const row of result.rows.slice(0, 10)) {
              console.log(`    ${row.join(" | ")}`);
            }
            if (result.rows.length > 10) {
              console.log(theme.muted(`  ... and ${result.rows.length - 10} more rows`));
            }
          } catch (error) {
            console.error(theme.error(`Failed to query costs: ${formatErrorMessage(error)}`));
          }
        });

      // --- Subscription commands ---
      const subCmd = az.command("subscription").description("Subscription management");

      subCmd
        .command("list")
        .description("List subscriptions")
        .action(async () => {
          if (!subscriptionManager) { console.error(theme.error("Subscription manager not initialized")); return; }
          try {
            const subs = await subscriptionManager.listSubscriptions();
            if (subs.length === 0) { console.log("No subscriptions found"); return; }
            console.log("\nSubscriptions:\n");
            for (const s of subs) {
              console.log(`  ${s.displayName} (${s.subscriptionId})  ${theme.muted(s.state)}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list subscriptions: ${formatErrorMessage(error)}`));
          }
        });

      // --- Status / Auth commands ---
      az.command("status")
        .description("Show Azure connection status")
        .action(async () => {
          if (!credentialsManager) { console.error(theme.error("Not initialized")); return; }
          try {
            const result = await credentialsManager.getCredential();
            console.log("\nAzure Status:\n");
            console.log(`  Authenticated: ${theme.success("yes")}`);
            console.log(`  Subscription: ${result.subscriptionId ?? config.defaultSubscription ?? theme.muted("not set")}`);
            console.log(`  Tenant: ${result.tenantId ?? config.defaultTenantId ?? theme.muted("not set")}`);
            console.log(`  Method: ${result.method ?? theme.muted("default")}`);
          } catch (error) {
            console.error(theme.error(`Failed to get status: ${formatErrorMessage(error)}`));
          }
        });

      // --- DNS commands ---
      const dnsCmd = az.command("dns").description("Azure DNS management");

      dnsCmd
        .command("zones")
        .description("List DNS zones")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!dnsManager) { console.error(theme.error("DNS manager not initialized")); return; }
          try {
            const zones = await dnsManager.listZones(options.resourceGroup);
            if (zones.length === 0) { console.log("No DNS zones found"); return; }
            console.log("\nDNS Zones:\n");
            for (const z of zones) {
              console.log(`  ${z.name}  ${theme.muted(z.zoneType ?? "")}  records: ${z.numberOfRecordSets ?? 0}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list DNS zones: ${formatErrorMessage(error)}`));
          }
        });

      dnsCmd
        .command("records <resourceGroup> <zoneName>")
        .description("List record sets in a DNS zone")
        .action(async (resourceGroup: string, zoneName: string) => {
          if (!dnsManager) { console.error(theme.error("DNS manager not initialized")); return; }
          try {
            const records = await dnsManager.listRecordSets(resourceGroup, zoneName);
            if (records.length === 0) { console.log("No records found"); return; }
            console.log(`\nRecords in ${zoneName}:\n`);
            for (const r of records) {
              console.log(`  ${r.name}  ${theme.info(r.type)}  TTL: ${r.ttl ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list DNS records: ${formatErrorMessage(error)}`));
          }
        });

      // --- Redis commands ---
      const redisCmd = az.command("redis").description("Azure Cache for Redis management");

      redisCmd
        .command("list")
        .description("List Redis caches")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!redisManager) { console.error(theme.error("Redis manager not initialized")); return; }
          try {
            const caches = await redisManager.listCaches(options.resourceGroup);
            if (caches.length === 0) { console.log("No Redis caches found"); return; }
            console.log("\nRedis Caches:\n");
            for (const c of caches) {
              console.log(`  ${c.name}  ${theme.muted(c.sku?.name ?? "")}  ${c.hostName ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Redis caches: ${formatErrorMessage(error)}`));
          }
        });

      redisCmd
        .command("info <resourceGroup> <cacheName>")
        .description("Get details of a Redis cache")
        .action(async (resourceGroup: string, cacheName: string) => {
          if (!redisManager) { console.error(theme.error("Redis manager not initialized")); return; }
          try {
            const cache = await redisManager.getCache(resourceGroup, cacheName);
            console.log(`\nRedis Cache: ${cache.name}\n`);
            console.log(`  Host: ${cache.hostName ?? ""}`);
            console.log(`  Port: ${cache.sslPort ?? cache.port ?? ""}`);
            console.log(`  SKU: ${cache.sku ?? ""}`);
            console.log(`  Version: ${cache.redisVersion ?? ""}`);
            console.log(`  Location: ${cache.location ?? ""}`);
          } catch (error) {
            console.error(theme.error(`Failed to get Redis cache: ${formatErrorMessage(error)}`));
          }
        });

      // --- CDN commands ---
      const cdnCmd = az.command("cdn").description("Azure CDN management");

      cdnCmd
        .command("profiles")
        .description("List CDN profiles")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!cdnManager) { console.error(theme.error("CDN manager not initialized")); return; }
          try {
            const profiles = await cdnManager.listProfiles(options.resourceGroup);
            if (profiles.length === 0) { console.log("No CDN profiles found"); return; }
            console.log("\nCDN Profiles:\n");
            for (const p of profiles) {
              console.log(`  ${p.name}  ${theme.muted(p.sku ?? "")}  ${p.resourceState ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list CDN profiles: ${formatErrorMessage(error)}`));
          }
        });

      cdnCmd
        .command("endpoints <resourceGroup> <profileName>")
        .description("List endpoints in a CDN profile")
        .action(async (resourceGroup: string, profileName: string) => {
          if (!cdnManager) { console.error(theme.error("CDN manager not initialized")); return; }
          try {
            const endpoints = await cdnManager.listEndpoints(resourceGroup, profileName);
            if (endpoints.length === 0) { console.log("No endpoints found"); return; }
            console.log(`\nEndpoints in ${profileName}:\n`);
            for (const e of endpoints) {
              console.log(`  ${e.name}  ${theme.info(e.hostName ?? "")}  ${e.resourceState ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list CDN endpoints: ${formatErrorMessage(error)}`));
          }
        });

      // --- Network commands ---
      const netCmd = az.command("network").description("Azure networking management");

      netCmd
        .command("vnet list")
        .description("List virtual networks")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const vnets = await networkManager.listVNets(options.resourceGroup);
            if (vnets.length === 0) { console.log("No virtual networks found"); return; }
            console.log("\nVirtual Networks:\n");
            for (const v of vnets) {
              console.log(`  ${v.name}  ${theme.muted(v.location ?? "")}  ${v.addressSpace?.join(", ") ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list VNets: ${formatErrorMessage(error)}`));
          }
        });

      netCmd
        .command("nsg list")
        .description("List network security groups")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const nsgs = await networkManager.listNSGs(options.resourceGroup);
            if (nsgs.length === 0) { console.log("No NSGs found"); return; }
            console.log("\nNetwork Security Groups:\n");
            for (const n of nsgs) {
              console.log(`  ${n.name}  ${theme.muted(n.location ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list NSGs: ${formatErrorMessage(error)}`));
          }
        });

      netCmd
        .command("lb list")
        .description("List load balancers")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const lbs = await networkManager.listLoadBalancers(options.resourceGroup);
            if (lbs.length === 0) { console.log("No load balancers found"); return; }
            console.log("\nLoad Balancers:\n");
            for (const lb of lbs) {
              console.log(`  ${lb.name}  ${theme.muted(lb.sku ?? "")}  ${lb.location ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list load balancers: ${formatErrorMessage(error)}`));
          }
        });

      netCmd
        .command("pip list")
        .description("List public IP addresses")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const pips = await networkManager.listPublicIPs(options.resourceGroup);
            if (pips.length === 0) { console.log("No public IPs found"); return; }
            console.log("\nPublic IP Addresses:\n");
            for (const p of pips) {
              console.log(`  ${p.name}  ${theme.info(p.ipAddress ?? "unassigned")}  ${p.allocationMethod ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list public IPs: ${formatErrorMessage(error)}`));
          }
        });

      // --- CosmosDB commands ---
      const cosmosCmd = az.command("cosmosdb").description("Azure Cosmos DB management");

      cosmosCmd
        .command("list")
        .description("List Cosmos DB accounts")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!cosmosDBManager) { console.error(theme.error("Cosmos DB manager not initialized")); return; }
          try {
            const accounts = await cosmosDBManager.listAccounts(options.resourceGroup);
            if (accounts.length === 0) { console.log("No Cosmos DB accounts found"); return; }
            console.log("\nCosmos DB Accounts:\n");
            for (const a of accounts) {
              console.log(`  ${a.name}  ${theme.muted(a.kind ?? "")}  ${a.documentEndpoint ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Cosmos DB accounts: ${formatErrorMessage(error)}`));
          }
        });

      cosmosCmd
        .command("databases <resourceGroup> <accountName>")
        .description("List databases in a Cosmos DB account")
        .action(async (resourceGroup: string, accountName: string) => {
          if (!cosmosDBManager) { console.error(theme.error("Cosmos DB manager not initialized")); return; }
          try {
            const dbs = await cosmosDBManager.listDatabases(resourceGroup, accountName);
            if (dbs.length === 0) { console.log("No databases found"); return; }
            console.log(`\nDatabases in ${accountName}:\n`);
            for (const db of dbs) {
              console.log(`  ${db.name}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Cosmos databases: ${formatErrorMessage(error)}`));
          }
        });

      // --- Service Bus commands ---
      const sbCmd = az.command("servicebus").description("Azure Service Bus management");

      sbCmd
        .command("list")
        .description("List Service Bus namespaces")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!serviceBusManager) { console.error(theme.error("Service Bus manager not initialized")); return; }
          try {
            const ns = await serviceBusManager.listNamespaces(options.resourceGroup);
            if (ns.length === 0) { console.log("No Service Bus namespaces found"); return; }
            console.log("\nService Bus Namespaces:\n");
            for (const n of ns) {
              console.log(`  ${n.name}  ${theme.muted(n.sku ?? "")}  ${n.endpoint ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Service Bus namespaces: ${formatErrorMessage(error)}`));
          }
        });

      sbCmd
        .command("queues <resourceGroup> <namespace>")
        .description("List queues in a Service Bus namespace")
        .action(async (resourceGroup: string, namespace: string) => {
          if (!serviceBusManager) { console.error(theme.error("Service Bus manager not initialized")); return; }
          try {
            const queues = await serviceBusManager.listQueues(resourceGroup, namespace);
            if (queues.length === 0) { console.log("No queues found"); return; }
            console.log(`\nQueues in ${namespace}:\n`);
            for (const q of queues) {
              console.log(`  ${q.name}  ${theme.muted(`msgs: ${q.messageCount ?? 0}`)}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Service Bus queues: ${formatErrorMessage(error)}`));
          }
        });

      sbCmd
        .command("topics <resourceGroup> <namespace>")
        .description("List topics in a Service Bus namespace")
        .action(async (resourceGroup: string, namespace: string) => {
          if (!serviceBusManager) { console.error(theme.error("Service Bus manager not initialized")); return; }
          try {
            const topics = await serviceBusManager.listTopics(resourceGroup, namespace);
            if (topics.length === 0) { console.log("No topics found"); return; }
            console.log(`\nTopics in ${namespace}:\n`);
            for (const t of topics) {
              console.log(`  ${t.name}  subscriptions: ${t.subscriptionCount ?? 0}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Service Bus topics: ${formatErrorMessage(error)}`));
          }
        });

      // --- Event Grid commands ---
      const egCmd = az.command("eventgrid").description("Azure Event Grid management");

      egCmd
        .command("topics")
        .description("List Event Grid topics")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!eventGridManager) { console.error(theme.error("Event Grid manager not initialized")); return; }
          try {
            const topics = await eventGridManager.listTopics(options.resourceGroup);
            if (topics.length === 0) { console.log("No Event Grid topics found"); return; }
            console.log("\nEvent Grid Topics:\n");
            for (const t of topics) {
              console.log(`  ${t.name}  ${theme.muted(t.provisioningState ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Event Grid topics: ${formatErrorMessage(error)}`));
          }
        });

      egCmd
        .command("domains")
        .description("List Event Grid domains")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!eventGridManager) { console.error(theme.error("Event Grid manager not initialized")); return; }
          try {
            const domains = await eventGridManager.listDomains(options.resourceGroup);
            if (domains.length === 0) { console.log("No Event Grid domains found"); return; }
            console.log("\nEvent Grid Domains:\n");
            for (const d of domains) {
              console.log(`  ${d.name}  ${theme.muted(d.provisioningState ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Event Grid domains: ${formatErrorMessage(error)}`));
          }
        });

      // --- Security commands ---
      const secCmd = az.command("security").description("Microsoft Defender for Cloud");

      secCmd
        .command("scores")
        .description("Show secure scores")
        .action(async () => {
          if (!securityManager) { console.error(theme.error("Security manager not initialized")); return; }
          try {
            const scores = await securityManager.getSecureScores();
            if (scores.length === 0) { console.log("No secure scores available"); return; }
            console.log("\nSecure Scores:\n");
            for (const s of scores) {
              console.log(`  ${s.displayName}  score: ${theme.info(String(s.currentScore ?? ""))} / ${s.maxScore ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to get secure scores: ${formatErrorMessage(error)}`));
          }
        });

      secCmd
        .command("alerts")
        .description("List security alerts")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!securityManager) { console.error(theme.error("Security manager not initialized")); return; }
          try {
            const alerts = await securityManager.listAlerts(options.resourceGroup);
            if (alerts.length === 0) { console.log("No security alerts"); return; }
            console.log("\nSecurity Alerts:\n");
            for (const a of alerts) {
              const sev = a.severity === "High" ? theme.error(a.severity) : a.severity === "Medium" ? theme.warn(a.severity) : theme.muted(a.severity ?? "");
              console.log(`  ${sev}  ${a.alertDisplayName ?? a.name}  ${theme.muted(a.status ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list security alerts: ${formatErrorMessage(error)}`));
          }
        });

      secCmd
        .command("recommendations")
        .description("List security recommendations")
        .action(async () => {
          if (!securityManager) { console.error(theme.error("Security manager not initialized")); return; }
          try {
            const recs = await securityManager.listRecommendations();
            if (recs.length === 0) { console.log("No recommendations"); return; }
            console.log("\nSecurity Recommendations:\n");
            for (const r of recs) {
              console.log(`  ${r.displayName ?? r.name}  ${theme.muted(r.status ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list recommendations: ${formatErrorMessage(error)}`));
          }
        });

      // --- IAM commands ---
      const iamCmd = az.command("iam").description("Identity & Access Management (RBAC)");

      iamCmd
        .command("roles")
        .description("List role definitions")
        .option("--scope <scope>", "Scope for role definitions")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { scope?: string };
          if (!iamManager) { console.error(theme.error("IAM manager not initialized")); return; }
          try {
            const roles = await iamManager.listRoleDefinitions(options.scope);
            if (roles.length === 0) { console.log("No role definitions found"); return; }
            console.log("\nRole Definitions:\n");
            for (const r of roles) {
              console.log(`  ${r.roleName ?? r.name}  ${theme.muted(r.roleType ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list role definitions: ${formatErrorMessage(error)}`));
          }
        });

      iamCmd
        .command("assignments")
        .description("List role assignments")
        .option("--scope <scope>", "Scope for role assignments")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { scope?: string };
          if (!iamManager) { console.error(theme.error("IAM manager not initialized")); return; }
          try {
            const assignments = await iamManager.listRoleAssignments(options.scope);
            if (assignments.length === 0) { console.log("No role assignments found"); return; }
            console.log("\nRole Assignments:\n");
            for (const a of assignments) {
              console.log(`  ${a.principalId}  → ${theme.info(a.roleDefinitionId ?? "")}  ${theme.muted(a.scope ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list role assignments: ${formatErrorMessage(error)}`));
          }
        });

      // --- Policy commands ---
      const polCmd = az.command("policy").description("Azure Policy management");

      polCmd
        .command("definitions")
        .description("List policy definitions")
        .action(async () => {
          if (!policyManager) { console.error(theme.error("Policy manager not initialized")); return; }
          try {
            const defs = await policyManager.listDefinitions();
            if (defs.length === 0) { console.log("No policy definitions found"); return; }
            console.log("\nPolicy Definitions:\n");
            for (const d of defs.slice(0, 25)) {
              console.log(`  ${d.displayName ?? d.name}  ${theme.muted(d.policyType ?? "")}`);
            }
            if (defs.length > 25) console.log(theme.muted(`  ... and ${defs.length - 25} more`));
          } catch (error) {
            console.error(theme.error(`Failed to list policy definitions: ${formatErrorMessage(error)}`));
          }
        });

      polCmd
        .command("assignments")
        .description("List policy assignments")
        .option("--scope <scope>", "Scope for assignments")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { scope?: string };
          if (!policyManager) { console.error(theme.error("Policy manager not initialized")); return; }
          try {
            const assignments = await policyManager.listAssignments(options.scope);
            if (assignments.length === 0) { console.log("No policy assignments found"); return; }
            console.log("\nPolicy Assignments:\n");
            for (const a of assignments) {
              console.log(`  ${a.displayName ?? a.name}  ${theme.muted(a.enforcementMode ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list policy assignments: ${formatErrorMessage(error)}`));
          }
        });

      polCmd
        .command("compliance")
        .description("Show policy compliance state")
        .option("--scope <scope>", "Scope for compliance")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { scope?: string };
          if (!policyManager) { console.error(theme.error("Policy manager not initialized")); return; }
          try {
            const states = await policyManager.getComplianceState(options.scope);
            if (states.length === 0) { console.log("No compliance data"); return; }
            console.log("\nPolicy Compliance:\n");
            for (const s of states) {
              const color = s.complianceState === "Compliant" ? theme.success : s.complianceState === "NonCompliant" ? theme.error : theme.muted;
              console.log(`  ${color(s.complianceState ?? "unknown")}  ${s.policyAssignmentId ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to get compliance state: ${formatErrorMessage(error)}`));
          }
        });

      // --- Backup commands ---
      const bkpCmd = az.command("backup").description("Azure Backup & Recovery Services");

      bkpCmd
        .command("vaults")
        .description("List Recovery Services vaults")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!backupManager) { console.error(theme.error("Backup manager not initialized")); return; }
          try {
            const vaults = await backupManager.listVaults(options.resourceGroup);
            if (vaults.length === 0) { console.log("No Recovery Services vaults found"); return; }
            console.log("\nRecovery Services Vaults:\n");
            for (const v of vaults) {
              console.log(`  ${v.name}  ${theme.muted(v.location ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list backup vaults: ${formatErrorMessage(error)}`));
          }
        });

      bkpCmd
        .command("items <resourceGroup> <vaultName>")
        .description("List backup items in a vault")
        .action(async (resourceGroup: string, vaultName: string) => {
          if (!backupManager) { console.error(theme.error("Backup manager not initialized")); return; }
          try {
            const items = await backupManager.listBackupItems(resourceGroup, vaultName);
            if (items.length === 0) { console.log("No backup items found"); return; }
            console.log(`\nBackup Items in ${vaultName}:\n`);
            for (const i of items) {
              console.log(`  ${i.name}  ${theme.muted(i.protectionStatus ?? "")}  ${i.lastBackupTime ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list backup items: ${formatErrorMessage(error)}`));
          }
        });

      bkpCmd
        .command("jobs <resourceGroup> <vaultName>")
        .description("List backup jobs in a vault")
        .action(async (resourceGroup: string, vaultName: string) => {
          if (!backupManager) { console.error(theme.error("Backup manager not initialized")); return; }
          try {
            const jobs = await backupManager.listBackupJobs(resourceGroup, vaultName);
            if (jobs.length === 0) { console.log("No backup jobs found"); return; }
            console.log(`\nBackup Jobs in ${vaultName}:\n`);
            for (const j of jobs) {
              console.log(`  ${j.operation ?? ""}  ${j.status ?? ""}  ${theme.muted(j.startTime ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list backup jobs: ${formatErrorMessage(error)}`));
          }
        });

      // --- Automation commands ---
      const autoCmd = az.command("automation").description("Azure Automation management");

      autoCmd
        .command("accounts")
        .description("List Automation accounts")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!automationManager) { console.error(theme.error("Automation manager not initialized")); return; }
          try {
            const accounts = await automationManager.listAccounts(options.resourceGroup);
            if (accounts.length === 0) { console.log("No Automation accounts found"); return; }
            console.log("\nAutomation Accounts:\n");
            for (const a of accounts) {
              console.log(`  ${a.name}  ${theme.muted(a.state ?? "")}  ${a.location ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Automation accounts: ${formatErrorMessage(error)}`));
          }
        });

      autoCmd
        .command("runbooks <resourceGroup> <accountName>")
        .description("List runbooks in an Automation account")
        .action(async (resourceGroup: string, accountName: string) => {
          if (!automationManager) { console.error(theme.error("Automation manager not initialized")); return; }
          try {
            const runbooks = await automationManager.listRunbooks(resourceGroup, accountName);
            if (runbooks.length === 0) { console.log("No runbooks found"); return; }
            console.log(`\nRunbooks in ${accountName}:\n`);
            for (const r of runbooks) {
              console.log(`  ${r.name}  ${theme.muted(r.runbookType ?? "")}  ${r.state ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list runbooks: ${formatErrorMessage(error)}`));
          }
        });

      autoCmd
        .command("jobs <resourceGroup> <accountName>")
        .description("List jobs in an Automation account")
        .action(async (resourceGroup: string, accountName: string) => {
          if (!automationManager) { console.error(theme.error("Automation manager not initialized")); return; }
          try {
            const jobs = await automationManager.listJobs(resourceGroup, accountName);
            if (jobs.length === 0) { console.log("No jobs found"); return; }
            console.log(`\nJobs in ${accountName}:\n`);
            for (const j of jobs) {
              console.log(`  ${j.runbookName ?? ""}  ${j.status ?? ""}  ${theme.muted(j.startTime ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list automation jobs: ${formatErrorMessage(error)}`));
          }
        });

      // --- Logic Apps commands ---
      const logicCmd = az.command("logic").description("Azure Logic Apps management");

      logicCmd
        .command("list")
        .description("List Logic App workflows")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            const workflows = await logicManager.listWorkflows(options.resourceGroup);
            if (workflows.length === 0) { console.log("No Logic App workflows found"); return; }
            console.log("\nLogic App Workflows:\n");
            for (const w of workflows) {
              console.log(`  ${w.name}  ${theme.muted(w.state ?? "")}  ${w.location ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Logic App workflows: ${formatErrorMessage(error)}`));
          }
        });

      logicCmd
        .command("runs <resourceGroup> <workflowName>")
        .description("List runs for a Logic App workflow")
        .action(async (resourceGroup: string, workflowName: string) => {
          if (!logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            const runs = await logicManager.listRuns(resourceGroup, workflowName);
            if (runs.length === 0) { console.log("No runs found"); return; }
            console.log(`\nRuns for ${workflowName}:\n`);
            for (const r of runs) {
              const color = r.status === "Succeeded" ? theme.success : r.status === "Failed" ? theme.error : theme.muted;
              console.log(`  ${r.name}  ${color(r.status ?? "")}  ${theme.muted(r.startTime ?? "")}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list Logic App runs: ${formatErrorMessage(error)}`));
          }
        });

      logicCmd
        .command("enable <resourceGroup> <workflowName>")
        .description("Enable a Logic App workflow")
        .action(async (resourceGroup: string, workflowName: string) => {
          if (!logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            await logicManager.enableWorkflow(resourceGroup, workflowName);
            console.log(theme.success(`Enabled Logic App: ${workflowName}`));
          } catch (error) {
            console.error(theme.error(`Failed to enable Logic App: ${formatErrorMessage(error)}`));
          }
        });

      logicCmd
        .command("disable <resourceGroup> <workflowName>")
        .description("Disable a Logic App workflow")
        .action(async (resourceGroup: string, workflowName: string) => {
          if (!logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            await logicManager.disableWorkflow(resourceGroup, workflowName);
            console.log(theme.success(`Disabled Logic App: ${workflowName}`));
          } catch (error) {
            console.error(theme.error(`Failed to disable Logic App: ${formatErrorMessage(error)}`));
          }
        });

      // --- API Management commands ---
      const apimCmd = az.command("apim").description("Azure API Management");

      apimCmd
        .command("list")
        .description("List API Management services")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!apimManager) { console.error(theme.error("API Management manager not initialized")); return; }
          try {
            const services = await apimManager.listServices(options.resourceGroup);
            if (services.length === 0) { console.log("No API Management services found"); return; }
            console.log("\nAPI Management Services:\n");
            for (const s of services) {
              console.log(`  ${s.name}  ${theme.muted(s.sku?.name ?? "")}  ${s.gatewayUrl ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list APIM services: ${formatErrorMessage(error)}`));
          }
        });

      apimCmd
        .command("apis <resourceGroup> <serviceName>")
        .description("List APIs in an API Management service")
        .action(async (resourceGroup: string, serviceName: string) => {
          if (!apimManager) { console.error(theme.error("API Management manager not initialized")); return; }
          try {
            const apis = await apimManager.listAPIs(resourceGroup, serviceName);
            if (apis.length === 0) { console.log("No APIs found"); return; }
            console.log(`\nAPIs in ${serviceName}:\n`);
            for (const a of apis) {
              console.log(`  ${a.displayName ?? a.name}  ${theme.muted(a.path ?? "")}  ${a.protocols?.join(", ") ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list APIs: ${formatErrorMessage(error)}`));
          }
        });

      // --- DevOps commands ---
      const devopsCmd = az.command("devops").description("Azure DevOps management");

      devopsCmd
        .command("projects")
        .description("List DevOps projects")
        .action(async () => {
          if (!devOpsManager) { console.error(theme.error("DevOps manager not initialized")); return; }
          try {
            const projects = await devOpsManager.listProjects();
            if (projects.length === 0) { console.log("No DevOps projects found"); return; }
            console.log("\nDevOps Projects:\n");
            for (const p of projects) {
              console.log(`  ${p.name}  ${theme.muted(p.state ?? "")}  ${p.visibility ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list DevOps projects: ${formatErrorMessage(error)}`));
          }
        });

      devopsCmd
        .command("pipelines <projectName>")
        .description("List pipelines in a DevOps project")
        .action(async (projectName: string) => {
          if (!devOpsManager) { console.error(theme.error("DevOps manager not initialized")); return; }
          try {
            const pipelines = await devOpsManager.listPipelines(projectName);
            if (pipelines.length === 0) { console.log("No pipelines found"); return; }
            console.log(`\nPipelines in ${projectName}:\n`);
            for (const p of pipelines) {
              console.log(`  ${p.name}  ${theme.muted(`id: ${p.id}`)}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list pipelines: ${formatErrorMessage(error)}`));
          }
        });

      devopsCmd
        .command("repos <projectName>")
        .description("List repositories in a DevOps project")
        .action(async (projectName: string) => {
          if (!devOpsManager) { console.error(theme.error("DevOps manager not initialized")); return; }
          try {
            const repos = await devOpsManager.listRepositories(projectName);
            if (repos.length === 0) { console.log("No repositories found"); return; }
            console.log(`\nRepositories in ${projectName}:\n`);
            for (const r of repos) {
              console.log(`  ${r.name}  ${theme.muted(r.defaultBranch ?? "")}  ${r.remoteUrl ?? ""}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list repositories: ${formatErrorMessage(error)}`));
          }
        });

      // --- PAT management commands ---
      const patCmd = devopsCmd.command("pat").description("Manage DevOps Personal Access Tokens");

      patCmd
        .command("list")
        .description("List stored PATs")
        .option("--org <org>", "Filter by organization")
        .action(async (opts: { org?: string }) => {
          if (!patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const pats = patManager.listPATs(opts.org);
            if (pats.length === 0) { console.log("No PATs stored"); return; }
            console.log("\nStored PATs:\n");
            for (const p of pats) {
              const expiry = p.expiresAt ? ` expires: ${new Date(p.expiresAt).toLocaleDateString()}` : "";
              const status = p.status === "active" ? theme.success(p.status) : p.status === "expired" ? theme.error(p.status) : p.status === "expiring-soon" ? theme.warn(p.status) : theme.muted(p.status);
              console.log(`  ${p.label}  ${status}  ${theme.muted(p.organization)}${expiry}  ${theme.muted(p.id.slice(0, 8))}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to list PATs: ${formatErrorMessage(error)}`));
          }
        });

      patCmd
        .command("store")
        .description("Store a new PAT securely")
        .requiredOption("--token <token>", "The PAT value")
        .requiredOption("--label <label>", "A label for this PAT")
        .option("--org <org>", "DevOps organization")
        .option("--scopes <scopes>", "Comma-separated scopes")
        .option("--expires <date>", "Expiry date (ISO 8601)")
        .option("--validate", "Validate against DevOps API")
        .action(async (opts: { token: string; label: string; org?: string; scopes?: string; expires?: string; validate?: boolean }) => {
          if (!patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const summary = await patManager.storePAT({
              token: opts.token,
              label: opts.label,
              organization: opts.org,
              scopes: opts.scopes?.split(",").map(s => s.trim()) as any,
              expiresAt: opts.expires,
              validate: opts.validate,
            });
            console.log(theme.success(`PAT stored: ${summary.label} (${summary.id.slice(0, 8)})`));
          } catch (error) {
            console.error(theme.error(`Failed to store PAT: ${formatErrorMessage(error)}`));
          }
        });

      patCmd
        .command("delete <id>")
        .description("Delete a stored PAT")
        .action(async (id: string) => {
          if (!patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const deleted = await patManager.deletePAT(id);
            if (deleted) { console.log(theme.success("PAT deleted")); }
            else { console.error(theme.error("PAT not found")); }
          } catch (error) {
            console.error(theme.error(`Failed to delete PAT: ${formatErrorMessage(error)}`));
          }
        });

      patCmd
        .command("validate [id]")
        .description("Validate a PAT against DevOps API (or all PATs if no ID)")
        .action(async (id?: string) => {
          if (!patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            if (id) {
              const result = await patManager.validatePAT(id);
              if (result.valid) {
                console.log(theme.success(`PAT valid — ${result.displayName} (${result.emailAddress})`));
              } else {
                console.error(theme.error(`PAT invalid: ${result.error}`));
              }
            } else {
              const results = await patManager.validateAll();
              for (const r of results) {
                const v = r.validation;
                const status = v.valid ? theme.success("valid") : theme.error("invalid");
                console.log(`  ${r.label}  ${status}  ${v.valid ? v.displayName : v.error}`);
              }
            }
          } catch (error) {
            console.error(theme.error(`Failed to validate PAT: ${formatErrorMessage(error)}`));
          }
        });

      patCmd
        .command("rotate <id>")
        .description("Rotate a stored PAT with a new token")
        .requiredOption("--token <token>", "New PAT value")
        .option("--expires <date>", "New expiry date (ISO 8601)")
        .action(async (id: string, opts: { token: string; expires?: string }) => {
          if (!patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const summary = await patManager.rotatePAT(id, opts.token, opts.expires);
            console.log(theme.success(`PAT rotated: ${summary.label}`));
          } catch (error) {
            console.error(theme.error(`Failed to rotate PAT: ${formatErrorMessage(error)}`));
          }
        });

      patCmd
        .command("check-expiry")
        .description("Check for expired or expiring-soon PATs")
        .action(() => {
          if (!patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const problems = patManager.checkExpiry();
            if (problems.length === 0) { console.log(theme.success("All PATs are within expiry limits")); return; }
            console.log(theme.warn(`\n${problems.length} PAT(s) need attention:\n`));
            for (const p of problems) {
              const status = p.status === "expired" ? theme.error(p.status) : theme.warn(p.status);
              console.log(`  ${p.label}  ${status}  ${theme.muted(p.organization)}`);
            }
          } catch (error) {
            console.error(theme.error(`Failed to check expiry: ${formatErrorMessage(error)}`));
          }
        });

      // --- Advisor commands ---
      const advisorCmd = az.command("advisor").description("Project analysis and Azure service recommendation");

      advisorCmd
        .command("analyze <projectPath>")
        .description("Analyze a project directory — detect language, framework, dependencies, and signals")
        .action((projectPath: string) => {
          try {
            const analysis = analyzeProject(projectPath);
            console.log(`\n${theme.info("Project Analysis")}\n`);
            console.log(`  Language:        ${analysis.language}`);
            console.log(`  Framework:       ${analysis.framework}`);
            console.log(`  Archetype:       ${analysis.archetype}`);
            console.log(`  Entry point:     ${analysis.entryPoint ?? "not detected"}`);
            console.log(`  Port:            ${analysis.port ?? "not detected"}`);
            console.log(`  Package manager: ${analysis.packageManager ?? "none"}`);
            console.log(`  Dockerfile:      ${analysis.hasDockerfile ? "yes" : "no"}`);
            console.log(`  Docker Compose:  ${analysis.hasDockerCompose ? "yes" : "no"}`);
            console.log(`  Tests:           ${analysis.hasTests ? "yes" : "no"}`);
            console.log(`  Dependencies:    ${analysis.dependencies.length} (with infrastructure signals)`);
            console.log(`  Env vars:        ${analysis.envVars.length}`);
            console.log(`  Confidence:      ${Math.round(analysis.confidence * 100)}%`);
            if (analysis.notes.length > 0) {
              console.log(`\n  Notes:`);
              for (const n of analysis.notes) console.log(`    - ${n}`);
            }
          } catch (error) {
            console.error(theme.error(`Analysis failed: ${formatErrorMessage(error)}`));
          }
        });

      advisorCmd
        .command("recommend <projectPath>")
        .description("Analyze a project and recommend Azure services + blueprints")
        .option("--region <region>", "Preferred Azure region", "eastus")
        .option("--project-name <name>", "Override project name")
        .option("--prefer-containers", "Prefer container-based deployment")
        .option("--tenant-id <id>", "Azure AD tenant ID")
        .action((projectPath: string, ...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { region?: string; projectName?: string; preferContainers?: boolean; tenantId?: string };
          try {
            const analysis = analyzeProject(projectPath);
            const rec = recommend(analysis, {
              defaultRegion: options.region,
              projectName: options.projectName,
              preferContainers: options.preferContainers,
              tenantId: options.tenantId,
            });
            console.log(`\n${rec.summary}\n`);
            console.log(theme.info("Services:"));
            for (const s of rec.services) {
              const tag = s.required ? theme.warn("[REQUIRED]") : theme.muted("[optional]");
              console.log(`  ${tag} ${s.service}${s.suggestedSku ? ` (${s.suggestedSku})` : ""}`);
              console.log(`         ${theme.muted(s.reason)}`);
            }
            if (rec.blueprint) {
              console.log(`\n${theme.info("Best Blueprint Match:")}`);
              console.log(`  ${rec.blueprint.name} (${Math.round(rec.blueprint.matchScore * 100)}% match)`);
              if (rec.blueprint.missingParams.length > 0) {
                console.log(`  ${theme.warn("Missing params:")} ${rec.blueprint.missingParams.join(", ")}`);
              }
            }
            if (rec.alternativeBlueprints.length > 0) {
              console.log(`\n${theme.muted("Alternatives:")}`);
              for (const alt of rec.alternativeBlueprints) {
                console.log(`  ${alt.name} (${Math.round(alt.matchScore * 100)}%)`);
              }
            }
            console.log(`\n${theme.info("Action Items:")}`);
            for (const a of rec.actionItems) console.log(`  • ${a}`);
            console.log(`\nOverall confidence: ${rec.confidence}\n`);
          } catch (error) {
            console.error(theme.error(`Recommendation failed: ${formatErrorMessage(error)}`));
          }
        });

      advisorCmd
        .command("deploy <projectPath>")
        .description("End-to-end: analyze → recommend → select blueprint → generate plan → execute")
        .option("--region <region>", "Preferred Azure region", "eastus")
        .option("--project-name <name>", "Override project name")
        .option("--prefer-containers", "Prefer container-based deployment")
        .option("--tenant-id <id>", "Azure AD tenant ID")
        .option("--live", "Execute for real (default is dry-run)")
        .action(async (projectPath: string, ...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { region?: string; projectName?: string; preferContainers?: boolean; tenantId?: string; live?: boolean };
          if (!orchestrator) { console.error(theme.error("Orchestrator not initialized")); return; }
          try {
            const analysis = analyzeProject(projectPath);
            const { recommendation, plan, validationIssues } = recommendAndPlan(analysis, {
              defaultRegion: options.region,
              projectName: options.projectName,
              preferContainers: options.preferContainers,
              tenantId: options.tenantId,
            });
            console.log(`\n${recommendation.summary}\n`);
            if (!plan) {
              console.log(theme.warn("Could not generate an execution plan."));
              if (validationIssues.length > 0) {
                for (const i of validationIssues) console.log(`  - ${i}`);
              }
              console.log(`\n${theme.info("Action Items:")}`);
              for (const a of recommendation.actionItems) console.log(`  • ${a}`);
              return;
            }
            const dryRun = !options.live;
            console.log(`${theme.info(dryRun ? "DRY RUN" : "LIVE EXECUTION")} — ${plan.name} (${plan.steps.length} steps)\n`);
            const runner = new Orchestrator({ ...orchestrator["options"], dryRun });
            const result = await runner.execute(plan);
            for (const s of result.steps) {
              const icon = (s.status as string) === "completed" ? theme.success("✓") : (s.status as string) === "failed" ? theme.error("✗") : theme.muted("○");
              console.log(`  ${icon} ${s.stepName} [${s.stepType}] — ${s.durationMs}ms${s.error ? ` ${theme.error(s.error)}` : ""}`);
            }
            console.log(`\nStatus: ${(result.status as string) === "completed" ? theme.success(result.status) : theme.error(result.status)} (${result.totalDurationMs}ms)`);
            if (result.errors.length > 0) {
              console.log(theme.error("\nErrors:"));
              for (const e of result.errors) console.log(`  - ${e}`);
            }
          } catch (error) {
            console.error(theme.error(`Deploy failed: ${formatErrorMessage(error)}`));
          }
        });
    });

    // =========================================================================
    // Gateway Methods
    // =========================================================================
    api.registerGatewayMethod("azure.status", async (opts) => {
      if (!credentialsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Azure not initialized" }); return; }
      try {
        const result = await credentialsManager.getCredential();
        opts.respond(true, { data: { method: result.method, subscriptionId: result.subscriptionId, tenantId: result.tenantId } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.vm.list", async (opts) => {
      if (!vmManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "VM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const vms = await vmManager.listVMs(params.resourceGroup ? { resourceGroup: params.resourceGroup } : undefined);
        opts.respond(true, { data: vms });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.vm.start", async (opts) => {
      if (!vmManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "VM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; vmName: string };
        await vmManager.startVM(params.resourceGroup, params.vmName);
        opts.respond(true, { data: { success: true } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.vm.stop", async (opts) => {
      if (!vmManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "VM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; vmName: string };
        await vmManager.stopVM(params.resourceGroup, params.vmName);
        opts.respond(true, { data: { success: true } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.storage.list", async (opts) => {
      if (!storageManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Storage manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const accounts = await storageManager.listStorageAccounts(params.resourceGroup);
        opts.respond(true, { data: accounts });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.rg.list", async (opts) => {
      if (!resourceManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Resource manager not initialized" }); return; }
      try {
        const groups = await resourceManager.listResourceGroups();
        opts.respond(true, { data: groups });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.functions.list", async (opts) => {
      if (!functionsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Functions manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const apps = await functionsManager.listFunctionApps(params.resourceGroup);
        opts.respond(true, { data: apps });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.aks.list", async (opts) => {
      if (!containerManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Container manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const clusters = await containerManager.listAKSClusters(params.resourceGroup);
        opts.respond(true, { data: clusters });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.sql.list", async (opts) => {
      if (!sqlManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "SQL manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const servers = await sqlManager.listServers(params.resourceGroup);
        opts.respond(true, { data: servers });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.keyvault.list", async (opts) => {
      if (!keyVaultManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "KeyVault manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const vaults = await keyVaultManager.listVaults(params.resourceGroup);
        opts.respond(true, { data: vaults });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.cost.query", async (opts) => {
      if (!costManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Cost manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { timeframe?: string };
        const result = await costManager.queryCosts({ timeframe: params.timeframe });
        opts.respond(true, { data: result });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.subscriptions.list", async (opts) => {
      if (!subscriptionManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Subscription manager not initialized" }); return; }
      try {
        const subs = await subscriptionManager.listSubscriptions();
        opts.respond(true, { data: subs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.monitor.metrics", async (opts) => {
      if (!monitorManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Monitor manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceUri: string; metrics: string[] };
        const metrics = await monitorManager.listMetrics(params.resourceUri, params.metrics);
        opts.respond(true, { data: metrics });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.security.scores", async (opts) => {
      if (!securityManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Security manager not initialized" }); return; }
      try {
        const scores = await securityManager.getSecureScores();
        opts.respond(true, { data: scores });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.compliance.report", async (opts) => {
      if (!complianceManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Compliance manager not initialized" }); return; }
      try {
        const report = await complianceManager.generateReport();
        opts.respond(true, { data: report });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Networking ---
    api.registerGatewayMethod("azure.network.vnets", async (opts) => {
      if (!networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const vnets = await networkManager.listVNets(params.resourceGroup);
        opts.respond(true, { data: vnets });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.network.nsgs", async (opts) => {
      if (!networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const nsgs = await networkManager.listNSGs(params.resourceGroup);
        opts.respond(true, { data: nsgs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.network.lbs", async (opts) => {
      if (!networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const lbs = await networkManager.listLoadBalancers(params.resourceGroup);
        opts.respond(true, { data: lbs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.network.pips", async (opts) => {
      if (!networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const pips = await networkManager.listPublicIPs(params.resourceGroup);
        opts.respond(true, { data: pips });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- DNS ---
    api.registerGatewayMethod("azure.dns.zones", async (opts) => {
      if (!dnsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DNS manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const zones = await dnsManager.listZones(params.resourceGroup);
        opts.respond(true, { data: zones });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.dns.records", async (opts) => {
      if (!dnsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DNS manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; zoneName: string };
        const records = await dnsManager.listRecordSets(params.resourceGroup, params.zoneName);
        opts.respond(true, { data: records });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Redis ---
    api.registerGatewayMethod("azure.redis.list", async (opts) => {
      if (!redisManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Redis manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const caches = await redisManager.listCaches(params.resourceGroup);
        opts.respond(true, { data: caches });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.redis.get", async (opts) => {
      if (!redisManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Redis manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; cacheName: string };
        const cache = await redisManager.getCache(params.resourceGroup, params.cacheName);
        opts.respond(true, { data: cache });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- CDN ---
    api.registerGatewayMethod("azure.cdn.profiles", async (opts) => {
      if (!cdnManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CDN manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const profiles = await cdnManager.listProfiles(params.resourceGroup);
        opts.respond(true, { data: profiles });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.cdn.endpoints", async (opts) => {
      if (!cdnManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CDN manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; profileName: string };
        const endpoints = await cdnManager.listEndpoints(params.resourceGroup, params.profileName);
        opts.respond(true, { data: endpoints });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- CosmosDB ---
    api.registerGatewayMethod("azure.cosmosdb.list", async (opts) => {
      if (!cosmosDBManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CosmosDB manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const accounts = await cosmosDBManager.listAccounts(params.resourceGroup);
        opts.respond(true, { data: accounts });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.cosmosdb.databases", async (opts) => {
      if (!cosmosDBManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CosmosDB manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
        const dbs = await cosmosDBManager.listDatabases(params.resourceGroup, params.accountName);
        opts.respond(true, { data: dbs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Service Bus ---
    api.registerGatewayMethod("azure.servicebus.list", async (opts) => {
      if (!serviceBusManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "ServiceBus manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const namespaces = await serviceBusManager.listNamespaces(params.resourceGroup);
        opts.respond(true, { data: namespaces });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.servicebus.queues", async (opts) => {
      if (!serviceBusManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "ServiceBus manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; namespaceName: string };
        const queues = await serviceBusManager.listQueues(params.resourceGroup, params.namespaceName);
        opts.respond(true, { data: queues });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.servicebus.topics", async (opts) => {
      if (!serviceBusManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "ServiceBus manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; namespaceName: string };
        const topics = await serviceBusManager.listTopics(params.resourceGroup, params.namespaceName);
        opts.respond(true, { data: topics });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Event Grid ---
    api.registerGatewayMethod("azure.eventgrid.topics", async (opts) => {
      if (!eventGridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EventGrid manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const topics = await eventGridManager.listTopics(params.resourceGroup);
        opts.respond(true, { data: topics });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.eventgrid.domains", async (opts) => {
      if (!eventGridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EventGrid manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const domains = await eventGridManager.listDomains(params.resourceGroup);
        opts.respond(true, { data: domains });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- IAM ---
    api.registerGatewayMethod("azure.iam.roles", async (opts) => {
      if (!iamManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "IAM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { scope?: string };
        const roles = await iamManager.listRoleDefinitions(params.scope);
        opts.respond(true, { data: roles });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.iam.assignments", async (opts) => {
      if (!iamManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "IAM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { scope?: string };
        const assignments = await iamManager.listRoleAssignments(params.scope);
        opts.respond(true, { data: assignments });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Policy ---
    api.registerGatewayMethod("azure.policy.definitions", async (opts) => {
      if (!policyManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Policy manager not initialized" }); return; }
      try {
        const defs = await policyManager.listDefinitions();
        opts.respond(true, { data: defs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.policy.assignments", async (opts) => {
      if (!policyManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Policy manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { scope?: string };
        const assignments = await policyManager.listAssignments(params.scope);
        opts.respond(true, { data: assignments });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.policy.compliance", async (opts) => {
      if (!policyManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Policy manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { scope?: string };
        const state = await policyManager.getComplianceState(params.scope);
        opts.respond(true, { data: state });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Backup ---
    api.registerGatewayMethod("azure.backup.vaults", async (opts) => {
      if (!backupManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Backup manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const vaults = await backupManager.listVaults(params.resourceGroup);
        opts.respond(true, { data: vaults });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.backup.items", async (opts) => {
      if (!backupManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Backup manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; vaultName: string };
        const items = await backupManager.listBackupItems(params.resourceGroup, params.vaultName);
        opts.respond(true, { data: items });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.backup.jobs", async (opts) => {
      if (!backupManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Backup manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; vaultName: string };
        const jobs = await backupManager.listBackupJobs(params.resourceGroup, params.vaultName);
        opts.respond(true, { data: jobs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Automation ---
    api.registerGatewayMethod("azure.automation.accounts", async (opts) => {
      if (!automationManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Automation manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const accounts = await automationManager.listAccounts(params.resourceGroup);
        opts.respond(true, { data: accounts });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.automation.runbooks", async (opts) => {
      if (!automationManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Automation manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
        const runbooks = await automationManager.listRunbooks(params.resourceGroup, params.accountName);
        opts.respond(true, { data: runbooks });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.automation.jobs", async (opts) => {
      if (!automationManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Automation manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
        const jobs = await automationManager.listJobs(params.resourceGroup, params.accountName);
        opts.respond(true, { data: jobs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Logic Apps ---
    api.registerGatewayMethod("azure.logic.list", async (opts) => {
      if (!logicManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Logic Apps manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const workflows = await logicManager.listWorkflows(params.resourceGroup);
        opts.respond(true, { data: workflows });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.logic.runs", async (opts) => {
      if (!logicManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Logic Apps manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; workflowName: string };
        const runs = await logicManager.listRuns(params.resourceGroup, params.workflowName);
        opts.respond(true, { data: runs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- API Management ---
    api.registerGatewayMethod("azure.apim.list", async (opts) => {
      if (!apimManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "APIM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const services = await apimManager.listServices(params.resourceGroup);
        opts.respond(true, { data: services });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.apim.apis", async (opts) => {
      if (!apimManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "APIM manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; serviceName: string };
        const apis = await apimManager.listAPIs(params.resourceGroup, params.serviceName);
        opts.respond(true, { data: apis });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- DevOps ---
    api.registerGatewayMethod("azure.devops.projects", async (opts) => {
      if (!devOpsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DevOps manager not initialized (set devOpsOrganization in config)" }); return; }
      try {
        const projects = await devOpsManager.listProjects();
        opts.respond(true, { data: projects });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.pipelines", async (opts) => {
      if (!devOpsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DevOps manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { projectName: string };
        const pipelines = await devOpsManager.listPipelines(params.projectName);
        opts.respond(true, { data: pipelines });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.repos", async (opts) => {
      if (!devOpsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DevOps manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { projectName: string };
        const repos = await devOpsManager.listRepositories(params.projectName);
        opts.respond(true, { data: repos });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- PAT management gateway methods ---
    api.registerGatewayMethod("azure.devops.pat.list", async (opts) => {
      if (!patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { organization?: string };
        const pats = patManager.listPATs(params.organization);
        opts.respond(true, { data: pats });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.pat.store", async (opts) => {
      if (!patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { token: string; label: string; organization?: string; scopes?: string[]; expiresAt?: string; validate?: boolean };
        const summary = await patManager.storePAT(params);
        opts.respond(true, { data: summary });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.pat.delete", async (opts) => {
      if (!patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { id: string };
        const deleted = await patManager.deletePAT(params.id);
        opts.respond(true, { data: { deleted } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.pat.validate", async (opts) => {
      if (!patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { id: string };
        const result = await patManager.validatePAT(params.id);
        opts.respond(true, { data: result });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.pat.token", async (opts) => {
      if (!patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { organization: string };
        const token = await patManager.getTokenForOrganization(params.organization);
        if (!token) { opts.respond(false, undefined, { code: "NOT_FOUND", message: `No valid PAT for organization: ${params.organization}` }); return; }
        opts.respond(true, { data: { token } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.devops.pat.checkExpiry", async (opts) => {
      if (!patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
      try {
        const problems = patManager.checkExpiry();
        opts.respond(true, { data: problems });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- AI ---
    api.registerGatewayMethod("azure.ai.accounts", async (opts) => {
      if (!aiManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "AI manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup?: string };
        const accounts = await aiManager.listAccounts(params.resourceGroup);
        opts.respond(true, { data: accounts });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.ai.deployments", async (opts) => {
      if (!aiManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "AI manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
        const deployments = await aiManager.listDeployments(params.resourceGroup, params.accountName);
        opts.respond(true, { data: deployments });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.ai.models", async (opts) => {
      if (!aiManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "AI manager not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { location: string };
        const models = await aiManager.listModels(params.location);
        opts.respond(true, { data: models });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Activity Log ---
    api.registerGatewayMethod("azure.activitylog.events", async (opts) => {
      if (!activityLogManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Activity Log manager not initialized" }); return; }
      try {
        const events = await activityLogManager.getEvents();
        opts.respond(true, { data: events });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Security (additional) ---
    api.registerGatewayMethod("azure.security.alerts", async (opts) => {
      if (!securityManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Security manager not initialized" }); return; }
      try {
        const alerts = await securityManager.listAlerts();
        opts.respond(true, { data: alerts });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.security.recommendations", async (opts) => {
      if (!securityManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Security manager not initialized" }); return; }
      try {
        const recs = await securityManager.listRecommendations();
        opts.respond(true, { data: recs });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // --- Orchestration (IDIO) ---
    api.registerGatewayMethod("azure.orchestration.listBlueprints", async (opts) => {
      try {
        opts.respond(true, { data: listBlueprints() });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.orchestration.getBlueprint", async (opts) => {
      try {
        const params = (opts.params ?? {}) as { id: string };
        const bp = getBlueprint(params.id);
        if (!bp) { opts.respond(false, undefined, { code: "NOT_FOUND", message: `Blueprint "${params.id}" not found` }); return; }
        opts.respond(true, { data: { id: bp.id, name: bp.name, description: bp.description, category: bp.category, parameters: bp.parameters } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.orchestration.generatePlan", async (opts) => {
      try {
        const params = (opts.params ?? {}) as { blueprintId: string; params: Record<string, unknown> };
        const bp = getBlueprint(params.blueprintId);
        if (!bp) { opts.respond(false, undefined, { code: "NOT_FOUND", message: `Blueprint "${params.blueprintId}" not found` }); return; }
        const plan = bp.generate(params.params);
        const validation = validatePlan(plan);
        opts.respond(true, { data: { plan, validation } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.orchestration.executePlan", async (opts) => {
      if (!orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { plan: any; dryRun?: boolean };
        const runner = new Orchestrator({ ...orchestrator["options"], dryRun: params.dryRun });
        const result = await runner.execute(params.plan);
        opts.respond(true, { data: result });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.orchestration.runBlueprint", async (opts) => {
      if (!orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { blueprintId: string; params: Record<string, unknown>; dryRun?: boolean };
        const bp = getBlueprint(params.blueprintId);
        if (!bp) { opts.respond(false, undefined, { code: "NOT_FOUND", message: `Blueprint "${params.blueprintId}" not found` }); return; }
        const plan = bp.generate(params.params);
        const validation = validatePlan(plan);
        if (!validation.valid) { opts.respond(false, undefined, { code: "VALIDATION_FAILED", message: validation.issues.map((i) => i.message).join("; ") }); return; }
        const runner = new Orchestrator({ ...orchestrator["options"], dryRun: params.dryRun });
        const result = await runner.execute(plan);
        opts.respond(true, { data: result });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // -------------------------------------------------------------------------
    // Advisor gateway methods
    // -------------------------------------------------------------------------

    api.registerGatewayMethod("azure.advisor.analyze", async (opts) => {
      try {
        const params = (opts.params ?? {}) as { projectPath: string };
        if (!params.projectPath) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "projectPath is required" }); return; }
        const analysis = analyzeProject(params.projectPath);
        opts.respond(true, { data: analysis });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.advisor.recommend", async (opts) => {
      try {
        const params = (opts.params ?? {}) as { projectPath: string; options?: Record<string, unknown> };
        if (!params.projectPath) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "projectPath is required" }); return; }
        const analysis = analyzeProject(params.projectPath);
        const recommendation = recommend(analysis, params.options as any);
        opts.respond(true, { data: recommendation });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    api.registerGatewayMethod("azure.advisor.analyzeAndDeploy", async (opts) => {
      if (!orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
      try {
        const params = (opts.params ?? {}) as { projectPath: string; options?: Record<string, unknown>; dryRun?: boolean };
        if (!params.projectPath) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "projectPath is required" }); return; }
        const { recommendation, plan, validationIssues } = recommendAndPlan(analyzeProject(params.projectPath), params.options as any);
        if (!plan) {
          opts.respond(true, { data: { recommendation, plan: null, validationIssues, executed: false } });
          return;
        }
        const runner = new Orchestrator({ ...orchestrator["options"], dryRun: params.dryRun });
        const result = await runner.execute(plan);
        opts.respond(true, { data: { recommendation, plan, result, validationIssues, executed: true } });
      } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
    });

    // =========================================================================
    // Agent Tools
    // =========================================================================
    api.registerTool({
      name: "azure_list_vms",
      label: "Azure List VMs",
      description: "List Azure virtual machines, optionally filtered by resource group",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!vmManager) throw new Error("VM manager not initialized");
        const rg = params.resourceGroup as string | undefined;
        const vms = await vmManager.listVMs(rg ? { resourceGroup: rg } : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(vms, null, 2) }], details: { count: vms.length } };
      },
    });

    api.registerTool({
      name: "azure_start_vm",
      label: "Azure Start VM",
      description: "Start an Azure virtual machine",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" }, vmName: { type: "string" } }, required: ["resourceGroup", "vmName"] },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!vmManager) throw new Error("VM manager not initialized");
        const result = await vmManager.startVM(params.resourceGroup as string, params.vmName as string);
        return { content: [{ type: "text" as const, text: `Started VM: ${params.vmName}` }], details: result };
      },
    });

    api.registerTool({
      name: "azure_stop_vm",
      label: "Azure Stop VM",
      description: "Stop an Azure virtual machine",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" }, vmName: { type: "string" } }, required: ["resourceGroup", "vmName"] },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!vmManager) throw new Error("VM manager not initialized");
        const result = await vmManager.stopVM(params.resourceGroup as string, params.vmName as string);
        return { content: [{ type: "text" as const, text: `Stopped VM: ${params.vmName}` }], details: result };
      },
    });

    api.registerTool({
      name: "azure_list_storage_accounts",
      label: "Azure List Storage",
      description: "List Azure Storage accounts",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!storageManager) throw new Error("Storage manager not initialized");
        const accounts = await storageManager.listStorageAccounts(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }], details: { count: accounts.length } };
      },
    });

    api.registerTool({
      name: "azure_list_containers",
      label: "Azure List Containers",
      description: "List containers in a storage account",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" }, accountName: { type: "string" } }, required: ["resourceGroup", "accountName"] },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!storageManager) throw new Error("Storage manager not initialized");
        const containers = await storageManager.listContainers(params.resourceGroup as string, params.accountName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(containers, null, 2) }], details: { count: containers.length } };
      },
    });

    api.registerTool({
      name: "azure_list_resource_groups",
      label: "Azure List Resource Groups",
      description: "List Azure resource groups",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!resourceManager) throw new Error("Resource manager not initialized");
        const groups = await resourceManager.listResourceGroups();
        return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }], details: { count: groups.length } };
      },
    });

    api.registerTool({
      name: "azure_list_functions",
      label: "Azure List Functions",
      description: "List Azure Function Apps",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!functionsManager) throw new Error("Functions manager not initialized");
        const apps = await functionsManager.listFunctionApps(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(apps, null, 2) }], details: { count: apps.length } };
      },
    });

    api.registerTool({
      name: "azure_list_aks_clusters",
      label: "Azure List AKS",
      description: "List AKS clusters",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!containerManager) throw new Error("Container manager not initialized");
        const clusters = await containerManager.listAKSClusters(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(clusters, null, 2) }], details: { count: clusters.length } };
      },
    });

    api.registerTool({
      name: "azure_list_sql_servers",
      label: "Azure List SQL",
      description: "List Azure SQL servers",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!sqlManager) throw new Error("SQL manager not initialized");
        const servers = await sqlManager.listServers(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }], details: { count: servers.length } };
      },
    });

    api.registerTool({
      name: "azure_list_keyvaults",
      label: "Azure List KeyVaults",
      description: "List Azure Key Vaults",
      parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!keyVaultManager) throw new Error("KeyVault manager not initialized");
        const vaults = await keyVaultManager.listVaults(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(vaults, null, 2) }], details: { count: vaults.length } };
      },
    });

    api.registerTool({
      name: "azure_query_costs",
      label: "Azure Query Costs",
      description: "Query Azure cost data",
      parameters: { type: "object", properties: { timeframe: { type: "string", description: "MonthToDate, BillingMonthToDate, etc." } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!costManager) throw new Error("Cost manager not initialized");
        const result = await costManager.queryCosts({ timeframe: params.timeframe as string | undefined });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { rows: result.rows.length } };
      },
    });

    api.registerTool({
      name: "azure_list_subscriptions",
      label: "Azure List Subscriptions",
      description: "List Azure subscriptions",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!subscriptionManager) throw new Error("Subscription manager not initialized");
        const subs = await subscriptionManager.listSubscriptions();
        return { content: [{ type: "text" as const, text: JSON.stringify(subs, null, 2) }], details: { count: subs.length } };
      },
    });

    api.registerTool({
      name: "azure_get_metrics",
      label: "Azure Get Metrics",
      description: "Get Azure Monitor metrics for a resource",
      parameters: {
        type: "object",
        properties: {
          resourceUri: { type: "string", description: "Full ARM resource ID" },
          metrics: { type: "array", description: "Metric names" },
          timespan: { type: "string" },
          interval: { type: "string" },
        },
        required: ["resourceUri", "metrics"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!monitorManager) throw new Error("Monitor manager not initialized");
        const metrics = await monitorManager.listMetrics(params.resourceUri as string, params.metrics as string[], {
          timespan: params.timespan as string | undefined,
          interval: params.interval as string | undefined,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }], details: { count: metrics.length } };
      },
    });

    api.registerTool({
      name: "azure_list_security_alerts",
      label: "Azure Security Alerts",
      description: "List Microsoft Defender for Cloud security alerts",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!securityManager) throw new Error("Security manager not initialized");
        const alerts = await securityManager.listAlerts();
        return { content: [{ type: "text" as const, text: JSON.stringify(alerts, null, 2) }], details: { count: alerts.length } };
      },
    });

    api.registerTool({
      name: "azure_compliance_report",
      label: "Azure Compliance Report",
      description: "Generate Azure compliance report",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!complianceManager) throw new Error("Compliance manager not initialized");
        const report = await complianceManager.generateReport();
        return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }], details: report };
      },
    });

    api.registerTool({
      name: "azure_deploy_arm_template",
      label: "Azure Deploy ARM",
      description: "Deploy an ARM template to a resource group",
      parameters: {
        type: "object",
        properties: {
          resourceGroup: { type: "string" },
          deploymentName: { type: "string" },
          template: { type: "object" },
          parameters: { type: "object" },
        },
        required: ["resourceGroup", "deploymentName", "template"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!resourceManager) throw new Error("Resource manager not initialized");
        const deployment = await resourceManager.createDeployment(
          params.resourceGroup as string,
          params.deploymentName as string,
          params.template as Record<string, unknown>,
          params.parameters as Record<string, unknown> | undefined,
        );
        return { content: [{ type: "text" as const, text: `Deployment ${deployment.name} created successfully` }], details: deployment };
      },
    });

    api.registerTool({
      name: "azure_list_ai_deployments",
      label: "Azure AI Deployments",
      description: "List Azure OpenAI / Cognitive Services deployments",
      parameters: {
        type: "object",
        properties: {
          resourceGroup: { type: "string" },
          accountName: { type: "string" },
        },
        required: ["resourceGroup", "accountName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!aiManager) throw new Error("AI manager not initialized");
        const deployments = await aiManager.listDeployments(params.resourceGroup as string, params.accountName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(deployments, null, 2) }], details: { count: deployments.length } };
      },
    });

    // --- Networking tools ---
    api.registerTool({
      name: "azure_list_vnets",
      label: "Azure List VNets",
      description: "List Azure Virtual Networks, optionally filtered by resource group",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!networkManager) throw new Error("Network manager not initialized");
        const vnets = await networkManager.listVNets(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(vnets, null, 2) }], details: { count: vnets.length } };
      },
    });

    api.registerTool({
      name: "azure_list_nsgs",
      label: "Azure List NSGs",
      description: "List Azure Network Security Groups",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!networkManager) throw new Error("Network manager not initialized");
        const nsgs = await networkManager.listNSGs(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(nsgs, null, 2) }], details: { count: nsgs.length } };
      },
    });

    api.registerTool({
      name: "azure_list_load_balancers",
      label: "Azure List LBs",
      description: "List Azure Load Balancers",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!networkManager) throw new Error("Network manager not initialized");
        const lbs = await networkManager.listLoadBalancers(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(lbs, null, 2) }], details: { count: lbs.length } };
      },
    });

    api.registerTool({
      name: "azure_list_public_ips",
      label: "Azure List PIPs",
      description: "List Azure Public IP addresses",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!networkManager) throw new Error("Network manager not initialized");
        const pips = await networkManager.listPublicIPs(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(pips, null, 2) }], details: { count: pips.length } };
      },
    });

    api.registerTool({
      name: "azure_list_subnets",
      label: "Azure List Subnets",
      description: "List subnets in a Virtual Network",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, vnetName: { type: "string" } },
        required: ["resourceGroup", "vnetName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!networkManager) throw new Error("Network manager not initialized");
        const subnets = await networkManager.listSubnets(params.resourceGroup as string, params.vnetName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(subnets, null, 2) }], details: { count: subnets.length } };
      },
    });

    api.registerTool({
      name: "azure_list_nsg_rules",
      label: "Azure NSG Rules",
      description: "List security rules in a Network Security Group",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, nsgName: { type: "string" } },
        required: ["resourceGroup", "nsgName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!networkManager) throw new Error("Network manager not initialized");
        const rules = await networkManager.listNSGRules(params.resourceGroup as string, params.nsgName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(rules, null, 2) }], details: { count: rules.length } };
      },
    });

    // --- DNS tools ---
    api.registerTool({
      name: "azure_list_dns_zones",
      label: "Azure DNS Zones",
      description: "List Azure DNS zones",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!dnsManager) throw new Error("DNS manager not initialized");
        const zones = await dnsManager.listZones(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(zones, null, 2) }], details: { count: zones.length } };
      },
    });

    api.registerTool({
      name: "azure_list_dns_records",
      label: "Azure DNS Records",
      description: "List DNS record sets in a zone",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, zoneName: { type: "string" } },
        required: ["resourceGroup", "zoneName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!dnsManager) throw new Error("DNS manager not initialized");
        const records = await dnsManager.listRecordSets(params.resourceGroup as string, params.zoneName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }], details: { count: records.length } };
      },
    });

    // --- Redis tools ---
    api.registerTool({
      name: "azure_list_redis_caches",
      label: "Azure List Redis",
      description: "List Azure Cache for Redis instances",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!redisManager) throw new Error("Redis manager not initialized");
        const caches = await redisManager.listCaches(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(caches, null, 2) }], details: { count: caches.length } };
      },
    });

    api.registerTool({
      name: "azure_get_redis_cache",
      label: "Azure Redis Details",
      description: "Get details of a Redis cache",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, cacheName: { type: "string" } },
        required: ["resourceGroup", "cacheName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!redisManager) throw new Error("Redis manager not initialized");
        const cache = await redisManager.getCache(params.resourceGroup as string, params.cacheName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(cache, null, 2) }], details: cache };
      },
    });

    // --- CDN tools ---
    api.registerTool({
      name: "azure_list_cdn_profiles",
      label: "Azure CDN Profiles",
      description: "List Azure CDN profiles",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!cdnManager) throw new Error("CDN manager not initialized");
        const profiles = await cdnManager.listProfiles(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(profiles, null, 2) }], details: { count: profiles.length } };
      },
    });

    api.registerTool({
      name: "azure_list_cdn_endpoints",
      label: "Azure CDN Endpoints",
      description: "List endpoints for a CDN profile",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, profileName: { type: "string" } },
        required: ["resourceGroup", "profileName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!cdnManager) throw new Error("CDN manager not initialized");
        const endpoints = await cdnManager.listEndpoints(params.resourceGroup as string, params.profileName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }], details: { count: endpoints.length } };
      },
    });

    api.registerTool({
      name: "azure_purge_cdn",
      label: "Azure Purge CDN",
      description: "Purge content from a CDN endpoint",
      parameters: {
        type: "object",
        properties: {
          resourceGroup: { type: "string" },
          profileName: { type: "string" },
          endpointName: { type: "string" },
          contentPaths: { type: "array", description: "Paths to purge, e.g. [\"/images/*\"]" },
        },
        required: ["resourceGroup", "profileName", "endpointName", "contentPaths"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!cdnManager) throw new Error("CDN manager not initialized");
        await cdnManager.purgeContent(params.resourceGroup as string, params.profileName as string, params.endpointName as string, params.contentPaths as string[]);
        return { content: [{ type: "text" as const, text: `Purge initiated for CDN endpoint ${params.endpointName}` }], details: { endpoint: params.endpointName } };
      },
    });

    // --- Backup tools ---
    api.registerTool({
      name: "azure_list_backup_vaults",
      label: "Azure Backup Vaults",
      description: "List Azure Recovery Services vaults",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!backupManager) throw new Error("Backup manager not initialized");
        const vaults = await backupManager.listVaults(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(vaults, null, 2) }], details: { count: vaults.length } };
      },
    });

    api.registerTool({
      name: "azure_list_backup_items",
      label: "Azure Backup Items",
      description: "List backup items in a Recovery Services vault",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, vaultName: { type: "string" } },
        required: ["resourceGroup", "vaultName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!backupManager) throw new Error("Backup manager not initialized");
        const items = await backupManager.listBackupItems(params.resourceGroup as string, params.vaultName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }], details: { count: items.length } };
      },
    });

    api.registerTool({
      name: "azure_list_backup_jobs",
      label: "Azure Backup Jobs",
      description: "List backup jobs in a Recovery Services vault",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, vaultName: { type: "string" } },
        required: ["resourceGroup", "vaultName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!backupManager) throw new Error("Backup manager not initialized");
        const jobs = await backupManager.listBackupJobs(params.resourceGroup as string, params.vaultName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(jobs, null, 2) }], details: { count: jobs.length } };
      },
    });

    // --- Automation tools ---
    api.registerTool({
      name: "azure_list_automation_accounts",
      label: "Azure Automation Accounts",
      description: "List Azure Automation accounts",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!automationManager) throw new Error("Automation manager not initialized");
        const accounts = await automationManager.listAccounts(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }], details: { count: accounts.length } };
      },
    });

    api.registerTool({
      name: "azure_list_runbooks",
      label: "Azure List Runbooks",
      description: "List runbooks in an Automation account",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, accountName: { type: "string" } },
        required: ["resourceGroup", "accountName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!automationManager) throw new Error("Automation manager not initialized");
        const runbooks = await automationManager.listRunbooks(params.resourceGroup as string, params.accountName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(runbooks, null, 2) }], details: { count: runbooks.length } };
      },
    });

    api.registerTool({
      name: "azure_start_runbook",
      label: "Azure Start Runbook",
      description: "Start an Azure Automation runbook",
      parameters: {
        type: "object",
        properties: {
          resourceGroup: { type: "string" },
          accountName: { type: "string" },
          runbookName: { type: "string" },
          parameters: { type: "object", description: "Runbook parameters (key-value pairs)" },
        },
        required: ["resourceGroup", "accountName", "runbookName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!automationManager) throw new Error("Automation manager not initialized");
        const job = await automationManager.startRunbook(
          params.resourceGroup as string,
          params.accountName as string,
          params.runbookName as string,
          params.parameters as Record<string, string> | undefined,
        );
        return { content: [{ type: "text" as const, text: `Started runbook ${params.runbookName}, job: ${job.jobId ?? "pending"}` }], details: job };
      },
    });

    // --- Service Bus tools ---
    api.registerTool({
      name: "azure_list_servicebus_namespaces",
      label: "Azure SB Namespaces",
      description: "List Azure Service Bus namespaces",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!serviceBusManager) throw new Error("ServiceBus manager not initialized");
        const namespaces = await serviceBusManager.listNamespaces(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(namespaces, null, 2) }], details: { count: namespaces.length } };
      },
    });

    api.registerTool({
      name: "azure_list_servicebus_queues",
      label: "Azure SB Queues",
      description: "List queues in a Service Bus namespace",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, namespaceName: { type: "string" } },
        required: ["resourceGroup", "namespaceName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!serviceBusManager) throw new Error("ServiceBus manager not initialized");
        const queues = await serviceBusManager.listQueues(params.resourceGroup as string, params.namespaceName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(queues, null, 2) }], details: { count: queues.length } };
      },
    });

    api.registerTool({
      name: "azure_list_servicebus_topics",
      label: "Azure SB Topics",
      description: "List topics in a Service Bus namespace",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, namespaceName: { type: "string" } },
        required: ["resourceGroup", "namespaceName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!serviceBusManager) throw new Error("ServiceBus manager not initialized");
        const topics = await serviceBusManager.listTopics(params.resourceGroup as string, params.namespaceName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(topics, null, 2) }], details: { count: topics.length } };
      },
    });

    // --- Event Grid tools ---
    api.registerTool({
      name: "azure_list_eventgrid_topics",
      label: "Azure EG Topics",
      description: "List Azure Event Grid topics",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!eventGridManager) throw new Error("EventGrid manager not initialized");
        const topics = await eventGridManager.listTopics(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(topics, null, 2) }], details: { count: topics.length } };
      },
    });

    api.registerTool({
      name: "azure_list_eventgrid_domains",
      label: "Azure EG Domains",
      description: "List Azure Event Grid domains",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!eventGridManager) throw new Error("EventGrid manager not initialized");
        const domains = await eventGridManager.listDomains(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(domains, null, 2) }], details: { count: domains.length } };
      },
    });

    api.registerTool({
      name: "azure_list_event_subscriptions",
      label: "Azure EG Subscriptions",
      description: "List Event Grid event subscriptions",
      parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for event subscriptions" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!eventGridManager) throw new Error("EventGrid manager not initialized");
        const subs = await eventGridManager.listEventSubscriptions(params.scope as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(subs, null, 2) }], details: { count: subs.length } };
      },
    });

    // --- CosmosDB tools ---
    api.registerTool({
      name: "azure_list_cosmosdb_accounts",
      label: "Azure CosmosDB Accounts",
      description: "List Azure Cosmos DB accounts",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!cosmosDBManager) throw new Error("CosmosDB manager not initialized");
        const accounts = await cosmosDBManager.listAccounts(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }], details: { count: accounts.length } };
      },
    });

    api.registerTool({
      name: "azure_list_cosmosdb_databases",
      label: "Azure CosmosDB Databases",
      description: "List databases in a Cosmos DB account",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, accountName: { type: "string" } },
        required: ["resourceGroup", "accountName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!cosmosDBManager) throw new Error("CosmosDB manager not initialized");
        const dbs = await cosmosDBManager.listDatabases(params.resourceGroup as string, params.accountName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(dbs, null, 2) }], details: { count: dbs.length } };
      },
    });

    // --- IAM tools ---
    api.registerTool({
      name: "azure_list_role_definitions",
      label: "Azure IAM Roles",
      description: "List Azure role definitions (RBAC)",
      parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for role definitions" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!iamManager) throw new Error("IAM manager not initialized");
        const roles = await iamManager.listRoleDefinitions(params.scope as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(roles, null, 2) }], details: { count: roles.length } };
      },
    });

    api.registerTool({
      name: "azure_list_role_assignments",
      label: "Azure IAM Assignments",
      description: "List Azure role assignments (RBAC)",
      parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for role assignments" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!iamManager) throw new Error("IAM manager not initialized");
        const assignments = await iamManager.listRoleAssignments(params.scope as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(assignments, null, 2) }], details: { count: assignments.length } };
      },
    });

    // --- Policy tools ---
    api.registerTool({
      name: "azure_list_policy_definitions",
      label: "Azure Policy Defs",
      description: "List Azure Policy definitions",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!policyManager) throw new Error("Policy manager not initialized");
        const defs = await policyManager.listDefinitions();
        return { content: [{ type: "text" as const, text: JSON.stringify(defs, null, 2) }], details: { count: defs.length } };
      },
    });

    api.registerTool({
      name: "azure_list_policy_assignments",
      label: "Azure Policy Assigns",
      description: "List Azure Policy assignments",
      parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for policy assignments" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!policyManager) throw new Error("Policy manager not initialized");
        const assignments = await policyManager.listAssignments(params.scope as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(assignments, null, 2) }], details: { count: assignments.length } };
      },
    });

    api.registerTool({
      name: "azure_policy_compliance",
      label: "Azure Policy Compliance",
      description: "Get Azure Policy compliance state",
      parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for compliance" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!policyManager) throw new Error("Policy manager not initialized");
        const state = await policyManager.getComplianceState(params.scope as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }], details: { count: state.length } };
      },
    });

    // --- Logic Apps tools ---
    api.registerTool({
      name: "azure_list_logic_apps",
      label: "Azure Logic Apps",
      description: "List Azure Logic App workflows",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!logicManager) throw new Error("Logic Apps manager not initialized");
        const workflows = await logicManager.listWorkflows(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(workflows, null, 2) }], details: { count: workflows.length } };
      },
    });

    api.registerTool({
      name: "azure_list_logic_runs",
      label: "Azure Logic Runs",
      description: "List runs for a Logic App workflow",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, workflowName: { type: "string" } },
        required: ["resourceGroup", "workflowName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!logicManager) throw new Error("Logic Apps manager not initialized");
        const runs = await logicManager.listRuns(params.resourceGroup as string, params.workflowName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }], details: { count: runs.length } };
      },
    });

    api.registerTool({
      name: "azure_enable_logic_app",
      label: "Azure Enable Logic App",
      description: "Enable a Logic App workflow",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, workflowName: { type: "string" } },
        required: ["resourceGroup", "workflowName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!logicManager) throw new Error("Logic Apps manager not initialized");
        await logicManager.enableWorkflow(params.resourceGroup as string, params.workflowName as string);
        return { content: [{ type: "text" as const, text: `Enabled Logic App: ${params.workflowName}` }], details: { workflow: params.workflowName } };
      },
    });

    api.registerTool({
      name: "azure_disable_logic_app",
      label: "Azure Disable Logic App",
      description: "Disable a Logic App workflow",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, workflowName: { type: "string" } },
        required: ["resourceGroup", "workflowName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!logicManager) throw new Error("Logic Apps manager not initialized");
        await logicManager.disableWorkflow(params.resourceGroup as string, params.workflowName as string);
        return { content: [{ type: "text" as const, text: `Disabled Logic App: ${params.workflowName}` }], details: { workflow: params.workflowName } };
      },
    });

    // --- API Management tools ---
    api.registerTool({
      name: "azure_list_apim_services",
      label: "Azure APIM Services",
      description: "List Azure API Management services",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!apimManager) throw new Error("APIM manager not initialized");
        const services = await apimManager.listServices(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(services, null, 2) }], details: { count: services.length } };
      },
    });

    api.registerTool({
      name: "azure_list_apim_apis",
      label: "Azure APIM APIs",
      description: "List APIs in an API Management service",
      parameters: {
        type: "object",
        properties: { resourceGroup: { type: "string" }, serviceName: { type: "string" } },
        required: ["resourceGroup", "serviceName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!apimManager) throw new Error("APIM manager not initialized");
        const apis = await apimManager.listAPIs(params.resourceGroup as string, params.serviceName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(apis, null, 2) }], details: { count: apis.length } };
      },
    });

    // --- DevOps tools ---
    api.registerTool({
      name: "azure_list_devops_projects",
      label: "Azure DevOps Projects",
      description: "List Azure DevOps projects",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!devOpsManager) throw new Error("DevOps manager not initialized (set devOpsOrganization in config)");
        const projects = await devOpsManager.listProjects();
        return { content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }], details: { count: projects.length } };
      },
    });

    api.registerTool({
      name: "azure_list_devops_pipelines",
      label: "Azure DevOps Pipelines",
      description: "List pipelines in an Azure DevOps project",
      parameters: {
        type: "object",
        properties: { projectName: { type: "string" } },
        required: ["projectName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!devOpsManager) throw new Error("DevOps manager not initialized");
        const pipelines = await devOpsManager.listPipelines(params.projectName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(pipelines, null, 2) }], details: { count: pipelines.length } };
      },
    });

    api.registerTool({
      name: "azure_trigger_devops_pipeline",
      label: "Azure Run Pipeline",
      description: "Trigger an Azure DevOps pipeline run",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          pipelineId: { type: "number" },
          branch: { type: "string", description: "Branch to run against" },
        },
        required: ["projectName", "pipelineId"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!devOpsManager) throw new Error("DevOps manager not initialized");
        const run = await devOpsManager.triggerPipeline(
          params.projectName as string,
          params.pipelineId as number,
          params.branch ? { branch: params.branch as string } : undefined,
        );
        return { content: [{ type: "text" as const, text: `Pipeline triggered, run ID: ${run.id}` }], details: run };
      },
    });

    api.registerTool({
      name: "azure_list_devops_repos",
      label: "Azure DevOps Repos",
      description: "List repositories in an Azure DevOps project",
      parameters: {
        type: "object",
        properties: { projectName: { type: "string" } },
        required: ["projectName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!devOpsManager) throw new Error("DevOps manager not initialized");
        const repos = await devOpsManager.listRepositories(params.projectName as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(repos, null, 2) }], details: { count: repos.length } };
      },
    });

    // --- PAT management tools ---
    api.registerTool({
      name: "azure_list_pats",
      label: "Azure List PATs",
      description: "List stored Azure DevOps Personal Access Tokens (metadata only, no secrets)",
      parameters: {
        type: "object",
        properties: { organization: { type: "string", description: "Filter by DevOps organization" } },
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!patManager) throw new Error("PAT manager not initialized");
        const pats = patManager.listPATs(params.organization as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(pats, null, 2) }], details: { count: pats.length } };
      },
    });

    api.registerTool({
      name: "azure_store_pat",
      label: "Azure Store PAT",
      description: "Securely store an Azure DevOps Personal Access Token with AES-256-GCM encryption",
      parameters: {
        type: "object",
        properties: {
          token: { type: "string", description: "The PAT value" },
          label: { type: "string", description: "A human-readable label" },
          organization: { type: "string", description: "DevOps organization name" },
          scopes: { type: "array", items: { type: "string" }, description: "PAT scopes" },
          expiresAt: { type: "string", description: "Expiry date (ISO 8601)" },
          validate: { type: "boolean", description: "Validate against DevOps API" },
        },
        required: ["token", "label"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!patManager) throw new Error("PAT manager not initialized");
        const summary = await patManager.storePAT({
          token: params.token as string,
          label: params.label as string,
          organization: params.organization as string | undefined,
          scopes: params.scopes as any,
          expiresAt: params.expiresAt as string | undefined,
          validate: params.validate as boolean | undefined,
        });
        return { content: [{ type: "text" as const, text: `PAT stored: ${summary.label} (${summary.id.slice(0, 8)})` }], details: summary };
      },
    });

    api.registerTool({
      name: "azure_delete_pat",
      label: "Azure Delete PAT",
      description: "Delete a stored Azure DevOps PAT by ID",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "PAT ID to delete" } },
        required: ["id"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!patManager) throw new Error("PAT manager not initialized");
        const deleted = await patManager.deletePAT(params.id as string);
        return { content: [{ type: "text" as const, text: deleted ? "PAT deleted" : "PAT not found" }], details: { deleted } };
      },
    });

    api.registerTool({
      name: "azure_validate_pat",
      label: "Azure Validate PAT",
      description: "Validate a stored PAT against the Azure DevOps API",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "PAT ID to validate" } },
        required: ["id"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!patManager) throw new Error("PAT manager not initialized");
        const result = await patManager.validatePAT(params.id as string);
        return { content: [{ type: "text" as const, text: result.valid ? `Valid — ${result.displayName} (${result.emailAddress})` : `Invalid: ${result.error}` }], details: result };
      },
    });

    api.registerTool({
      name: "azure_rotate_pat",
      label: "Azure Rotate PAT",
      description: "Rotate a stored PAT with a new token value",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "PAT ID to rotate" },
          newToken: { type: "string", description: "New PAT value" },
          newExpiresAt: { type: "string", description: "New expiry date (ISO 8601)" },
        },
        required: ["id", "newToken"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!patManager) throw new Error("PAT manager not initialized");
        const summary = await patManager.rotatePAT(params.id as string, params.newToken as string, params.newExpiresAt as string | undefined);
        return { content: [{ type: "text" as const, text: `PAT rotated: ${summary.label}` }], details: summary };
      },
    });

    api.registerTool({
      name: "azure_get_pat_token",
      label: "Azure Get PAT Token",
      description: "Retrieve the best available PAT token for a DevOps organization (decrypts and returns it)",
      parameters: {
        type: "object",
        properties: { organization: { type: "string", description: "DevOps organization name" } },
        required: ["organization"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!patManager) throw new Error("PAT manager not initialized");
        const token = await patManager.getTokenForOrganization(params.organization as string);
        if (!token) throw new Error(`No valid PAT found for organization: ${params.organization}`);
        return { content: [{ type: "text" as const, text: "PAT token retrieved (contains sensitive data)" }], details: { tokenLength: token.length } };
      },
    });

    api.registerTool({
      name: "azure_check_pat_expiry",
      label: "Azure Check PAT Expiry",
      description: "Check for expired or expiring-soon PATs",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!patManager) throw new Error("PAT manager not initialized");
        const problems = patManager.checkExpiry();
        if (problems.length === 0) return { content: [{ type: "text" as const, text: "All PATs are within expiry limits" }], details: { count: 0 } };
        return { content: [{ type: "text" as const, text: JSON.stringify(problems, null, 2) }], details: { count: problems.length } };
      },
    });

    // --- Security tools (additional) ---
    api.registerTool({
      name: "azure_list_security_recommendations",
      label: "Azure Security Recs",
      description: "List Microsoft Defender for Cloud security recommendations",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!securityManager) throw new Error("Security manager not initialized");
        const recs = await securityManager.listRecommendations();
        return { content: [{ type: "text" as const, text: JSON.stringify(recs, null, 2) }], details: { count: recs.length } };
      },
    });

    api.registerTool({
      name: "azure_get_secure_scores",
      label: "Azure Secure Scores",
      description: "Get Microsoft Defender for Cloud secure scores",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!securityManager) throw new Error("Security manager not initialized");
        const scores = await securityManager.getSecureScores();
        return { content: [{ type: "text" as const, text: JSON.stringify(scores, null, 2) }], details: { count: scores.length } };
      },
    });

    // --- Activity Log tools ---
    api.registerTool({
      name: "azure_get_activity_log",
      label: "Azure Activity Log",
      description: "Get Azure activity log events",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (!activityLogManager) throw new Error("Activity Log manager not initialized");
        const events = await activityLogManager.getEvents();
        return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }], details: { count: events.length } };
      },
    });

    // --- AI tools (additional) ---
    api.registerTool({
      name: "azure_list_ai_accounts",
      label: "Azure AI Accounts",
      description: "List Azure Cognitive Services / OpenAI accounts",
      parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!aiManager) throw new Error("AI manager not initialized");
        const accounts = await aiManager.listAccounts(params.resourceGroup as string | undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }], details: { count: accounts.length } };
      },
    });

    api.registerTool({
      name: "azure_list_ai_models",
      label: "Azure AI Models",
      description: "List available AI models for a location",
      parameters: {
        type: "object",
        properties: { location: { type: "string", description: "Azure region (e.g. eastus)" } },
        required: ["location"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!aiManager) throw new Error("AI manager not initialized");
        const models = await aiManager.listModels(params.location as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(models, null, 2) }], details: { count: models.length } };
      },
    });

    // --- Enterprise/Management Group tools ---
    api.registerTool({
      name: "azure_list_management_groups",
      label: "Azure Mgmt Groups",
      description: "List Azure Management Groups in the tenant hierarchy",
      parameters: { type: "object", properties: {} },
      async execute() {
        // Enterprise manager is not a standalone module variable — use inline construction
        if (!credentialsManager) throw new Error("Azure not initialized");
        const { AzureEnterpriseManager } = await import("./src/enterprise/index.js");
        const enterprise = new AzureEnterpriseManager(credentialsManager, config.defaultSubscription ?? "", config.retryConfig ? { maxAttempts: config.retryConfig.maxAttempts ?? 3, minDelayMs: config.retryConfig.minDelayMs ?? 100, maxDelayMs: config.retryConfig.maxDelayMs ?? 30000 } : undefined);
        const groups = await enterprise.listManagementGroups();
        return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }], details: { count: groups.length } };
      },
    });

    // --- Tagging tools ---
    api.registerTool({
      name: "azure_get_resource_tags",
      label: "Azure Get Tags",
      description: "Get tags on an Azure resource",
      parameters: {
        type: "object",
        properties: { resourceId: { type: "string", description: "Full Azure resource ID" } },
        required: ["resourceId"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!taggingManager) throw new Error("Tagging manager not initialized");
        const tags = await taggingManager.getResourceTags(params.resourceId as string);
        return { content: [{ type: "text" as const, text: JSON.stringify(tags, null, 2) }], details: tags };
      },
    });

    api.registerTool({
      name: "azure_update_resource_tags",
      label: "Azure Update Tags",
      description: "Update tags on an Azure resource",
      parameters: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Full Azure resource ID" },
          tags: { type: "object", description: "Tags to set (key-value pairs)" },
        },
        required: ["resourceId", "tags"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!taggingManager) throw new Error("Tagging manager not initialized");
        await taggingManager.updateResourceTags({ resourceId: params.resourceId as string, action: "merge", tags: params.tags as Record<string, string> });
        return { content: [{ type: "text" as const, text: `Updated tags on ${params.resourceId}` }], details: { resourceId: params.resourceId } };
      },
    });

    api.registerTool({
      name: "azure_validate_tags",
      label: "Azure Validate Tags",
      description: "Validate tags against a tag policy",
      parameters: {
        type: "object",
        properties: { tags: { type: "object", description: "Tags to validate (key-value pairs)" } },
        required: ["tags"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!taggingManager) throw new Error("Tagging manager not initialized");
        const result = await taggingManager.validateTags(params.tags as Record<string, string>);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result };
      },
    });

    // =========================================================================
    // IDIO Orchestration Tools
    // =========================================================================

    api.registerTool({
      name: "azure_list_blueprints",
      label: "Azure List Blueprints",
      description: "List available IDIO orchestration blueprints for multi-resource Azure deployments",
      parameters: { type: "object", properties: {}, required: [] },
      async execute() {
        const blueprints = listBlueprints();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(blueprints, null, 2) }],
          details: { blueprints },
        };
      },
    });

    api.registerTool({
      name: "azure_get_blueprint",
      label: "Azure Get Blueprint",
      description: "Get full details of an IDIO blueprint including its parameters",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Blueprint ID (e.g. web-app-with-sql)" } },
        required: ["id"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const bp = getBlueprint(params.id as string);
        if (!bp) throw new Error(`Blueprint "${params.id}" not found`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: bp.id, name: bp.name, description: bp.description, category: bp.category, parameters: bp.parameters }, null, 2) }],
          details: { id: bp.id, name: bp.name, description: bp.description, category: bp.category, parameters: bp.parameters },
        };
      },
    });

    api.registerTool({
      name: "azure_generate_plan",
      label: "Azure Generate Plan",
      description: "Generate an execution plan from a blueprint with the given parameters",
      parameters: {
        type: "object",
        properties: {
          blueprintId: { type: "string", description: "Blueprint ID" },
          params: { type: "object", description: "Blueprint parameters (projectName, location, etc.)" },
        },
        required: ["blueprintId", "params"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const bp = getBlueprint(params.blueprintId as string);
        if (!bp) throw new Error(`Blueprint "${params.blueprintId}" not found`);
        const plan = bp.generate(params.params as Record<string, unknown>);
        const validation = validatePlan(plan);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ plan: { id: plan.id, name: plan.name, stepCount: plan.steps.length, steps: plan.steps.map((s) => ({ id: s.id, type: s.type, name: s.name, dependsOn: s.dependsOn })) }, validation }, null, 2) }],
          details: { plan, validation },
        };
      },
    });

    api.registerTool({
      name: "azure_validate_plan",
      label: "Azure Validate Plan",
      description: "Validate an IDIO execution plan for correctness (dependency cycles, missing params, etc.)",
      parameters: {
        type: "object",
        properties: { plan: { type: "object", description: "Execution plan object with id, name, steps" } },
        required: ["plan"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const validation = validatePlan(params.plan as any);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(validation, null, 2) }],
          details: validation,
        };
      },
    });

    api.registerTool({
      name: "azure_execute_plan",
      label: "Azure Execute Plan",
      description: "Execute an IDIO orchestration plan (optionally in dry-run mode)",
      parameters: {
        type: "object",
        properties: {
          plan: { type: "object", description: "Execution plan (from azure_generate_plan)" },
          dryRun: { type: "boolean", description: "If true, simulate without creating real resources" },
          maxConcurrency: { type: "number", description: "Max parallel steps (default 4)" },
        },
        required: ["plan"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!orchestrator) throw new Error("Orchestrator not initialized");
        const opts: Partial<OrchestrationOptions> = {};
        if (params.dryRun !== undefined) opts.dryRun = Boolean(params.dryRun);
        if (params.maxConcurrency !== undefined) opts.maxConcurrency = Number(params.maxConcurrency);
        const runner = new Orchestrator({ ...orchestrator["options"], ...opts });
        const result = await runner.execute(params.plan as any);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: result.status, totalDurationMs: result.totalDurationMs, stepCount: result.steps.length, steps: result.steps.map((s) => ({ stepId: s.stepId, status: s.status, durationMs: s.durationMs, error: s.error })), errors: result.errors }, null, 2) }],
          details: result,
        };
      },
    });

    api.registerTool({
      name: "azure_run_blueprint",
      label: "Azure Run Blueprint",
      description: "Generate and execute a blueprint in one step — the primary orchestration command",
      parameters: {
        type: "object",
        properties: {
          blueprintId: { type: "string", description: "Blueprint ID (e.g. web-app-with-sql, api-backend, static-web-with-cdn, microservices-backbone, data-platform)" },
          params: { type: "object", description: "Blueprint parameters" },
          dryRun: { type: "boolean", description: "Simulate without creating resources" },
        },
        required: ["blueprintId", "params"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!orchestrator) throw new Error("Orchestrator not initialized");
        const bp = getBlueprint(params.blueprintId as string);
        if (!bp) throw new Error(`Blueprint "${params.blueprintId}" not found`);
        const plan = bp.generate(params.params as Record<string, unknown>);
        const validation = validatePlan(plan);
        if (!validation.valid) {
          return {
            content: [{ type: "text" as const, text: `Plan validation failed:\n${validation.issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}` }],
            details: { status: "validation-failed", validation },
          };
        }
        const opts: Partial<OrchestrationOptions> = {};
        if (params.dryRun !== undefined) opts.dryRun = Boolean(params.dryRun);
        const runner = new Orchestrator({ ...orchestrator["options"], ...opts });
        const result = await runner.execute(plan);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: result.status, planName: plan.name, totalDurationMs: result.totalDurationMs, steps: result.steps.map((s) => ({ stepId: s.stepId, type: s.stepType, status: s.status, durationMs: s.durationMs, error: s.error })), errors: result.errors }, null, 2) }],
          details: result,
        };
      },
    });

    // =========================================================================
    // Advisor Tools (project analysis + recommendation + deploy)
    // =========================================================================

    api.registerTool({
      name: "azure_analyze_project",
      label: "Azure Analyze Project",
      description: "Scan a project directory to detect language, framework, dependencies, and infrastructure signals. Use this as the first step before recommending Azure services.",
      parameters: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Absolute path to the project directory to analyze" },
        },
        required: ["projectPath"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const analysis = analyzeProject(params.projectPath as string);
        const lines = [
          `Language: ${analysis.language}`,
          `Framework: ${analysis.framework}`,
          `Archetype: ${analysis.archetype}`,
          `Entry point: ${analysis.entryPoint ?? "not detected"}`,
          `Port: ${analysis.port ?? "not detected"}`,
          `Package manager: ${analysis.packageManager ?? "none"}`,
          `Dockerfile: ${analysis.hasDockerfile ? "yes" : "no"}`,
          `Docker Compose: ${analysis.hasDockerCompose ? "yes" : "no"}`,
          `Dependencies with signals: ${analysis.dependencies.length}`,
          `Env vars: ${analysis.envVars.length}`,
          `Tests: ${analysis.hasTests ? "yes" : "no"}`,
          `Confidence: ${Math.round(analysis.confidence * 100)}%`,
          ...analysis.notes.map((n) => `Note: ${n}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: analysis };
      },
    });

    api.registerTool({
      name: "azure_recommend_services",
      label: "Azure Recommend Services",
      description: "Analyze a project and recommend Azure services, matching against IDIO blueprints. Returns service recommendations, best blueprint match, and action items.",
      parameters: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Absolute path to the project directory" },
          region: { type: "string", description: "Preferred Azure region (default: eastus)" },
          projectName: { type: "string", description: "Override project name" },
          preferContainers: { type: "boolean", description: "Prefer container-based deployment over App Service" },
          tenantId: { type: "string", description: "Azure AD tenant ID for Key Vault configuration" },
        },
        required: ["projectPath"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const analysis = analyzeProject(params.projectPath as string);
        const rec = recommend(analysis, {
          defaultRegion: params.region as string | undefined,
          projectName: params.projectName as string | undefined,
          preferContainers: params.preferContainers as boolean | undefined,
          tenantId: params.tenantId as string | undefined,
        });
        const lines: string[] = [rec.summary, "", "--- Services ---"];
        for (const s of rec.services) {
          lines.push(`${s.required ? "[REQUIRED]" : "[optional]"} ${s.service}${s.suggestedSku ? ` (${s.suggestedSku})` : ""} — ${s.reason}`);
        }
        if (rec.blueprint) {
          lines.push("", "--- Blueprint Match ---");
          lines.push(`${rec.blueprint.name} (${Math.round(rec.blueprint.matchScore * 100)}% match)`);
          if (rec.blueprint.missingParams.length > 0) {
            lines.push(`Missing params: ${rec.blueprint.missingParams.join(", ")}`);
          }
        }
        if (rec.alternativeBlueprints.length > 0) {
          lines.push("", "--- Alternatives ---");
          for (const alt of rec.alternativeBlueprints) {
            lines.push(`${alt.name} (${Math.round(alt.matchScore * 100)}% match)`);
          }
        }
        lines.push("", "--- Action Items ---", ...rec.actionItems.map((a) => `• ${a}`));
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: rec };
      },
    });

    api.registerTool({
      name: "azure_analyze_and_deploy",
      label: "Azure Analyze And Deploy",
      description: "End-to-end: analyze a project → recommend Azure services → select blueprint → generate plan → execute. The highest-level deployment command — just point it at a project directory.",
      parameters: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Absolute path to the project directory" },
          region: { type: "string", description: "Preferred Azure region (default: eastus)" },
          projectName: { type: "string", description: "Override project name" },
          preferContainers: { type: "boolean", description: "Prefer container-based deployment" },
          tenantId: { type: "string", description: "Azure AD tenant ID" },
          dryRun: { type: "boolean", description: "Simulate without creating resources (default: true)" },
        },
        required: ["projectPath"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        if (!orchestrator) throw new Error("Orchestrator not initialized");
        const analysis = analyzeProject(params.projectPath as string);
        const options = {
          defaultRegion: params.region as string | undefined,
          projectName: params.projectName as string | undefined,
          preferContainers: params.preferContainers as boolean | undefined,
          tenantId: params.tenantId as string | undefined,
        };
        const { recommendation, plan, validationIssues } = recommendAndPlan(analysis, options);

        const lines: string[] = [recommendation.summary, ""];

        if (!plan) {
          lines.push("Could not generate an execution plan.");
          if (validationIssues.length > 0) {
            lines.push("Issues:", ...validationIssues.map((i) => `  - ${i}`));
          }
          if (recommendation.blueprint?.missingParams.length) {
            lines.push(`\nProvide these parameters to proceed: ${recommendation.blueprint.missingParams.join(", ")}`);
          }
          lines.push("", "--- Action Items ---", ...recommendation.actionItems.map((a) => `• ${a}`));
          return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { recommendation, plan: null, validationIssues } };
        }

        // Execute (or dry-run)
        const dryRun = params.dryRun !== false; // Default to dry-run for safety
        const runner = new Orchestrator({ ...orchestrator["options"], dryRun });
        const result = await runner.execute(plan);

        lines.push(`Execution (${dryRun ? "DRY RUN" : "LIVE"}): ${result.status}`);
        lines.push(`Duration: ${result.totalDurationMs}ms`);
        lines.push(`Steps: ${result.steps.length}`);
        for (const s of result.steps) {
          const icon = (s.status as string) === "completed" ? "✓" : (s.status as string) === "failed" ? "✗" : "○";
          lines.push(`  ${icon} ${s.stepName} [${s.stepType}] — ${s.durationMs}ms${s.error ? ` ERROR: ${s.error}` : ""}`);
        }
        if (result.errors.length > 0) {
          lines.push("", "Errors:", ...result.errors.map((e) => `  - ${e}`));
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { recommendation, plan, result, dryRun },
        };
      },
    });

    // =========================================================================
    // Service Lifecycle
    // =========================================================================
    api.registerService({
      id: "azure-core-services",
      async start() {
        const log = pluginLogger ?? { info: console.log, warn: console.warn, error: console.error };
        log.info("[Azure] Initializing Azure managers");

        const subscriptionId = config.defaultSubscription ?? "";
        const retryOpts = config.retryConfig
          ? { maxAttempts: config.retryConfig.maxAttempts ?? 3, minDelayMs: config.retryConfig.minDelayMs ?? 100, maxDelayMs: config.retryConfig.maxDelayMs ?? 30000 }
          : undefined;

        // Initialize credentials
        credentialsManager = createCredentialsManager({
          defaultSubscription: subscriptionId,
          defaultTenantId: config.defaultTenantId,
          credentialMethod: (config.credentialMethod as any) ?? "default",
        });
        await credentialsManager.initialize();

        cliWrapper = createCLIWrapper();
        contextManager = new AzureContextManager(credentialsManager, config.defaultRegion);
        serviceDiscovery = new AzureServiceDiscovery(credentialsManager, subscriptionId);
        taggingManager = new AzureTaggingManager(credentialsManager, subscriptionId);
        activityLogManager = new AzureActivityLogManager(credentialsManager, subscriptionId);

        // Compute
        vmManager = new AzureVMManager(credentialsManager, subscriptionId, config.defaultRegion, retryOpts);
        functionsManager = new AzureFunctionsManager(credentialsManager, subscriptionId, retryOpts);
        containerManager = new AzureContainerManager(credentialsManager, subscriptionId, retryOpts);

        // Data
        storageManager = new AzureStorageManager(credentialsManager, subscriptionId, retryOpts);
        sqlManager = new AzureSQLManager(credentialsManager, subscriptionId, retryOpts);
        cosmosDBManager = new AzureCosmosDBManager(credentialsManager, subscriptionId, retryOpts);
        redisManager = new AzureRedisManager(credentialsManager, subscriptionId, retryOpts);

        // Networking
        networkManager = new AzureNetworkManager(credentialsManager, subscriptionId, retryOpts);
        dnsManager = new AzureDNSManager(credentialsManager, subscriptionId, retryOpts);
        cdnManager = new AzureCDNManager(credentialsManager, subscriptionId, retryOpts);

        // Security & Identity
        keyVaultManager = new AzureKeyVaultManager(credentialsManager, subscriptionId, retryOpts);
        iamManager = new AzureIAMManager(credentialsManager, subscriptionId, retryOpts);
        securityManager = new AzureSecurityManager(credentialsManager, subscriptionId, retryOpts);
        policyManager = new AzurePolicyManager(credentialsManager, subscriptionId, retryOpts);

        // Operations
        monitorManager = new AzureMonitorManager(credentialsManager, subscriptionId, retryOpts);
        costManager = new AzureCostManager(credentialsManager, subscriptionId, retryOpts);
        backupManager = new AzureBackupManager(credentialsManager, subscriptionId, retryOpts);
        automationManager = new AzureAutomationManager(credentialsManager, subscriptionId, retryOpts);

        // Messaging
        serviceBusManager = new AzureServiceBusManager(credentialsManager, subscriptionId, retryOpts);
        eventGridManager = new AzureEventGridManager(credentialsManager, subscriptionId, retryOpts);

        // AI
        aiManager = new AzureAIManager(credentialsManager, subscriptionId, retryOpts);

        // Platform
        resourceManager = new AzureResourceManager(credentialsManager, subscriptionId, retryOpts);
        subscriptionManager = new AzureSubscriptionManager(credentialsManager, retryOpts);
        logicManager = new AzureLogicAppsManager(credentialsManager, subscriptionId, retryOpts);
        apimManager = new AzureAPIManagementManager(credentialsManager, subscriptionId, retryOpts);

        // DevOps (requires organization)
        if (config.devOpsOrganization) {
          devOpsManager = new AzureDevOpsManager(credentialsManager, config.devOpsOrganization, retryOpts);
        }

        // PAT Manager (always available — stores encrypted PATs locally)
        patManager = createPATManager({ defaultOrganization: config.devOpsOrganization });
        await patManager.initialize();

        // Governance
        guardrailsManager = createGuardrailsManager();
        complianceManager = new AzureComplianceManager(credentialsManager, subscriptionId, retryOpts);

        // Orchestration (IDIO)
        clearStepRegistry();
        registerBuiltinSteps(
          () => resourceManager!,
          () => storageManager!,
        );
        orchestrator = new Orchestrator({
          globalTags: Object.fromEntries(
            (config.defaultTags ?? []).map((t: { key: string; value: string }) => [t.key, t.value]),
          ),
        });

        // Optionally probe identity
        try {
          await contextManager.initialize();
        } catch {
          // Credentials may not be available at start
        }

        log.info("[Azure] Azure Core Services started");
      },

      async stop() {
        if (credentialsManager) {
          credentialsManager.clearCache();
        }
        credentialsManager = null;
        cliWrapper = null;
        contextManager = null;
        serviceDiscovery = null;
        taggingManager = null;
        activityLogManager = null;
        vmManager = null;
        functionsManager = null;
        containerManager = null;
        storageManager = null;
        sqlManager = null;
        cosmosDBManager = null;
        networkManager = null;
        keyVaultManager = null;
        monitorManager = null;
        iamManager = null;
        costManager = null;
        serviceBusManager = null;
        eventGridManager = null;
        dnsManager = null;
        redisManager = null;
        cdnManager = null;
        securityManager = null;
        policyManager = null;
        backupManager = null;
        aiManager = null;
        devOpsManager = null;
        patManager = null;
        apimManager = null;
        logicManager = null;
        resourceManager = null;
        subscriptionManager = null;
        guardrailsManager = null;
        complianceManager = null;
        automationManager = null;
        orchestrator = null;
        clearStepRegistry();
        pluginLogger?.info("[Azure] Azure Core Services stopped");
      },
    });

    api.logger.info("[Azure] Azure extension registered successfully");
  },
};

export default plugin;

/**
 * Get the global Azure managers for programmatic access
 */
export function getAzureManagers() {
  return {
    credentials: credentialsManager,
    cli: cliWrapper,
    context: contextManager,
    serviceDiscovery,
    tagging: taggingManager,
    activityLog: activityLogManager,
    vm: vmManager,
    functions: functionsManager,
    containers: containerManager,
    storage: storageManager,
    sql: sqlManager,
    cosmosDB: cosmosDBManager,
    network: networkManager,
    keyVault: keyVaultManager,
    monitor: monitorManager,
    iam: iamManager,
    cost: costManager,
    serviceBus: serviceBusManager,
    eventGrid: eventGridManager,
    dns: dnsManager,
    redis: redisManager,
    cdn: cdnManager,
    security: securityManager,
    policy: policyManager,
    backup: backupManager,
    ai: aiManager,
    devOps: devOpsManager,
    pat: patManager,
    apim: apimManager,
    logic: logicManager,
    resources: resourceManager,
    subscriptions: subscriptionManager,
    guardrails: guardrailsManager,
    compliance: complianceManager,
    automation: automationManager,
    orchestrator,
  };
}
