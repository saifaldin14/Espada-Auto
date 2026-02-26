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
import type { OrchestrationOptions, ExecutionPlan } from "./orchestration/index.js";
import { analyzeProject, recommend, recommendAndPlan, createPromptSession, resolveParams, verify, formatReport } from "./advisor/index.js";
import type { PromptSession, PromptAnswers } from "./advisor/index.js";
import type { TemplateCategory } from "./catalog/templates.js";
import type { ApplicationTierIntent } from "./intent/types.js";

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

  // --- Web Apps tools ---
  api.registerTool({
    name: "azure_list_webapps",
    label: "Azure List Web Apps",
    description: "List Azure App Service Web Apps (excludes Function Apps)",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      const apps = await state.webAppManager.listWebApps(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(apps, null, 2) }], details: { count: apps.length } };
    },
  });

  api.registerTool({
    name: "azure_get_webapp",
    label: "Azure Get Web App",
    description: "Get details of a specific Azure Web App",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      const app = await state.webAppManager.getWebApp(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(app, null, 2) }], details: app };
    },
  });

  api.registerTool({
    name: "azure_list_app_service_plans",
    label: "Azure List Plans",
    description: "List Azure App Service Plans",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      const plans = await state.webAppManager.listAppServicePlans(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(plans, null, 2) }], details: { count: plans.length } };
    },
  });

  api.registerTool({
    name: "azure_webapp_start",
    label: "Azure Start Web App",
    description: "Start an Azure Web App",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      await state.webAppManager.startWebApp(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: `Web App '${params.name}' started successfully` }], details: { action: "start", name: params.name } };
    },
  });

  api.registerTool({
    name: "azure_webapp_stop",
    label: "Azure Stop Web App",
    description: "Stop an Azure Web App",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      await state.webAppManager.stopWebApp(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: `Web App '${params.name}' stopped successfully` }], details: { action: "stop", name: params.name } };
    },
  });

  api.registerTool({
    name: "azure_webapp_restart",
    label: "Azure Restart Web App",
    description: "Restart an Azure Web App",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      await state.webAppManager.restartWebApp(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: `Web App '${params.name}' restarted successfully` }], details: { action: "restart", name: params.name } };
    },
  });

  api.registerTool({
    name: "azure_list_deployment_slots",
    label: "Azure Deployment Slots",
    description: "List deployment slots for a Web App",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, appName: { type: "string" } },
      required: ["resourceGroup", "appName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.webAppManager) throw new Error("Web App manager not initialized");
      const slots = await state.webAppManager.listDeploymentSlots(params.resourceGroup as string, params.appName as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(slots, null, 2) }], details: { count: slots.length } };
    },
  });

  // --- Firewall tools ---
  api.registerTool({
    name: "azure_list_firewalls",
    label: "Azure List Firewalls",
    description: "List Azure Firewalls",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.firewallManager) throw new Error("Firewall manager not initialized");
      const firewalls = await state.firewallManager.listFirewalls(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(firewalls, null, 2) }], details: { count: firewalls.length } };
    },
  });

  api.registerTool({
    name: "azure_get_firewall",
    label: "Azure Get Firewall",
    description: "Get details of a specific Azure Firewall",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.firewallManager) throw new Error("Firewall manager not initialized");
      const fw = await state.firewallManager.getFirewall(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(fw, null, 2) }], details: fw };
    },
  });

  api.registerTool({
    name: "azure_list_firewall_policies",
    label: "Azure FW Policies",
    description: "List Azure Firewall Policies",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.firewallManager) throw new Error("Firewall manager not initialized");
      const policies = await state.firewallManager.listPolicies(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(policies, null, 2) }], details: { count: policies.length } };
    },
  });

  api.registerTool({
    name: "azure_list_ip_groups",
    label: "Azure IP Groups",
    description: "List Azure IP Groups (used with Firewall rules)",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.firewallManager) throw new Error("Firewall manager not initialized");
      const groups = await state.firewallManager.listIPGroups(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }], details: { count: groups.length } };
    },
  });

  // --- Application Gateway tools ---
  api.registerTool({
    name: "azure_list_app_gateways",
    label: "Azure List App GWs",
    description: "List Azure Application Gateways",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.appGatewayManager) throw new Error("App Gateway manager not initialized");
      const gateways = await state.appGatewayManager.listGateways(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(gateways, null, 2) }], details: { count: gateways.length } };
    },
  });

  api.registerTool({
    name: "azure_get_app_gateway",
    label: "Azure Get App GW",
    description: "Get details of a specific Application Gateway",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.appGatewayManager) throw new Error("App Gateway manager not initialized");
      const gw = await state.appGatewayManager.getGateway(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(gw, null, 2) }], details: gw };
    },
  });

  api.registerTool({
    name: "azure_get_waf_config",
    label: "Azure WAF Config",
    description: "Get WAF configuration for an Application Gateway",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, name: { type: "string" } },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.appGatewayManager) throw new Error("App Gateway manager not initialized");
      const waf = await state.appGatewayManager.getWAFConfig(params.resourceGroup as string, params.name as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(waf, null, 2) }], details: waf };
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

  // --- Event Hubs tools ---
  api.registerTool({
    name: "azure_list_eventhub_namespaces",
    label: "Azure EH Namespaces",
    description: "List Azure Event Hubs namespaces",
    parameters: { type: "object", properties: { resourceGroup: { type: "string", description: "Resource group name" } } },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.eventHubsManager) throw new Error("Event Hubs manager not initialized");
      const namespaces = await state.eventHubsManager.listNamespaces(params.resourceGroup as string | undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(namespaces, null, 2) }], details: { count: namespaces.length } };
    },
  });

  api.registerTool({
    name: "azure_list_eventhubs",
    label: "Azure List Event Hubs",
    description: "List event hubs within a namespace",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, namespaceName: { type: "string" } },
      required: ["resourceGroup", "namespaceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.eventHubsManager) throw new Error("Event Hubs manager not initialized");
      const hubs = await state.eventHubsManager.listEventHubs(params.resourceGroup as string, params.namespaceName as string);
      return { content: [{ type: "text" as const, text: JSON.stringify(hubs, null, 2) }], details: { count: hubs.length } };
    },
  });

  api.registerTool({
    name: "azure_list_consumer_groups",
    label: "Azure EH Consumers",
    description: "List consumer groups for an event hub",
    parameters: {
      type: "object",
      properties: { resourceGroup: { type: "string" }, namespaceName: { type: "string" }, eventHubName: { type: "string" } },
      required: ["resourceGroup", "namespaceName", "eventHubName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.eventHubsManager) throw new Error("Event Hubs manager not initialized");
      const groups = await state.eventHubsManager.listConsumerGroups(
        params.resourceGroup as string, params.namespaceName as string, params.eventHubName as string,
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }], details: { count: groups.length } };
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
        scopes: params.scopes as string[] | undefined,
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
      const validation = validatePlan(params.plan as ExecutionPlan);
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
      const result = await runner.execute(params.plan as ExecutionPlan);
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

  // -------------------------------------------------------------------------
  // Traffic Manager tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_traffic_manager_profiles",
    label: "Azure List Traffic Manager Profiles",
    description: "List Azure Traffic Manager profiles",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.trafficManagerManager) throw new Error("Traffic Manager not initialized");
      const profiles = await state.trafficManagerManager.listProfiles(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profiles, null, 2) }],
        details: { count: profiles.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_traffic_manager_profile",
    label: "Azure Get Traffic Manager Profile",
    description: "Get a specific Traffic Manager profile with endpoint details",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Profile name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.trafficManagerManager) throw new Error("Traffic Manager not initialized");
      const profile = await state.trafficManagerManager.getProfile(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }],
        details: profile,
      };
    },
  });

  api.registerTool({
    name: "azure_list_traffic_manager_endpoints",
    label: "Azure List Traffic Manager Endpoints",
    description: "List endpoints for a Traffic Manager profile",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        profileName: { type: "string", description: "Traffic Manager profile name" },
      },
      required: ["resourceGroup", "profileName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.trafficManagerManager) throw new Error("Traffic Manager not initialized");
      const endpoints = await state.trafficManagerManager.listEndpoints(params.resourceGroup as string, params.profileName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }],
        details: { count: endpoints.length },
      };
    },
  });

  // -------------------------------------------------------------------------
  // Bastion tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_bastion_hosts",
    label: "Azure List Bastion Hosts",
    description: "List Azure Bastion hosts for secure VM connectivity",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.bastionManager) throw new Error("Bastion manager not initialized");
      const hosts = await state.bastionManager.listBastionHosts(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(hosts, null, 2) }],
        details: { count: hosts.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_bastion_host",
    label: "Azure Get Bastion Host",
    description: "Get details for an Azure Bastion host",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Bastion host name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.bastionManager) throw new Error("Bastion manager not initialized");
      const host = await state.bastionManager.getBastionHost(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(host, null, 2) }],
        details: host,
      };
    },
  });

  // -------------------------------------------------------------------------
  // Front Door tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_frontdoor_profiles",
    label: "Azure List Front Door Profiles",
    description: "List Azure Front Door profiles (AFD Standard/Premium)",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.frontDoorManager) throw new Error("Front Door manager not initialized");
      const profiles = await state.frontDoorManager.listProfiles(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profiles, null, 2) }],
        details: { count: profiles.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_frontdoor_profile",
    label: "Azure Get Front Door Profile",
    description: "Get a specific Azure Front Door profile",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Front Door profile name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.frontDoorManager) throw new Error("Front Door manager not initialized");
      const profile = await state.frontDoorManager.getProfile(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }],
        details: profile,
      };
    },
  });

  api.registerTool({
    name: "azure_list_frontdoor_endpoints",
    label: "Azure List Front Door Endpoints",
    description: "List endpoints for an Azure Front Door profile",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        profileName: { type: "string", description: "Front Door profile name" },
      },
      required: ["resourceGroup", "profileName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.frontDoorManager) throw new Error("Front Door manager not initialized");
      const endpoints = await state.frontDoorManager.listEndpoints(params.resourceGroup as string, params.profileName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }],
        details: { count: endpoints.length },
      };
    },
  });

  api.registerTool({
    name: "azure_list_frontdoor_origin_groups",
    label: "Azure List Front Door Origin Groups",
    description: "List origin groups for an Azure Front Door profile",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        profileName: { type: "string", description: "Front Door profile name" },
      },
      required: ["resourceGroup", "profileName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.frontDoorManager) throw new Error("Front Door manager not initialized");
      const groups = await state.frontDoorManager.listOriginGroups(params.resourceGroup as string, params.profileName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }],
        details: { count: groups.length },
      };
    },
  });

  // -------------------------------------------------------------------------
  // Static Web Apps tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_static_web_apps",
    label: "Azure List Static Web Apps",
    description: "List Azure Static Web Apps",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.staticWebAppsManager) throw new Error("Static Web Apps manager not initialized");
      const apps = await state.staticWebAppsManager.listStaticApps(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(apps, null, 2) }],
        details: { count: apps.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_static_web_app",
    label: "Azure Get Static Web App",
    description: "Get details for a specific Azure Static Web App",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Static Web App name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.staticWebAppsManager) throw new Error("Static Web Apps manager not initialized");
      const app = await state.staticWebAppsManager.getStaticApp(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(app, null, 2) }],
        details: app,
      };
    },
  });

  api.registerTool({
    name: "azure_list_static_web_app_builds",
    label: "Azure List Static Web App Builds",
    description: "List builds for an Azure Static Web App",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        appName: { type: "string", description: "Static Web App name" },
      },
      required: ["resourceGroup", "appName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.staticWebAppsManager) throw new Error("Static Web Apps manager not initialized");
      const builds = await state.staticWebAppsManager.listBuilds(params.resourceGroup as string, params.appName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(builds, null, 2) }],
        details: { count: builds.length },
      };
    },
  });

  api.registerTool({
    name: "azure_list_static_web_app_custom_domains",
    label: "Azure List Static Web App Custom Domains",
    description: "List custom domains for an Azure Static Web App",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        appName: { type: "string", description: "Static Web App name" },
      },
      required: ["resourceGroup", "appName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.staticWebAppsManager) throw new Error("Static Web Apps manager not initialized");
      const domains = await state.staticWebAppsManager.listCustomDomains(params.resourceGroup as string, params.appName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(domains, null, 2) }],
        details: { count: domains.length },
      };
    },
  });

  // -------------------------------------------------------------------------
  // Synapse Analytics tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_synapse_workspaces",
    label: "Azure List Synapse Workspaces",
    description: "List Azure Synapse Analytics workspaces",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.synapseManager) throw new Error("Synapse manager not initialized");
      const workspaces = await state.synapseManager.listWorkspaces(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(workspaces, null, 2) }],
        details: { count: workspaces.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_synapse_workspace",
    label: "Azure Get Synapse Workspace",
    description: "Get details of an Azure Synapse Analytics workspace",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Workspace name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.synapseManager) throw new Error("Synapse manager not initialized");
      const ws = await state.synapseManager.getWorkspace(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(ws, null, 2) }],
        details: ws,
      };
    },
  });

  api.registerTool({
    name: "azure_list_synapse_sql_pools",
    label: "Azure List Synapse SQL Pools",
    description: "List SQL pools in an Azure Synapse workspace",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        workspaceName: { type: "string", description: "Synapse workspace name" },
      },
      required: ["resourceGroup", "workspaceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.synapseManager) throw new Error("Synapse manager not initialized");
      const pools = await state.synapseManager.listSqlPools(params.resourceGroup as string, params.workspaceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(pools, null, 2) }],
        details: { count: pools.length },
      };
    },
  });

  api.registerTool({
    name: "azure_list_synapse_spark_pools",
    label: "Azure List Synapse Spark Pools",
    description: "List Apache Spark pools in an Azure Synapse workspace",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        workspaceName: { type: "string", description: "Synapse workspace name" },
      },
      required: ["resourceGroup", "workspaceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.synapseManager) throw new Error("Synapse manager not initialized");
      const pools = await state.synapseManager.listSparkPools(params.resourceGroup as string, params.workspaceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(pools, null, 2) }],
        details: { count: pools.length },
      };
    },
  });

  // -------------------------------------------------------------------------
  // Data Factory tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_data_factories",
    label: "Azure List Data Factories",
    description: "List Azure Data Factory instances",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.dataFactoryManager) throw new Error("Data Factory manager not initialized");
      const factories = await state.dataFactoryManager.listFactories(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(factories, null, 2) }],
        details: { count: factories.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_data_factory",
    label: "Azure Get Data Factory",
    description: "Get details of an Azure Data Factory instance",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Data factory name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.dataFactoryManager) throw new Error("Data Factory manager not initialized");
      const factory = await state.dataFactoryManager.getFactory(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(factory, null, 2) }],
        details: factory,
      };
    },
  });

  api.registerTool({
    name: "azure_list_data_factory_pipelines",
    label: "Azure List Data Factory Pipelines",
    description: "List pipelines in an Azure Data Factory",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        factoryName: { type: "string", description: "Data factory name" },
      },
      required: ["resourceGroup", "factoryName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.dataFactoryManager) throw new Error("Data Factory manager not initialized");
      const pipelines = await state.dataFactoryManager.listPipelines(params.resourceGroup as string, params.factoryName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(pipelines, null, 2) }],
        details: { count: pipelines.length },
      };
    },
  });

  api.registerTool({
    name: "azure_list_data_factory_datasets",
    label: "Azure List Data Factory Datasets",
    description: "List datasets in an Azure Data Factory",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        factoryName: { type: "string", description: "Data factory name" },
      },
      required: ["resourceGroup", "factoryName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.dataFactoryManager) throw new Error("Data Factory manager not initialized");
      const datasets = await state.dataFactoryManager.listDatasets(params.resourceGroup as string, params.factoryName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(datasets, null, 2) }],
        details: { count: datasets.length },
      };
    },
  });

  // -------------------------------------------------------------------------
  // SignalR Service tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_signalr_resources",
    label: "Azure List SignalR Resources",
    description: "List Azure SignalR Service resources",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.signalRManager) throw new Error("SignalR manager not initialized");
      const resources = await state.signalRManager.listSignalRResources(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resources, null, 2) }],
        details: { count: resources.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_signalr_resource",
    label: "Azure Get SignalR Resource",
    description: "Get details of an Azure SignalR Service resource",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "SignalR resource name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.signalRManager) throw new Error("SignalR manager not initialized");
      const resource = await state.signalRManager.getSignalRResource(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resource, null, 2) }],
        details: resource,
      };
    },
  });

  // -------------------------------------------------------------------------
  // Notification Hubs tools
  // -------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_notification_hub_namespaces",
    label: "Azure List Notification Hub Namespaces",
    description: "List Azure Notification Hubs namespaces",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Filter by resource group" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.notificationHubsManager) throw new Error("Notification Hubs manager not initialized");
      const namespaces = await state.notificationHubsManager.listNamespaces(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(namespaces, null, 2) }],
        details: { count: namespaces.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_notification_hub_namespace",
    label: "Azure Get Notification Hub Namespace",
    description: "Get details of an Azure Notification Hubs namespace",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        name: { type: "string", description: "Namespace name" },
      },
      required: ["resourceGroup", "name"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.notificationHubsManager) throw new Error("Notification Hubs manager not initialized");
      const ns = await state.notificationHubsManager.getNamespace(params.resourceGroup as string, params.name as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(ns, null, 2) }],
        details: ns,
      };
    },
  });

  api.registerTool({
    name: "azure_list_notification_hubs",
    label: "Azure List Notification Hubs",
    description: "List notification hubs in a namespace",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        namespaceName: { type: "string", description: "Notification Hubs namespace name" },
      },
      required: ["resourceGroup", "namespaceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.notificationHubsManager) throw new Error("Notification Hubs manager not initialized");
      const hubs = await state.notificationHubsManager.listNotificationHubs(params.resourceGroup as string, params.namespaceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(hubs, null, 2) }],
        details: { count: hubs.length },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Database (MySQL / PostgreSQL Flexible Server) tools
  // ---------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_mysql_servers",
    label: "Azure MySQL Servers",
    description: "List Azure Database for MySQL Flexible Servers. Optionally filter by resource group.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Optional resource group filter" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.databaseManager) throw new Error("Database manager not initialized");
      const servers = await state.databaseManager.listMySqlServers(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }],
        details: { count: servers.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_mysql_server",
    label: "Azure MySQL Server",
    description: "Get details of a specific Azure Database for MySQL Flexible Server.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        serverName: { type: "string", description: "MySQL server name" },
      },
      required: ["resourceGroup", "serverName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.databaseManager) throw new Error("Database manager not initialized");
      const server = await state.databaseManager.getMySqlServer(params.resourceGroup as string, params.serverName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(server, null, 2) }],
        details: { found: server !== null },
      };
    },
  });

  api.registerTool({
    name: "azure_list_mysql_databases",
    label: "Azure MySQL Databases",
    description: "List databases in a MySQL Flexible Server.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        serverName: { type: "string", description: "MySQL server name" },
      },
      required: ["resourceGroup", "serverName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.databaseManager) throw new Error("Database manager not initialized");
      const dbs = await state.databaseManager.listMySqlDatabases(params.resourceGroup as string, params.serverName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(dbs, null, 2) }],
        details: { count: dbs.length },
      };
    },
  });

  api.registerTool({
    name: "azure_list_pg_servers",
    label: "Azure PostgreSQL Servers",
    description: "List Azure Database for PostgreSQL Flexible Servers. Optionally filter by resource group.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Optional resource group filter" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.databaseManager) throw new Error("Database manager not initialized");
      const servers = await state.databaseManager.listPgServers(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }],
        details: { count: servers.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_pg_server",
    label: "Azure PostgreSQL Server",
    description: "Get details of a specific Azure Database for PostgreSQL Flexible Server.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        serverName: { type: "string", description: "PostgreSQL server name" },
      },
      required: ["resourceGroup", "serverName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.databaseManager) throw new Error("Database manager not initialized");
      const server = await state.databaseManager.getPgServer(params.resourceGroup as string, params.serverName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(server, null, 2) }],
        details: { found: server !== null },
      };
    },
  });

  api.registerTool({
    name: "azure_list_pg_databases",
    label: "Azure PostgreSQL Databases",
    description: "List databases in a PostgreSQL Flexible Server.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        serverName: { type: "string", description: "PostgreSQL server name" },
      },
      required: ["resourceGroup", "serverName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.databaseManager) throw new Error("Database manager not initialized");
      const dbs = await state.databaseManager.listPgDatabases(params.resourceGroup as string, params.serverName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(dbs, null, 2) }],
        details: { count: dbs.length },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Spring Apps tools
  // ---------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_spring_services",
    label: "Azure Spring Services",
    description: "List Azure Spring Apps services. Optionally filter by resource group.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Optional resource group filter" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.springAppsManager) throw new Error("Spring Apps manager not initialized");
      const services = await state.springAppsManager.listServices(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(services, null, 2) }],
        details: { count: services.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_spring_service",
    label: "Azure Spring Service",
    description: "Get details of a specific Azure Spring Apps service.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        serviceName: { type: "string", description: "Spring Apps service name" },
      },
      required: ["resourceGroup", "serviceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.springAppsManager) throw new Error("Spring Apps manager not initialized");
      const svc = await state.springAppsManager.getService(params.resourceGroup as string, params.serviceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(svc, null, 2) }],
        details: { found: svc !== null },
      };
    },
  });

  api.registerTool({
    name: "azure_list_spring_apps",
    label: "Azure Spring Apps",
    description: "List apps in an Azure Spring Apps service.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        serviceName: { type: "string", description: "Spring Apps service name" },
      },
      required: ["resourceGroup", "serviceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.springAppsManager) throw new Error("Spring Apps manager not initialized");
      const apps = await state.springAppsManager.listApps(params.resourceGroup as string, params.serviceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(apps, null, 2) }],
        details: { count: apps.length },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Purview tools
  // ---------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_purview_accounts",
    label: "Azure Purview Accounts",
    description: "List Microsoft Purview accounts. Optionally filter by resource group.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Optional resource group filter" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.purviewManager) throw new Error("Purview manager not initialized");
      const accounts = await state.purviewManager.listAccounts(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }],
        details: { count: accounts.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_purview_account",
    label: "Azure Purview Account",
    description: "Get details of a specific Microsoft Purview account.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        accountName: { type: "string", description: "Purview account name" },
      },
      required: ["resourceGroup", "accountName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.purviewManager) throw new Error("Purview manager not initialized");
      const acct = await state.purviewManager.getAccount(params.resourceGroup as string, params.accountName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(acct, null, 2) }],
        details: { found: acct !== null },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Maps tools
  // ---------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_maps_accounts",
    label: "Azure Maps Accounts",
    description: "List Azure Maps accounts. Optionally filter by resource group.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Optional resource group filter" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.mapsManager) throw new Error("Maps manager not initialized");
      const accounts = await state.mapsManager.listAccounts(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }],
        details: { count: accounts.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_maps_account",
    label: "Azure Maps Account",
    description: "Get details of a specific Azure Maps account.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        accountName: { type: "string", description: "Maps account name" },
      },
      required: ["resourceGroup", "accountName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.mapsManager) throw new Error("Maps manager not initialized");
      const acct = await state.mapsManager.getAccount(params.resourceGroup as string, params.accountName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(acct, null, 2) }],
        details: { found: acct !== null },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Digital Twins tools
  // ---------------------------------------------------------------------------

  api.registerTool({
    name: "azure_list_digital_twins",
    label: "Azure Digital Twins",
    description: "List Azure Digital Twins instances. Optionally filter by resource group.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Optional resource group filter" },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.digitalTwinsManager) throw new Error("Digital Twins manager not initialized");
      const instances = await state.digitalTwinsManager.listInstances(params.resourceGroup as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(instances, null, 2) }],
        details: { count: instances.length },
      };
    },
  });

  api.registerTool({
    name: "azure_get_digital_twin",
    label: "Azure Digital Twin",
    description: "Get details of a specific Azure Digital Twins instance.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        instanceName: { type: "string", description: "Digital Twins instance name" },
      },
      required: ["resourceGroup", "instanceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.digitalTwinsManager) throw new Error("Digital Twins manager not initialized");
      const dt = await state.digitalTwinsManager.getInstance(params.resourceGroup as string, params.instanceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(dt, null, 2) }],
        details: { found: dt !== null },
      };
    },
  });

  api.registerTool({
    name: "azure_list_digital_twin_endpoints",
    label: "Azure DT Endpoints",
    description: "List endpoints for an Azure Digital Twins instance.",
    parameters: {
      type: "object",
      properties: {
        resourceGroup: { type: "string", description: "Resource group name" },
        instanceName: { type: "string", description: "Digital Twins instance name" },
      },
      required: ["resourceGroup", "instanceName"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.digitalTwinsManager) throw new Error("Digital Twins manager not initialized");
      const endpoints = await state.digitalTwinsManager.listEndpoints(params.resourceGroup as string, params.instanceName as string);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }],
        details: { count: endpoints.length },
      };
    },
  });

  // ===========================================================================
  // Intent-Driven Infrastructure Orchestration (IDIO)
  // ===========================================================================
  api.registerTool({
    name: "azure_idio",
    label: "Azure IDIO",
    description: "Intent-driven infrastructure orchestration. Compile application intents into infrastructure plans, validate, and estimate costs. Actions: compile, validate, estimate_cost.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to perform: compile | validate | estimate_cost", enum: ["compile", "validate", "estimate_cost"] },
        intent: { type: "object", description: "ApplicationIntent object describing the desired infrastructure" },
      },
      required: ["action", "intent"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.intentCompiler) throw new Error("Intent compiler not initialized");
      const action = params.action as string;
      const intent = params.intent as Record<string, unknown>;
      switch (action) {
        case "compile": {
          const plan = state.intentCompiler.compile(intent as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }], details: { resourceCount: plan.resources.length } };
        }
        case "validate": {
          const result = state.intentCompiler.validateIntent(intent as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { valid: result.valid } };
        }
        case "estimate_cost": {
          const estimate = state.intentCompiler.estimateCost(intent as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(estimate, null, 2) }], details: { totalMonthly: estimate.estimatedMonthlyCostUsd } };
        }
        default:
          throw new Error(`Unknown IDIO action: ${action}`);
      }
    },
  });

  // ===========================================================================
  // Conversational Infrastructure Assistant
  // ===========================================================================
  api.registerTool({
    name: "azure_assistant",
    label: "Azure Assistant",
    description: "Conversational infrastructure assistant. Query infrastructure with natural language, track resources, get insights, start creation wizards. Actions: query, get_context, track_resource, untrack_resource, get_insights, list_wizards, start_wizard, wizard_next, get_wizard_state, get_summary.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to perform", enum: ["query", "get_context", "track_resource", "untrack_resource", "get_insights", "list_wizards", "start_wizard", "wizard_next", "get_wizard_state", "get_summary"] },
        naturalLanguage: { type: "string", description: "Natural language query (for 'query' action)" },
        resourceId: { type: "string", description: "Azure resource ID (for track/untrack)" },
        resourceType: { type: "string", description: "Resource type (for track)" },
        region: { type: "string", description: "Region (for track)" },
        tags: { type: "object", description: "Tags (for track)" },
        wizardId: { type: "string", description: "Wizard template ID (for start_wizard, wizard_next, get_wizard_state)" },
        answers: { type: "object", description: "Wizard step answers (for wizard_next)" },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal) {
      if (!state.conversationalManager) throw new Error("Conversational manager not initialized");
      const action = params.action as string;
      switch (action) {
        case "query": {
          const result = state.conversationalManager.query(params.naturalLanguage as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { category: result.query.category } };
        }
        case "get_context": {
          const ctx = state.conversationalManager.getContext();
          return { content: [{ type: "text" as const, text: JSON.stringify(ctx, null, 2) }], details: { trackedCount: ctx.resources.length } };
        }
        case "track_resource": {
          state.conversationalManager.trackResource({ id: params.resourceId as string, type: params.resourceType as string, name: (params.resourceId as string).split("/").pop() ?? "", region: params.region as string, resourceGroup: "default", status: "active", tags: (params.tags ?? {}) as Record<string, string>, properties: {}, trackedAt: new Date().toISOString() });
          return { content: [{ type: "text" as const, text: `Tracking resource: ${params.resourceId}` }], details: { resourceId: params.resourceId } };
        }
        case "untrack_resource": {
          state.conversationalManager.untrackResource(params.resourceId as string);
          return { content: [{ type: "text" as const, text: `Untracked resource: ${params.resourceId}` }], details: { resourceId: params.resourceId } };
        }
        case "get_insights": {
          const insights = state.conversationalManager.getInsights();
          return { content: [{ type: "text" as const, text: JSON.stringify(insights, null, 2) }], details: { count: insights.length } };
        }
        case "list_wizards": {
          const wizards = state.conversationalManager.listWizards();
          return { content: [{ type: "text" as const, text: JSON.stringify(wizards, null, 2) }], details: { count: wizards.length } };
        }
        case "start_wizard": {
          const ws = state.conversationalManager.startWizard(params.wizardId as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(ws, null, 2) }], details: { currentStep: ws?.currentStep ?? 0 } };
        }
        case "wizard_next": {
          const ws = state.conversationalManager.wizardNext(params.wizardId as string, (params.answers ?? {}) as Record<string, unknown>);
          return { content: [{ type: "text" as const, text: JSON.stringify(ws, null, 2) }], details: { completed: ws?.completed ?? false } };
        }
        case "get_wizard_state": {
          const ws = state.conversationalManager.getWizardState(params.wizardId as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(ws, null, 2) }], details: { wizardId: params.wizardId } };
        }
        case "get_summary": {
          const summary = state.conversationalManager.getSummary();
          return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }], details: { totalResources: summary.totalResources } };
        }
        default:
          throw new Error(`Unknown assistant action: ${action}`);
      }
    },
  });

  // ===========================================================================
  // Infrastructure Catalog
  // ===========================================================================
  api.registerTool({
    name: "azure_catalog",
    label: "Azure Catalog",
    description: "Infrastructure template catalog. Browse, search, and apply infrastructure templates. Actions: list, search, search_by_tags, get, apply, get_categories.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to perform", enum: ["list", "search", "search_by_tags", "get", "apply", "get_categories"] },
        category: { type: "string", description: "Category filter (for list)" },
        query: { type: "string", description: "Search query text (for search)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags to search by (for search_by_tags)" },
        templateId: { type: "string", description: "Template ID (for get/apply)" },
        parameters: { type: "object", description: "Parameters to apply to template (for apply)" },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const { listTemplates, searchTemplates, searchTemplatesByTags, getTemplate, applyTemplate, getCategories } = await import("./catalog/index.js");
      const action = params.action as string;
      switch (action) {
        case "list": {
          const templates = listTemplates(params.category as TemplateCategory | undefined);
          return { content: [{ type: "text" as const, text: JSON.stringify(templates, null, 2) }], details: { count: templates.length } };
        }
        case "search": {
          const results = searchTemplates(params.query as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }], details: { count: results.length } };
        }
        case "search_by_tags": {
          const results = searchTemplatesByTags(params.tags as string[]);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }], details: { count: results.length } };
        }
        case "get": {
          const tmpl = getTemplate(params.templateId as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(tmpl, null, 2) }], details: { found: tmpl !== undefined } };
        }
        case "apply": {
          const intent = applyTemplate(params.templateId as string, (params.parameters ?? {}) as { name: string; environment: string; region?: string; tags?: Record<string, string>; tierOverrides?: Record<string, Partial<ApplicationTierIntent>> });
          return { content: [{ type: "text" as const, text: JSON.stringify(intent, null, 2) }], details: { applied: true } };
        }
        case "get_categories": {
          const cats = getCategories();
          return { content: [{ type: "text" as const, text: JSON.stringify(cats, null, 2) }], details: { count: cats.length } };
        }
        default:
          throw new Error(`Unknown catalog action: ${action}`);
      }
    },
  });

  // ===========================================================================
  // IaC Generation
  // ===========================================================================
  api.registerTool({
    name: "azure_iac",
    label: "Azure IaC",
    description: "Infrastructure as Code generation. Generate Terraform, Bicep, or ARM templates from infrastructure plans or resource definitions. Actions: generate, generate_from_definitions, detect_drift, export_state.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to perform", enum: ["generate", "generate_from_definitions", "detect_drift", "export_state"] },
        plan: { type: "object", description: "InfrastructurePlan (for generate)" },
        definitions: { type: "array", description: "ResourceDefinition array (for generate_from_definitions)" },
        format: { type: "string", description: "Output format: terraform | bicep | arm", enum: ["terraform", "bicep", "arm"] },
        options: { type: "object", description: "Generation options (includeVariables, includeOutputs, etc.)" },
        desired: { type: "object", description: "Desired resource state (for detect_drift)" },
        actual: { type: "object", description: "Actual resource state (for detect_drift)" },
        resources: { type: "array", description: "Resources to export state from (for export_state)" },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      if (!state.iacManager) throw new Error("IaC manager not initialized");
      const action = params.action as string;
      switch (action) {
        case "generate": {
          const result = state.iacManager.generate(params.plan as never, { format: (params.format as never) ?? "terraform", ...(params.options as object ?? {}) } as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { format: result.format, resourceCount: result.resourceCount } };
        }
        case "generate_from_definitions": {
          const result = state.iacManager.generateFromDefinitions(params.definitions as never[], { format: (params.format as never) ?? "terraform", ...(params.options as object ?? {}) } as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { format: result.format } };
        }
        case "detect_drift": {
          const drift = state.iacManager.detectDrift(params.desired as never, params.actual as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(drift, null, 2) }], details: { driftDetected: drift.driftDetected, changeCount: drift.changes.length } };
        }
        case "export_state": {
          const exported = state.iacManager.exportState(params.resources as never[], (params.format as never) ?? "terraform");
          return { content: [{ type: "text" as const, text: JSON.stringify(exported, null, 2) }], details: { resourceCount: exported.resources.length } };
        }
        default:
          throw new Error(`Unknown IaC action: ${action}`);
      }
    },
  });

  // ===========================================================================
  // Enterprise Services
  // ===========================================================================
  api.registerTool({
    name: "azure_enterprise",
    label: "Azure Enterprise",
    description: "Enterprise features: multi-tenancy, billing, auth (SAML/OIDC/SCIM), collaboration (workspaces/approvals), GitOps. Use 'domain' to select the feature area and 'action' for the specific operation.",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Feature domain", enum: ["tenant", "billing", "auth", "collaboration", "gitops"] },
        action: { type: "string", description: "Action within the domain" },
        params: { type: "object", description: "Action-specific parameters" },
      },
      required: ["domain", "action"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal) {
      if (!state.enterpriseServices) throw new Error("Enterprise services not initialized");
      const domain = params.domain as string;
      const action = params.action as string;
      const p = (params.params ?? {}) as Record<string, unknown>;

      const text = await (async () => {
        switch (domain) {
          case "tenant": {
            const svc = state.enterpriseServices!.tenantManager;
            switch (action) {
              case "switch": return JSON.stringify(svc.switchTenant(p.tenantId as string) ?? { error: "Tenant not registered" }, null, 2);
              case "register": return JSON.stringify(svc.registerTenant(p as never), null, 2);
              case "list": return JSON.stringify(svc.listTenants(), null, 2);
              case "set_policy": { svc.setTenantPolicy(p.tenantId as string, p.policy as never); return "Policy set"; }
              case "get_quotas": return JSON.stringify(svc.getTenantQuotas(p.tenantId as string), null, 2);
              default: throw new Error(`Unknown tenant action: ${action}`);
            }
          }
          case "billing": {
            const svc = state.enterpriseServices!.billingService;
            switch (action) {
              case "get_account": return JSON.stringify(await svc.getBillingAccount(p.subscriptionId as string ?? "default"), null, 2);
              case "get_usage": return JSON.stringify(await svc.getUsageRecords(p.subscriptionId as string, p.startDate as string, p.endDate as string), null, 2);
              case "set_budget": { svc.setBudget(p.name as string, p as never); return "Budget set"; }
              case "get_budget": return JSON.stringify(svc.getBudget(p.budgetId as string), null, 2);
              case "list_budgets": return JSON.stringify(svc.listBudgets(), null, 2);
              case "delete_budget": { svc.deleteBudget(p.budgetId as string); return "Budget deleted"; }
              case "get_forecast": return JSON.stringify(await svc.getCostForecast(p.subscriptionId as string ?? "default"), null, 2);
              default: throw new Error(`Unknown billing action: ${action}`);
            }
          }
          case "auth": {
            const svc = state.enterpriseServices!.authManager;
            switch (action) {
              case "configure_saml": return JSON.stringify(svc.configureSaml(p as never), null, 2);
              case "configure_oidc": return JSON.stringify(svc.configureOidc(p as never), null, 2);
              case "configure_scim": return JSON.stringify(svc.configureScim(p as never), null, 2);
              case "enable_mfa": { svc.enableMfa((p.methods ?? []) as string[]); return "MFA enabled"; }
              case "disable_mfa": { svc.disableMfa(); return "MFA disabled"; }
              case "add_conditional_access": return JSON.stringify(svc.addConditionalAccessPolicy(p as never), null, 2);
              default: throw new Error(`Unknown auth action: ${action}`);
            }
          }
          case "collaboration": {
            const svc = state.enterpriseServices!.collaborationManager;
            switch (action) {
              case "create_workspace": return JSON.stringify(svc.createWorkspace(p as never), null, 2);
              case "add_member": return JSON.stringify(svc.addWorkspaceMember(p.workspaceId as string, p.member as never), null, 2);
              case "create_approval_flow": return JSON.stringify(svc.createApprovalFlow(p as never), null, 2);
              case "submit_approval": return JSON.stringify(svc.submitApprovalRequest(p.flowId as string, p.requesterId as string, p.action as string, p.resourceId as string), null, 2);
              case "process_approval": return JSON.stringify(svc.processApproval(p.requestId as string, p.approverId as string, p.decision as "approved" | "rejected", p.comment as string | undefined), null, 2);
              case "add_comment": return JSON.stringify(svc.addComment(p.resourceId as string, p.authorId as string, p.content as string, p.parentId as string | undefined), null, 2);
              case "get_notifications": return JSON.stringify(svc.getNotifications(p.userId as string), null, 2);
              default: throw new Error(`Unknown collaboration action: ${action}`);
            }
          }
          case "gitops": {
            const svc = state.enterpriseServices!.gitOpsManager;
            switch (action) {
              case "configure": { svc.configureRepository(p.name as string, p.config as never); return "Repository configured"; }
              case "sync": return JSON.stringify(svc.triggerSync(p.configId as string), null, 2);
              case "get_status": return JSON.stringify(svc.getSyncStatus(p.syncId as string), null, 2);
              case "get_history": return JSON.stringify(svc.getSyncHistory(p.configId as string), null, 2);
              default: throw new Error(`Unknown gitops action: ${action}`);
            }
          }
          default:
            throw new Error(`Unknown enterprise domain: ${domain}`);
        }
      })();
      return { content: [{ type: "text" as const, text }], details: { domain, action } };
    },
  });

  // ===========================================================================
  // Reconciliation Engine
  // ===========================================================================
  api.registerTool({
    name: "azure_reconciliation",
    label: "Azure Reconciliation",
    description: "Infrastructure reconciliation engine. Detect drift, check compliance, find cost anomalies, auto-remediate. Actions: reconcile, create_schedule, list_schedules, get_schedule, delete_schedule.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to perform", enum: ["reconcile", "create_schedule", "list_schedules", "get_schedule", "delete_schedule"] },
        config: { type: "object", description: "ReconciliationConfig (for reconcile)" },
        desired: { type: "array", description: "Desired resource states (for reconcile)" },
        actual: { type: "array", description: "Actual resource states (for reconcile)" },
        schedule: { type: "object", description: "Schedule configuration (for create_schedule)" },
        scheduleId: { type: "string", description: "Schedule ID (for get/delete)" },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal) {
      if (!state.reconciliationEngine) throw new Error("Reconciliation engine not initialized");
      const action = params.action as string;
      switch (action) {
        case "reconcile": {
          const result = state.reconciliationEngine.reconcile(params.config as never, params.desired as never[], params.actual as never[]);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { driftCount: result.summary.driftsDetected, complianceCount: result.summary.complianceIssuesFound } };
        }
        case "create_schedule": {
          const s = (params.schedule ?? {}) as { name: string; config: Record<string, unknown>; cronExpression: string };
          const sched = state.reconciliationEngine.createSchedule(s.name, s.config as never, s.cronExpression);
          return { content: [{ type: "text" as const, text: JSON.stringify(sched, null, 2) }], details: { id: sched.id } };
        }
        case "list_schedules": {
          const scheds = state.reconciliationEngine.listSchedules();
          return { content: [{ type: "text" as const, text: JSON.stringify(scheds, null, 2) }], details: { count: scheds.length } };
        }
        case "get_schedule": {
          const sched = state.reconciliationEngine.getSchedule(params.scheduleId as string);
          return { content: [{ type: "text" as const, text: JSON.stringify(sched, null, 2) }], details: { scheduleId: params.scheduleId } };
        }
        case "delete_schedule": {
          const ok = state.reconciliationEngine.deleteSchedule(params.scheduleId as string);
          return { content: [{ type: "text" as const, text: ok ? "Schedule deleted" : "Schedule not found" }], details: { deleted: ok } };
        }
        default:
          throw new Error(`Unknown reconciliation action: ${action}`);
      }
    },
  });
}
