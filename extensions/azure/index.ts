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
import { AzureDevOpsManager } from "./src/devops/index.js";
import { AzureAPIManagementManager } from "./src/apimanagement/index.js";
import { AzureLogicAppsManager } from "./src/logic/index.js";
import { AzureResourceManager } from "./src/resources/index.js";
import { AzureSubscriptionManager } from "./src/subscriptions/index.js";
import { AzureGuardrailsManager, createGuardrailsManager } from "./src/guardrails/index.js";
import { AzureComplianceManager } from "./src/compliance/index.js";
import { AzureAutomationManager } from "./src/automation/index.js";

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
let apimManager: AzureAPIManagementManager | null = null;
let logicManager: AzureLogicAppsManager | null = null;
let resourceManager: AzureResourceManager | null = null;
let subscriptionManager: AzureSubscriptionManager | null = null;
let guardrailsManager: AzureGuardrailsManager | null = null;
let complianceManager: AzureComplianceManager | null = null;
let automationManager: AzureAutomationManager | null = null;

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

        // Governance
        guardrailsManager = createGuardrailsManager();
        complianceManager = new AzureComplianceManager(credentialsManager, subscriptionId, retryOpts);

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
        apimManager = null;
        logicManager = null;
        resourceManager = null;
        subscriptionManager = null;
        guardrailsManager = null;
        complianceManager = null;
        automationManager = null;
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
    apim: apimManager,
    logic: logicManager,
    resources: resourceManager,
    subscriptions: subscriptionManager,
    guardrails: guardrailsManager,
    compliance: complianceManager,
    automation: automationManager,
  };
}
