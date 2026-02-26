/**
 * Azure agent tool registrations.
 *
 * Extracted from the monolithic index.ts. Each tool reads manager instances
 * from the shared AzurePluginState, which is populated during service start().
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import type { AzurePluginState } from "./plugin-state.js";
import type { AzurePagedResult } from "./types.js";
import { validatePagination } from "./pagination.js";
import { Orchestrator, listBlueprints, getBlueprint, validatePlan } from "./orchestration/index.js";
import type { OrchestrationOptions } from "./orchestration/index.js";
import { analyzeProject, recommend, recommendAndPlan, createPromptSession, resolveParams, verify, formatReport } from "./advisor/index.js";
import type { PromptSession, PromptAnswers } from "./advisor/index.js";

export function registerAgentTools(api: EspadaPluginApi, state: AzurePluginState): void {
  // =========================================================================
  // Agent Tools
  // =========================================================================
  api.registerTool({
    name: "azure_list_vms",
    label: "Azure List VMs",
    description: "List Azure virtual machines, optionally filtered by resource group. Supports pagination via limit/offset.",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" }, limit: { type: "number", description: "Max items to return" }, offset: { type: "number", description: "Items to skip" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.vmManager) throw new Error("VM manager not initialized");
      const rg = params.resourceGroup as string | undefined;
      const limit = params.limit as number | undefined;
      const offset = params.offset as number | undefined;
      validatePagination({ limit, offset });
      const opts = rg ? { resourceGroup: rg } : {};
      if (limit !== undefined) {
        const result = await state.vmManager.listVMs({ ...opts, limit, offset }) as AzurePagedResult<import("./vms/types.js").VMInstance>;
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { count: result.items.length, hasMore: result.hasMore } };
      }
      const vms = await state.vmManager.listVMs(rg ? { resourceGroup: rg } : undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(vms, null, 2) }], details: { count: vms.length } };
    },
  });

  api.registerTool({
    name: "azure_start_vm",
    label: "Azure Start VM",
    description: "Start an Azure virtual machine",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" }, vmName: { type: "string" } }, required: ["resourceGroup", "vmName"] },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.vmManager) throw new Error("VM manager not initialized");
      const result = await state.vmManager.startVM(params.resourceGroup as string, params.vmName as string);
      return { content: [{ type: "text" as const, text: `Started VM: ${params.vmName}` }], details: result };
    },
  });

  api.registerTool({
    name: "azure_stop_vm",
    label: "Azure Stop VM",
    description: "Stop an Azure virtual machine",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" }, vmName: { type: "string" } }, required: ["resourceGroup", "vmName"] },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.vmManager) throw new Error("VM manager not initialized");
      const result = await state.vmManager.stopVM(params.resourceGroup as string, params.vmName as string);
      return { content: [{ type: "text" as const, text: `Stopped VM: ${params.vmName}` }], details: result };
    },
  });

  api.registerTool({
    name: "azure_list_storage_accounts",
    label: "Azure List Storage",
    description: "List Azure Storage accounts. Supports pagination via limit/offset.",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" }, limit: { type: "number", description: "Max items to return" }, offset: { type: "number", description: "Items to skip" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.storageManager) throw new Error("Storage manager not initialized");
      const rg = params.resourceGroup as string | undefined;
      const limit = params.limit as number | undefined;
      const offset = params.offset as number | undefined;
      validatePagination({ limit, offset });
      if (limit !== undefined) {
        const result = await state.storageManager.listStorageAccounts(rg, { limit, offset }) as AzurePagedResult<import("./storage/types.js").StorageAccount>;
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { count: result.items.length, hasMore: result.hasMore } };
      }
      const accounts = await state.storageManager.listStorageAccounts(rg);
      return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }], details: { count: accounts.length } };
    },
  });

  api.registerTool({
    name: "azure_list_containers",
    label: "Azure List Containers",
    description: "List containers in a storage account",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" }, accountName: { type: "string" } }, required: ["resourceGroup", "accountName"] },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.storageManager) throw new Error("Storage manager not initialized");
      const containers = await state.storageManager.listContainers(params.resourceGroup as string, params.accountName as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(containers, null, 2) }], details: { count: containers.length } };
    },
  });

  api.registerTool({
    name: "azure_list_resource_groups",
    label: "Azure List Resource Groups",
    description: "List Azure resource groups. Supports pagination via limit/offset.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "Max items to return" }, offset: { type: "number", description: "Items to skip" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.resourceManager) throw new Error("Resource manager not initialized");
      const limit = params.limit as number | undefined;
      const offset = params.offset as number | undefined;
      validatePagination({ limit, offset });
      if (limit !== undefined) {
        const result = await state.resourceManager.listResourceGroups({ limit, offset }) as AzurePagedResult<import("./resources/types.js").ResourceGroup>;
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { count: result.items.length, hasMore: result.hasMore } };
      }
      const groups = await state.resourceManager.listResourceGroups();
      return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }], details: { count: groups.length } };
    },
  });

  api.registerTool({
    name: "azure_list_functions",
    label: "Azure List Functions",
    description: "List Azure Function Apps",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.functionsManager) throw new Error("Functions manager not initialized");
      const apps = await state.functionsManager.listFunctionApps(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(apps, null, 2) }], details: { count: apps.length } };
    },
  });

  api.registerTool({
    name: "azure_list_aks_clusters",
    label: "Azure List AKS",
    description: "List AKS clusters",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.containerManager) throw new Error("Container manager not initialized");
      const clusters = await state.containerManager.listAKSClusters(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(clusters, null, 2) }], details: { count: clusters.length } };
    },
  });

  api.registerTool({
    name: "azure_list_sql_servers",
    label: "Azure List SQL",
    description: "List Azure SQL servers",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.sqlManager) throw new Error("SQL manager not initialized");
      const servers = await state.sqlManager.listServers(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }], details: { count: servers.length } };
    },
  });

  api.registerTool({
    name: "azure_list_keyvaults",
    label: "Azure List KeyVaults",
    description: "List Azure Key Vaults",
    parameters: { type: "object", properties: { resourceGroup: { type: "string" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.keyVaultManager) throw new Error("KeyVault manager not initialized");
      const vaults = await state.keyVaultManager.listVaults(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(vaults, null, 2) }], details: { count: vaults.length } };
    },
  });

  api.registerTool({
    name: "azure_query_costs",
    label: "Azure Query Costs",
    description: "Query Azure cost data",
    parameters: { type: "object", properties: { timeframe: { type: "string", description: "MonthToDate, BillingMonthToDate, etc." } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.costManager) throw new Error("Cost manager not initialized");
      const result = await state.costManager.queryCosts({ timeframe: params.timeframe as string | undefined });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { rows: result.rows.length } };
    },
  });

  api.registerTool({
    name: "azure_list_subscriptions",
    label: "Azure List Subscriptions",
    description: "List Azure subscriptions",
    parameters: { type: "object", properties: {} },
    async execute() {
      if (!state.subscriptionManager) throw new Error("Subscription manager not initialized");
      const subs = await state.subscriptionManager.listSubscriptions();
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
      if (!state.monitorManager) throw new Error("Monitor manager not initialized");
      const metrics = await state.monitorManager.listMetrics(params.resourceUri as string, params.metrics as string[], {
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
      if (!state.securityManager) throw new Error("Security manager not initialized");
      const alerts = await state.securityManager.listAlerts();
      return { content: [{ type: "text" as const, text: JSON.stringify(alerts, null, 2) }], details: { count: alerts.length } };
    },
  });

  api.registerTool({
    name: "azure_compliance_report",
    label: "Azure Compliance Report",
    description: "Generate Azure compliance report",
    parameters: { type: "object", properties: {} },
    async execute() {
      if (!state.complianceManager) throw new Error("Compliance manager not initialized");
      const report = await state.complianceManager.generateReport();
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
      if (!state.resourceManager) throw new Error("Resource manager not initialized");
      const deployment = await state.resourceManager.createDeployment(
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
      if (!state.aiManager) throw new Error("AI manager not initialized");
      const deployments = await state.aiManager.listDeployments(params.resourceGroup as string, params.accountName as string);
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
      if (!state.networkManager) throw new Error("Network manager not initialized");
      const vnets = await state.networkManager.listVNets(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(vnets, null, 2) }], details: { count: vnets.length } };
    },
  });

  api.registerTool({
    name: "azure_list_nsgs",
    label: "Azure List NSGs",
    description: "List Azure Network Security Groups",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.networkManager) throw new Error("Network manager not initialized");
      const nsgs = await state.networkManager.listNSGs(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(nsgs, null, 2) }], details: { count: nsgs.length } };
    },
  });

  api.registerTool({
    name: "azure_list_load_balancers",
    label: "Azure List LBs",
    description: "List Azure Load Balancers",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.networkManager) throw new Error("Network manager not initialized");
      const lbs = await state.networkManager.listLoadBalancers(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(lbs, null, 2) }], details: { count: lbs.length } };
    },
  });

  api.registerTool({
    name: "azure_list_public_ips",
    label: "Azure List PIPs",
    description: "List Azure Public IP addresses",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.networkManager) throw new Error("Network manager not initialized");
      const pips = await state.networkManager.listPublicIPs(params.resourceGroup as string | undefined);
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
      if (!state.networkManager) throw new Error("Network manager not initialized");
      const subnets = await state.networkManager.listSubnets(params.resourceGroup as string, params.vnetName as string);
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
      if (!state.networkManager) throw new Error("Network manager not initialized");
      const rules = await state.networkManager.listNSGRules(params.resourceGroup as string, params.nsgName as string);
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
      if (!state.dnsManager) throw new Error("DNS manager not initialized");
      const zones = await state.dnsManager.listZones(params.resourceGroup as string | undefined);
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
      if (!state.dnsManager) throw new Error("DNS manager not initialized");
      const records = await state.dnsManager.listRecordSets(params.resourceGroup as string, params.zoneName as string);
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
      if (!state.redisManager) throw new Error("Redis manager not initialized");
      const caches = await state.redisManager.listCaches(params.resourceGroup as string | undefined);
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
      if (!state.redisManager) throw new Error("Redis manager not initialized");
      const cache = await state.redisManager.getCache(params.resourceGroup as string, params.cacheName as string);
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
      if (!state.cdnManager) throw new Error("CDN manager not initialized");
      const profiles = await state.cdnManager.listProfiles(params.resourceGroup as string | undefined);
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
      if (!state.cdnManager) throw new Error("CDN manager not initialized");
      const endpoints = await state.cdnManager.listEndpoints(params.resourceGroup as string, params.profileName as string);
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
      if (!state.cdnManager) throw new Error("CDN manager not initialized");
      await state.cdnManager.purgeContent(params.resourceGroup as string, params.profileName as string, params.endpointName as string, params.contentPaths as string[]);
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
      if (!state.backupManager) throw new Error("Backup manager not initialized");
      const vaults = await state.backupManager.listVaults(params.resourceGroup as string | undefined);
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
      if (!state.backupManager) throw new Error("Backup manager not initialized");
      const items = await state.backupManager.listBackupItems(params.resourceGroup as string, params.vaultName as string);
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
      if (!state.backupManager) throw new Error("Backup manager not initialized");
      const jobs = await state.backupManager.listBackupJobs(params.resourceGroup as string, params.vaultName as string);
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
      if (!state.automationManager) throw new Error("Automation manager not initialized");
      const accounts = await state.automationManager.listAccounts(params.resourceGroup as string | undefined);
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
      if (!state.automationManager) throw new Error("Automation manager not initialized");
      const runbooks = await state.automationManager.listRunbooks(params.resourceGroup as string, params.accountName as string);
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
      if (!state.automationManager) throw new Error("Automation manager not initialized");
      const job = await state.automationManager.startRunbook(
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
      if (!state.serviceBusManager) throw new Error("ServiceBus manager not initialized");
      const namespaces = await state.serviceBusManager.listNamespaces(params.resourceGroup as string | undefined);
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
      if (!state.serviceBusManager) throw new Error("ServiceBus manager not initialized");
      const queues = await state.serviceBusManager.listQueues(params.resourceGroup as string, params.namespaceName as string);
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
      if (!state.serviceBusManager) throw new Error("ServiceBus manager not initialized");
      const topics = await state.serviceBusManager.listTopics(params.resourceGroup as string, params.namespaceName as string);
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
      if (!state.eventGridManager) throw new Error("EventGrid manager not initialized");
      const topics = await state.eventGridManager.listTopics(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(topics, null, 2) }], details: { count: topics.length } };
    },
  });

  api.registerTool({
    name: "azure_list_eventgrid_domains",
    label: "Azure EG Domains",
    description: "List Azure Event Grid domains",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.eventGridManager) throw new Error("EventGrid manager not initialized");
      const domains = await state.eventGridManager.listDomains(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(domains, null, 2) }], details: { count: domains.length } };
    },
  });

  api.registerTool({
    name: "azure_list_event_subscriptions",
    label: "Azure EG Subscriptions",
    description: "List Event Grid event subscriptions",
    parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for event subscriptions" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.eventGridManager) throw new Error("EventGrid manager not initialized");
      const subs = await state.eventGridManager.listEventSubscriptions(params.scope as string | undefined);
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
      if (!state.cosmosDBManager) throw new Error("CosmosDB manager not initialized");
      const accounts = await state.cosmosDBManager.listAccounts(params.resourceGroup as string | undefined);
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
      if (!state.cosmosDBManager) throw new Error("CosmosDB manager not initialized");
      const dbs = await state.cosmosDBManager.listDatabases(params.resourceGroup as string, params.accountName as string);
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
      if (!state.iamManager) throw new Error("IAM manager not initialized");
      const roles = await state.iamManager.listRoleDefinitions(params.scope as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(roles, null, 2) }], details: { count: roles.length } };
    },
  });

  api.registerTool({
    name: "azure_list_role_assignments",
    label: "Azure IAM Assignments",
    description: "List Azure role assignments (RBAC)",
    parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for role assignments" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.iamManager) throw new Error("IAM manager not initialized");
      const assignments = await state.iamManager.listRoleAssignments(params.scope as string | undefined);
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
      if (!state.policyManager) throw new Error("Policy manager not initialized");
      const defs = await state.policyManager.listDefinitions();
      return { content: [{ type: "text" as const, text: JSON.stringify(defs, null, 2) }], details: { count: defs.length } };
    },
  });

  api.registerTool({
    name: "azure_list_policy_assignments",
    label: "Azure Policy Assigns",
    description: "List Azure Policy assignments",
    parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for policy assignments" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.policyManager) throw new Error("Policy manager not initialized");
      const assignments = await state.policyManager.listAssignments(params.scope as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(assignments, null, 2) }], details: { count: assignments.length } };
    },
  });

  api.registerTool({
    name: "azure_policy_compliance",
    label: "Azure Policy Compliance",
    description: "Get Azure Policy compliance state",
    parameters: { type: "object", properties: { scope: { type: "string", description: "Scope for compliance" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.policyManager) throw new Error("Policy manager not initialized");
      const complianceState = await state.policyManager.getComplianceState(params.scope as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(complianceState, null, 2) }], details: { count: complianceState.length } };
    },
  });

  // --- Logic Apps tools ---
  api.registerTool({
    name: "azure_list_logic_apps",
    label: "Azure Logic Apps",
    description: "List Azure Logic App workflows",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.logicManager) throw new Error("Logic Apps manager not initialized");
      const workflows = await state.logicManager.listWorkflows(params.resourceGroup as string | undefined);
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
      if (!state.logicManager) throw new Error("Logic Apps manager not initialized");
      const runs = await state.logicManager.listRuns(params.resourceGroup as string, params.workflowName as string);
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
      if (!state.logicManager) throw new Error("Logic Apps manager not initialized");
      await state.logicManager.enableWorkflow(params.resourceGroup as string, params.workflowName as string);
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
      if (!state.logicManager) throw new Error("Logic Apps manager not initialized");
      await state.logicManager.disableWorkflow(params.resourceGroup as string, params.workflowName as string);
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
      if (!state.apimManager) throw new Error("APIM manager not initialized");
      const services = await state.apimManager.listServices(params.resourceGroup as string | undefined);
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
      if (!state.apimManager) throw new Error("APIM manager not initialized");
      const apis = await state.apimManager.listAPIs(params.resourceGroup as string, params.serviceName as string);
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
      if (!state.devOpsManager) throw new Error("DevOps manager not initialized (set devOpsOrganization in config)");
      const projects = await state.devOpsManager.listProjects();
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
      if (!state.devOpsManager) throw new Error("DevOps manager not initialized");
      const pipelines = await state.devOpsManager.listPipelines(params.projectName as string);
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
      if (!state.devOpsManager) throw new Error("DevOps manager not initialized");
      const run = await state.devOpsManager.triggerPipeline(
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
      if (!state.devOpsManager) throw new Error("DevOps manager not initialized");
      const repos = await state.devOpsManager.listRepositories(params.projectName as string);
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const pats = state.patManager.listPATs(params.organization as string | undefined);
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const summary = await state.patManager.storePAT({
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const deleted = await state.patManager.deletePAT(params.id as string);
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const result = await state.patManager.validatePAT(params.id as string);
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const summary = await state.patManager.rotatePAT(params.id as string, params.newToken as string, params.newExpiresAt as string | undefined);
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const token = await state.patManager.getTokenForOrganization(params.organization as string);
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
      if (!state.patManager) throw new Error("PAT manager not initialized");
      const problems = state.patManager.checkExpiry();
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
      if (!state.securityManager) throw new Error("Security manager not initialized");
      const recs = await state.securityManager.listRecommendations();
      return { content: [{ type: "text" as const, text: JSON.stringify(recs, null, 2) }], details: { count: recs.length } };
    },
  });

  api.registerTool({
    name: "azure_get_secure_scores",
    label: "Azure Secure Scores",
    description: "Get Microsoft Defender for Cloud secure scores",
    parameters: { type: "object", properties: {} },
    async execute() {
      if (!state.securityManager) throw new Error("Security manager not initialized");
      const scores = await state.securityManager.getSecureScores();
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
      if (!state.activityLogManager) throw new Error("Activity Log manager not initialized");
      const events = await state.activityLogManager.getEvents();
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
      if (!state.aiManager) throw new Error("AI manager not initialized");
      const accounts = await state.aiManager.listAccounts(params.resourceGroup as string | undefined);
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
      if (!state.aiManager) throw new Error("AI manager not initialized");
      const models = await state.aiManager.listModels(params.location as string);
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
      if (!state.credentialsManager) throw new Error("Azure not initialized");
      const { AzureEnterpriseManager } = await import("./enterprise/index.js");
      const retryOpts = state.config.retryConfig
        ? { maxAttempts: state.config.retryConfig.maxAttempts ?? 3, minDelayMs: state.config.retryConfig.minDelayMs ?? 100, maxDelayMs: state.config.retryConfig.maxDelayMs ?? 30000 }
        : undefined;
      const enterprise = new AzureEnterpriseManager(state.credentialsManager, state.config.defaultSubscription ?? "", retryOpts);
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
      if (!state.taggingManager) throw new Error("Tagging manager not initialized");
      const tags = await state.taggingManager.getResourceTags(params.resourceId as string);
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
      if (!state.taggingManager) throw new Error("Tagging manager not initialized");
      await state.taggingManager.updateResourceTags({ resourceId: params.resourceId as string, action: "merge", tags: params.tags as Record<string, string> });
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
      if (!state.taggingManager) throw new Error("Tagging manager not initialized");
      const result = await state.taggingManager.validateTags(params.tags as Record<string, string>);
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
      if (!state.orchestrator) throw new Error("Orchestrator not initialized");
      const opts: Partial<OrchestrationOptions> = {};
      if (params.dryRun !== undefined) opts.dryRun = Boolean(params.dryRun);
      if (params.maxConcurrency !== undefined) opts.maxConcurrency = Number(params.maxConcurrency);
      const runner = new Orchestrator({ ...state.orchestrator["options"], ...opts });
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
      if (!state.orchestrator) throw new Error("Orchestrator not initialized");
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
      const runner = new Orchestrator({ ...state.orchestrator["options"], ...opts });
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
      if (!state.orchestrator) throw new Error("Orchestrator not initialized");
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
      const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun });
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
  // Prompter Tools (interactive parameter prompting)
  // =========================================================================

  api.registerTool({
    name: "azure_prompt_params",
    label: "Azure Prompt Parameters",
    description: "Analyze a project, match a blueprint, and identify missing parameters that the user needs to supply. Returns structured questions with hints, choices, and defaults. Call this when a deploy attempt fails due to missing params, or before deploy to ensure all inputs are ready.",
    parameters: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the project directory" },
        region: { type: "string", description: "Preferred Azure region (default: eastus)" },
        projectName: { type: "string", description: "Override project name" },
        preferContainers: { type: "boolean", description: "Prefer container-based deployment" },
        tenantId: { type: "string", description: "Azure AD tenant ID" },
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
      const session = createPromptSession(rec);
      if (!session) {
        return { content: [{ type: "text" as const, text: "No blueprint matched the project — cannot determine required parameters." }], details: { session: null } };
      }
      if (session.ready) {
        return {
          content: [{ type: "text" as const, text: `All parameters inferred for blueprint "${session.blueprintName}". Ready to deploy.\n\nInferred: ${JSON.stringify(session.inferredParams, null, 2)}` }],
          details: { session, ready: true },
        };
      }
      const lines: string[] = [
        `Blueprint: ${session.blueprintName}`,
        session.message,
        "",
        "--- Questions ---",
      ];
      for (const q of session.questions) {
        lines.push(`[${q.required ? "REQUIRED" : "optional"}] ${q.param} (${q.type}): ${q.question}`);
        if (q.hint) lines.push(`  Hint: ${q.hint}`);
        if (q.choices) lines.push(`  Choices: ${q.choices.join(", ")}`);
        if (q.default !== undefined) lines.push(`  Default: ${String(q.default)}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { session, ready: false } };
    },
  });

  api.registerTool({
    name: "azure_provide_answers",
    label: "Azure Provide Answers",
    description: "Supply answers to the parameter questions generated by azure_prompt_params. Pass the session object (from the previous call's details) along with user-provided answers to resolve all parameters and prepare for deployment.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "object", description: "The PromptSession object from azure_prompt_params details" },
        answers: { type: "object", description: "Key-value map of parameter answers (e.g. {tenantId: '...', sqlAdminPassword: '...'})" },
      },
      required: ["session", "answers"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const session = params.session as PromptSession;
      const answers = (params.answers ?? {}) as PromptAnswers;
      const resolved = resolveParams(session, answers);
      if (resolved.valid) {
        return {
          content: [{ type: "text" as const, text: `All parameters resolved for blueprint "${session.blueprintName}". Ready to deploy.\n\nResolved: ${JSON.stringify(resolved.params, null, 2)}` }],
          details: { resolved, ready: true },
        };
      }
      const lines = [
        `Still missing ${resolved.stillMissing.length} parameter(s): ${resolved.stillMissing.join(", ")}`,
        "",
        "Resolved so far:",
        JSON.stringify(resolved.params, null, 2),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { resolved, ready: false } };
    },
  });

  // =========================================================================
  // Verifier Tools (post-deploy health checks)
  // =========================================================================

  api.registerTool({
    name: "azure_verify_deployment",
    label: "Azure Verify Deployment",
    description: "Run post-deploy health checks against a deployment result. Checks orchestration status, step completion, resource outputs, cross-cutting concerns (monitoring, secrets, networking), and optionally connectivity probes. Returns a health score and remediation guidance.",
    parameters: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the project directory" },
        region: { type: "string", description: "Preferred Azure region (default: eastus)" },
        projectName: { type: "string", description: "Override project name" },
        preferContainers: { type: "boolean", description: "Prefer container-based deployment" },
        tenantId: { type: "string", description: "Azure AD tenant ID" },
        dryRun: { type: "boolean", description: "Simulate without creating resources (default: true)" },
        skipProbes: { type: "boolean", description: "Skip connectivity probes" },
      },
      required: ["projectPath"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.orchestrator) throw new Error("Orchestrator not initialized");
      const analysis = analyzeProject(params.projectPath as string);
      const options = {
        defaultRegion: params.region as string | undefined,
        projectName: params.projectName as string | undefined,
        preferContainers: params.preferContainers as boolean | undefined,
        tenantId: params.tenantId as string | undefined,
      };
      const { recommendation, plan, validationIssues } = recommendAndPlan(analysis, options);

      if (!plan) {
        return {
          content: [{ type: "text" as const, text: "Could not generate an execution plan — verification requires a deployed plan." }],
          details: { recommendation, plan: null, validationIssues, verified: false },
        };
      }

      const dryRun = params.dryRun !== false;
      const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun });
      const result = await runner.execute(plan);
      const report = verify(result, { skipProbes: params.skipProbes as boolean | undefined });
      const markdown = formatReport(report);

      return {
        content: [{ type: "text" as const, text: markdown }],
        details: { recommendation, plan, result, report, dryRun, verified: true },
      };
    },
  });

  // =========================================================================
  // Hybrid / Arc Tools
  // =========================================================================

  api.registerTool({
    name: "azure_list_arc_servers",
    label: "Azure List Arc Servers",
    description: "List Azure Arc-enabled servers, optionally filtered by resource group or agent status",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        status: { type: "string", description: "Agent status filter (Connected, Disconnected, Error, Expired)" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const servers = await state.hybridManager.listArcServers({
        resourceGroup: params.resourceGroup as string | undefined,
        status: params.status as "Connected" | "Disconnected" | "Error" | "Expired" | undefined,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }], details: { count: servers.length } };
    },
  });

  api.registerTool({
    name: "azure_get_arc_server",
    label: "Azure Get Arc Server",
    description: "Get details of a specific Azure Arc-enabled server",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        machineName: { type: "string", description: "Arc server machine name" },
      },
      required: ["resourceGroup", "machineName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const server = await state.hybridManager.getArcServer(
        params.resourceGroup as string,
        params.machineName as string,
      );
      if (!server) return { content: [{ type: "text" as const, text: "Arc server not found" }], details: { found: false } };
      return { content: [{ type: "text" as const, text: JSON.stringify(server, null, 2) }], details: { found: true } };
    },
  });

  api.registerTool({
    name: "azure_list_arc_server_extensions",
    label: "Azure List Arc Server Extensions",
    description: "List extensions installed on an Azure Arc-enabled server",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        machineName: { type: "string", description: "Arc server machine name" },
      },
      required: ["resourceGroup", "machineName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const extensions = await state.hybridManager.listArcServerExtensions(
        params.resourceGroup as string,
        params.machineName as string,
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(extensions, null, 2) }], details: { count: extensions.length } };
    },
  });

  api.registerTool({
    name: "azure_list_arc_kubernetes",
    label: "Azure List Arc Kubernetes",
    description: "List Azure Arc-connected Kubernetes clusters, optionally filtered by resource group or distribution",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        distribution: { type: "string", description: "K8s distribution filter (e.g. k3s, microk8s)" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const clusters = await state.hybridManager.listArcKubernetesClusters({
        resourceGroup: params.resourceGroup as string | undefined,
        distribution: params.distribution as string | undefined,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(clusters, null, 2) }], details: { count: clusters.length } };
    },
  });

  api.registerTool({
    name: "azure_get_arc_kubernetes",
    label: "Azure Get Arc Kubernetes Cluster",
    description: "Get details of a specific Azure Arc-connected Kubernetes cluster",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        clusterName: { type: "string", description: "Connected cluster name" },
      },
      required: ["resourceGroup", "clusterName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const cluster = await state.hybridManager.getArcKubernetesCluster(
        params.resourceGroup as string,
        params.clusterName as string,
      );
      if (!cluster) return { content: [{ type: "text" as const, text: "Arc Kubernetes cluster not found" }], details: { found: false } };
      return { content: [{ type: "text" as const, text: JSON.stringify(cluster, null, 2) }], details: { found: true } };
    },
  });

  api.registerTool({
    name: "azure_list_hci_clusters",
    label: "Azure List HCI Clusters",
    description: "List Azure Stack HCI clusters, optionally filtered by resource group",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const clusters = await state.hybridManager.listHCIClusters(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(clusters, null, 2) }], details: { count: clusters.length } };
    },
  });

  api.registerTool({
    name: "azure_get_hci_cluster",
    label: "Azure Get HCI Cluster",
    description: "Get details of a specific Azure Stack HCI cluster",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        clusterName: { type: "string", description: "HCI cluster name" },
      },
      required: ["resourceGroup", "clusterName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const cluster = await state.hybridManager.getHCICluster(
        params.resourceGroup as string,
        params.clusterName as string,
      );
      if (!cluster) return { content: [{ type: "text" as const, text: "HCI cluster not found" }], details: { found: false } };
      return { content: [{ type: "text" as const, text: JSON.stringify(cluster, null, 2) }], details: { found: true } };
    },
  });

  api.registerTool({
    name: "azure_list_custom_locations",
    label: "Azure List Custom Locations",
    description: "List Azure Custom Locations, optionally filtered by resource group",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const locations = await state.hybridManager.listCustomLocations(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(locations, null, 2) }], details: { count: locations.length } };
    },
  });

  api.registerTool({
    name: "azure_get_custom_location",
    label: "Azure Get Custom Location",
    description: "Get details of a specific Azure Custom Location",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Custom location name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const location = await state.hybridManager.getCustomLocation(
        params.resourceGroup as string,
        params.name as string,
      );
      if (!location) return { content: [{ type: "text" as const, text: "Custom location not found" }], details: { found: false } };
      return { content: [{ type: "text" as const, text: JSON.stringify(location, null, 2) }], details: { found: true } };
    },
  });

  api.registerTool({
    name: "azure_hybrid_discover",
    label: "Azure Hybrid Discovery",
    description: "Full hybrid infrastructure discovery — discovers all Arc servers, Arc K8s clusters, HCI clusters, and Custom Locations in parallel",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Limit discovery to a specific resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.hybridManager) throw new Error("Hybrid manager not initialized");
      const result = await state.hybridManager.discoverAll(params.resourceGroup as string | undefined);
      const summary = {
        arcServers: result.arcServers.length,
        arcClusters: result.arcClusters.length,
        hciClusters: result.hciClusters.length,
        customLocations: result.customLocations.length,
        total: result.arcServers.length + result.arcClusters.length + result.hciClusters.length + result.customLocations.length,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: { summary, subscriptionId: result.subscriptionId, discoveredAt: result.discoveredAt },
      };
    },
  });
}
