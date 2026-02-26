import type { EspadaPluginApi } from "espada/plugin-sdk";
import type { AzurePluginState } from "./plugin-state.js";
import { Orchestrator, listBlueprints, getBlueprint, validatePlan } from "./orchestration/index.js";
import { analyzeProject, recommend, recommendAndPlan, createPromptSession, resolveParams, verify, formatReport } from "./advisor/index.js";
import type { PromptSession, PromptAnswers, AdvisorOptions } from "./advisor/index.js";

export function registerGatewayMethods(api: EspadaPluginApi, state: AzurePluginState): void {
  // =========================================================================
  api.registerGatewayMethod("azure.status", async (opts) => {
    if (!state.credentialsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Azure not initialized" }); return; }
    try {
      const result = await state.credentialsManager.getCredential();
      opts.respond(true, { data: { method: result.method, subscriptionId: result.subscriptionId, tenantId: result.tenantId } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.vm.list", async (opts) => {
    if (!state.vmManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "VM manager not initialized" }); return; }
    try {
      const { validatePagination } = await import("./pagination.js");
      const params = (opts.params ?? {}) as { resourceGroup?: string; limit?: number; offset?: number };
      validatePagination({ limit: params.limit, offset: params.offset });
      const baseOpts = params.resourceGroup ? { resourceGroup: params.resourceGroup } : {};
      if (params.limit !== undefined) {
        const result = await state.vmManager.listVMs({ ...baseOpts, limit: params.limit, offset: params.offset });
        opts.respond(true, { data: result });
      } else {
        const vms = await state.vmManager.listVMs(params.resourceGroup ? { resourceGroup: params.resourceGroup } : undefined);
        opts.respond(true, { data: vms });
      }
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.vm.start", async (opts) => {
    if (!state.vmManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "VM manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; vmName: string };
      await state.vmManager.startVM(params.resourceGroup, params.vmName);
      opts.respond(true, { data: { success: true } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.vm.stop", async (opts) => {
    if (!state.vmManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "VM manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; vmName: string };
      await state.vmManager.stopVM(params.resourceGroup, params.vmName);
      opts.respond(true, { data: { success: true } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.storage.list", async (opts) => {
    if (!state.storageManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Storage manager not initialized" }); return; }
    try {
      const { validatePagination } = await import("./pagination.js");
      const params = (opts.params ?? {}) as { resourceGroup?: string; limit?: number; offset?: number };
      validatePagination({ limit: params.limit, offset: params.offset });
      if (params.limit !== undefined) {
        const result = await state.storageManager.listStorageAccounts(params.resourceGroup, { limit: params.limit, offset: params.offset });
        opts.respond(true, { data: result });
      } else {
        const accounts = await state.storageManager.listStorageAccounts(params.resourceGroup);
        opts.respond(true, { data: accounts });
      }
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.rg.list", async (opts) => {
    if (!state.resourceManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Resource manager not initialized" }); return; }
    try {
      const { validatePagination } = await import("./pagination.js");
      const params = (opts.params ?? {}) as { limit?: number; offset?: number };
      validatePagination({ limit: params.limit, offset: params.offset });
      if (params.limit !== undefined) {
        const result = await state.resourceManager.listResourceGroups({ limit: params.limit, offset: params.offset });
        opts.respond(true, { data: result });
      } else {
        const groups = await state.resourceManager.listResourceGroups();
        opts.respond(true, { data: groups });
      }
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.functions.list", async (opts) => {
    if (!state.functionsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Functions manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const apps = await state.functionsManager.listFunctionApps(params.resourceGroup);
      opts.respond(true, { data: apps });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.aks.list", async (opts) => {
    if (!state.containerManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Container manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const clusters = await state.containerManager.listAKSClusters(params.resourceGroup);
      opts.respond(true, { data: clusters });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.sql.list", async (opts) => {
    if (!state.sqlManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "SQL manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const servers = await state.sqlManager.listServers(params.resourceGroup);
      opts.respond(true, { data: servers });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.keyvault.list", async (opts) => {
    if (!state.keyVaultManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "KeyVault manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const vaults = await state.keyVaultManager.listVaults(params.resourceGroup);
      opts.respond(true, { data: vaults });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.cost.query", async (opts) => {
    if (!state.costManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Cost manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { timeframe?: string };
      const result = await state.costManager.queryCosts({ timeframe: params.timeframe });
      opts.respond(true, { data: result });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.subscriptions.list", async (opts) => {
    if (!state.subscriptionManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Subscription manager not initialized" }); return; }
    try {
      const subs = await state.subscriptionManager.listSubscriptions();
      opts.respond(true, { data: subs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.monitor.metrics", async (opts) => {
    if (!state.monitorManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Monitor manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceUri: string; metrics: string[] };
      const metrics = await state.monitorManager.listMetrics(params.resourceUri, params.metrics);
      opts.respond(true, { data: metrics });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.security.scores", async (opts) => {
    if (!state.securityManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Security manager not initialized" }); return; }
    try {
      const scores = await state.securityManager.getSecureScores();
      opts.respond(true, { data: scores });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.compliance.report", async (opts) => {
    if (!state.complianceManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Compliance manager not initialized" }); return; }
    try {
      const report = await state.complianceManager.generateReport();
      opts.respond(true, { data: report });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Networking ---
  api.registerGatewayMethod("azure.network.vnets", async (opts) => {
    if (!state.networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const vnets = await state.networkManager.listVNets(params.resourceGroup);
      opts.respond(true, { data: vnets });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.network.nsgs", async (opts) => {
    if (!state.networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const nsgs = await state.networkManager.listNSGs(params.resourceGroup);
      opts.respond(true, { data: nsgs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.network.lbs", async (opts) => {
    if (!state.networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const lbs = await state.networkManager.listLoadBalancers(params.resourceGroup);
      opts.respond(true, { data: lbs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.network.pips", async (opts) => {
    if (!state.networkManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Network manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const pips = await state.networkManager.listPublicIPs(params.resourceGroup);
      opts.respond(true, { data: pips });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Web Apps ---
  api.registerGatewayMethod("azure.webapp.list", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const apps = await state.webAppManager.listWebApps(params.resourceGroup);
      opts.respond(true, { data: apps });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.webapp.get", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const app = await state.webAppManager.getWebApp(params.resourceGroup, params.name);
      opts.respond(true, { data: app });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.webapp.start", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      await state.webAppManager.startWebApp(params.resourceGroup, params.name);
      opts.respond(true, { data: { status: "started" } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.webapp.stop", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      await state.webAppManager.stopWebApp(params.resourceGroup, params.name);
      opts.respond(true, { data: { status: "stopped" } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.webapp.restart", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      await state.webAppManager.restartWebApp(params.resourceGroup, params.name);
      opts.respond(true, { data: { status: "restarted" } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.webapp.plans", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const plans = await state.webAppManager.listAppServicePlans(params.resourceGroup);
      opts.respond(true, { data: plans });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.webapp.slots", async (opts) => {
    if (!state.webAppManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Web App manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; appName: string };
      const slots = await state.webAppManager.listDeploymentSlots(params.resourceGroup, params.appName);
      opts.respond(true, { data: slots });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Firewall ---
  api.registerGatewayMethod("azure.firewall.list", async (opts) => {
    if (!state.firewallManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Firewall manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const firewalls = await state.firewallManager.listFirewalls(params.resourceGroup);
      opts.respond(true, { data: firewalls });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.firewall.get", async (opts) => {
    if (!state.firewallManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Firewall manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const fw = await state.firewallManager.getFirewall(params.resourceGroup, params.name);
      opts.respond(true, { data: fw });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.firewall.policies", async (opts) => {
    if (!state.firewallManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Firewall manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const policies = await state.firewallManager.listPolicies(params.resourceGroup);
      opts.respond(true, { data: policies });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.firewall.ipgroups", async (opts) => {
    if (!state.firewallManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Firewall manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const groups = await state.firewallManager.listIPGroups(params.resourceGroup);
      opts.respond(true, { data: groups });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Application Gateway ---
  api.registerGatewayMethod("azure.appgateway.list", async (opts) => {
    if (!state.appGatewayManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "App Gateway manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const gateways = await state.appGatewayManager.listGateways(params.resourceGroup);
      opts.respond(true, { data: gateways });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.appgateway.get", async (opts) => {
    if (!state.appGatewayManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "App Gateway manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const gw = await state.appGatewayManager.getGateway(params.resourceGroup, params.name);
      opts.respond(true, { data: gw });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.appgateway.waf", async (opts) => {
    if (!state.appGatewayManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "App Gateway manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const waf = await state.appGatewayManager.getWAFConfig(params.resourceGroup, params.name);
      opts.respond(true, { data: waf });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- DNS ---
  api.registerGatewayMethod("azure.dns.zones", async (opts) => {
    if (!state.dnsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DNS manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const zones = await state.dnsManager.listZones(params.resourceGroup);
      opts.respond(true, { data: zones });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.dns.records", async (opts) => {
    if (!state.dnsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DNS manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; zoneName: string };
      const records = await state.dnsManager.listRecordSets(params.resourceGroup, params.zoneName);
      opts.respond(true, { data: records });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Redis ---
  api.registerGatewayMethod("azure.redis.list", async (opts) => {
    if (!state.redisManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Redis manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const caches = await state.redisManager.listCaches(params.resourceGroup);
      opts.respond(true, { data: caches });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.redis.get", async (opts) => {
    if (!state.redisManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Redis manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; cacheName: string };
      const cache = await state.redisManager.getCache(params.resourceGroup, params.cacheName);
      opts.respond(true, { data: cache });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- CDN ---
  api.registerGatewayMethod("azure.cdn.profiles", async (opts) => {
    if (!state.cdnManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CDN manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const profiles = await state.cdnManager.listProfiles(params.resourceGroup);
      opts.respond(true, { data: profiles });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.cdn.endpoints", async (opts) => {
    if (!state.cdnManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CDN manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; profileName: string };
      const endpoints = await state.cdnManager.listEndpoints(params.resourceGroup, params.profileName);
      opts.respond(true, { data: endpoints });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- CosmosDB ---
  api.registerGatewayMethod("azure.cosmosdb.list", async (opts) => {
    if (!state.cosmosDBManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CosmosDB manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const accounts = await state.cosmosDBManager.listAccounts(params.resourceGroup);
      opts.respond(true, { data: accounts });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.cosmosdb.databases", async (opts) => {
    if (!state.cosmosDBManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "CosmosDB manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
      const dbs = await state.cosmosDBManager.listDatabases(params.resourceGroup, params.accountName);
      opts.respond(true, { data: dbs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Service Bus ---
  api.registerGatewayMethod("azure.servicebus.list", async (opts) => {
    if (!state.serviceBusManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "ServiceBus manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const namespaces = await state.serviceBusManager.listNamespaces(params.resourceGroup);
      opts.respond(true, { data: namespaces });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.servicebus.queues", async (opts) => {
    if (!state.serviceBusManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "ServiceBus manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; namespaceName: string };
      const queues = await state.serviceBusManager.listQueues(params.resourceGroup, params.namespaceName);
      opts.respond(true, { data: queues });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.servicebus.topics", async (opts) => {
    if (!state.serviceBusManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "ServiceBus manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; namespaceName: string };
      const topics = await state.serviceBusManager.listTopics(params.resourceGroup, params.namespaceName);
      opts.respond(true, { data: topics });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Event Grid ---
  api.registerGatewayMethod("azure.eventgrid.topics", async (opts) => {
    if (!state.eventGridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EventGrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const topics = await state.eventGridManager.listTopics(params.resourceGroup);
      opts.respond(true, { data: topics });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.eventgrid.domains", async (opts) => {
    if (!state.eventGridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "EventGrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const domains = await state.eventGridManager.listDomains(params.resourceGroup);
      opts.respond(true, { data: domains });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Event Hubs ---
  api.registerGatewayMethod("azure.eventhubs.namespaces", async (opts) => {
    if (!state.eventHubsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Event Hubs manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const namespaces = await state.eventHubsManager.listNamespaces(params.resourceGroup);
      opts.respond(true, { data: namespaces });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.eventhubs.list", async (opts) => {
    if (!state.eventHubsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Event Hubs manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; namespaceName: string };
      const hubs = await state.eventHubsManager.listEventHubs(params.resourceGroup, params.namespaceName);
      opts.respond(true, { data: hubs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.eventhubs.consumergroups", async (opts) => {
    if (!state.eventHubsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Event Hubs manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; namespaceName: string; eventHubName: string };
      const groups = await state.eventHubsManager.listConsumerGroups(params.resourceGroup, params.namespaceName, params.eventHubName);
      opts.respond(true, { data: groups });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- IAM ---
  api.registerGatewayMethod("azure.iam.roles", async (opts) => {
    if (!state.iamManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "IAM manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { scope?: string };
      const roles = await state.iamManager.listRoleDefinitions(params.scope);
      opts.respond(true, { data: roles });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.iam.assignments", async (opts) => {
    if (!state.iamManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "IAM manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { scope?: string };
      const assignments = await state.iamManager.listRoleAssignments(params.scope);
      opts.respond(true, { data: assignments });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Policy ---
  api.registerGatewayMethod("azure.policy.definitions", async (opts) => {
    if (!state.policyManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Policy manager not initialized" }); return; }
    try {
      const defs = await state.policyManager.listDefinitions();
      opts.respond(true, { data: defs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.policy.assignments", async (opts) => {
    if (!state.policyManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Policy manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { scope?: string };
      const assignments = await state.policyManager.listAssignments(params.scope);
      opts.respond(true, { data: assignments });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.policy.compliance", async (opts) => {
    if (!state.policyManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Policy manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { scope?: string };
      const complianceState = await state.policyManager.getComplianceState(params.scope);
      opts.respond(true, { data: complianceState });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Backup ---
  api.registerGatewayMethod("azure.backup.vaults", async (opts) => {
    if (!state.backupManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Backup manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const vaults = await state.backupManager.listVaults(params.resourceGroup);
      opts.respond(true, { data: vaults });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.backup.items", async (opts) => {
    if (!state.backupManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Backup manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; vaultName: string };
      const items = await state.backupManager.listBackupItems(params.resourceGroup, params.vaultName);
      opts.respond(true, { data: items });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.backup.jobs", async (opts) => {
    if (!state.backupManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Backup manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; vaultName: string };
      const jobs = await state.backupManager.listBackupJobs(params.resourceGroup, params.vaultName);
      opts.respond(true, { data: jobs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Automation ---
  api.registerGatewayMethod("azure.automation.accounts", async (opts) => {
    if (!state.automationManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Automation manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const accounts = await state.automationManager.listAccounts(params.resourceGroup);
      opts.respond(true, { data: accounts });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.automation.runbooks", async (opts) => {
    if (!state.automationManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Automation manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
      const runbooks = await state.automationManager.listRunbooks(params.resourceGroup, params.accountName);
      opts.respond(true, { data: runbooks });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.automation.jobs", async (opts) => {
    if (!state.automationManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Automation manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
      const jobs = await state.automationManager.listJobs(params.resourceGroup, params.accountName);
      opts.respond(true, { data: jobs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Logic Apps ---
  api.registerGatewayMethod("azure.logic.list", async (opts) => {
    if (!state.logicManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Logic Apps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const workflows = await state.logicManager.listWorkflows(params.resourceGroup);
      opts.respond(true, { data: workflows });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.logic.runs", async (opts) => {
    if (!state.logicManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Logic Apps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; workflowName: string };
      const runs = await state.logicManager.listRuns(params.resourceGroup, params.workflowName);
      opts.respond(true, { data: runs });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- API Management ---
  api.registerGatewayMethod("azure.apim.list", async (opts) => {
    if (!state.apimManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "APIM manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const services = await state.apimManager.listServices(params.resourceGroup);
      opts.respond(true, { data: services });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.apim.apis", async (opts) => {
    if (!state.apimManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "APIM manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; serviceName: string };
      const apis = await state.apimManager.listAPIs(params.resourceGroup, params.serviceName);
      opts.respond(true, { data: apis });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- DevOps ---
  api.registerGatewayMethod("azure.devops.projects", async (opts) => {
    if (!state.devOpsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DevOps manager not initialized (set devOpsOrganization in config)" }); return; }
    try {
      const projects = await state.devOpsManager.listProjects();
      opts.respond(true, { data: projects });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.pipelines", async (opts) => {
    if (!state.devOpsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DevOps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { projectName: string };
      const pipelines = await state.devOpsManager.listPipelines(params.projectName);
      opts.respond(true, { data: pipelines });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.repos", async (opts) => {
    if (!state.devOpsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "DevOps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { projectName: string };
      const repos = await state.devOpsManager.listRepositories(params.projectName);
      opts.respond(true, { data: repos });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- PAT management gateway methods ---
  api.registerGatewayMethod("azure.devops.pat.list", async (opts) => {
    if (!state.patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { organization?: string };
      const pats = state.patManager.listPATs(params.organization);
      opts.respond(true, { data: pats });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.pat.store", async (opts) => {
    if (!state.patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { token: string; label: string; organization?: string; scopes?: string[]; expiresAt?: string; validate?: boolean };
      const summary = await state.patManager.storePAT(params);
      opts.respond(true, { data: summary });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.pat.delete", async (opts) => {
    if (!state.patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { id: string };
      const deleted = await state.patManager.deletePAT(params.id);
      opts.respond(true, { data: { deleted } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.pat.validate", async (opts) => {
    if (!state.patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { id: string };
      const result = await state.patManager.validatePAT(params.id);
      opts.respond(true, { data: result });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.pat.token", async (opts) => {
    if (!state.patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { organization: string };
      const token = await state.patManager.getTokenForOrganization(params.organization);
      if (!token) { opts.respond(false, undefined, { code: "NOT_FOUND", message: `No valid PAT for organization: ${params.organization}` }); return; }
      opts.respond(true, { data: { token } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.devops.pat.checkExpiry", async (opts) => {
    if (!state.patManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "PAT manager not initialized" }); return; }
    try {
      const problems = state.patManager.checkExpiry();
      opts.respond(true, { data: problems });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- AI ---
  api.registerGatewayMethod("azure.ai.accounts", async (opts) => {
    if (!state.aiManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "AI manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const accounts = await state.aiManager.listAccounts(params.resourceGroup);
      opts.respond(true, { data: accounts });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.ai.deployments", async (opts) => {
    if (!state.aiManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "AI manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; accountName: string };
      const deployments = await state.aiManager.listDeployments(params.resourceGroup, params.accountName);
      opts.respond(true, { data: deployments });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.ai.models", async (opts) => {
    if (!state.aiManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "AI manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { location: string };
      const models = await state.aiManager.listModels(params.location);
      opts.respond(true, { data: models });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Activity Log ---
  api.registerGatewayMethod("azure.activitylog.events", async (opts) => {
    if (!state.activityLogManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Activity Log manager not initialized" }); return; }
    try {
      const events = await state.activityLogManager.getEvents();
      opts.respond(true, { data: events });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Security (additional) ---
  api.registerGatewayMethod("azure.security.alerts", async (opts) => {
    if (!state.securityManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Security manager not initialized" }); return; }
    try {
      const alerts = await state.securityManager.listAlerts();
      opts.respond(true, { data: alerts });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.security.recommendations", async (opts) => {
    if (!state.securityManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Security manager not initialized" }); return; }
    try {
      const recs = await state.securityManager.listRecommendations();
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
    if (!state.orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { plan: any; dryRun?: boolean };
      const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun: params.dryRun });
      const result = await runner.execute(params.plan);
      opts.respond(true, { data: result });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.orchestration.runBlueprint", async (opts) => {
    if (!state.orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { blueprintId: string; params: Record<string, unknown>; dryRun?: boolean };
      const bp = getBlueprint(params.blueprintId);
      if (!bp) { opts.respond(false, undefined, { code: "NOT_FOUND", message: `Blueprint "${params.blueprintId}" not found` }); return; }
      const plan = bp.generate(params.params);
      const validation = validatePlan(plan);
      if (!validation.valid) { opts.respond(false, undefined, { code: "VALIDATION_FAILED", message: validation.issues.map((i) => i.message).join("; ") }); return; }
      const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun: params.dryRun });
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
      const recommendation = recommend(analysis, params.options as AdvisorOptions | undefined);
      opts.respond(true, { data: recommendation });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.advisor.analyzeAndDeploy", async (opts) => {
    if (!state.orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { projectPath: string; options?: Record<string, unknown>; dryRun?: boolean };
      if (!params.projectPath) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "projectPath is required" }); return; }
      const { recommendation, plan, validationIssues } = recommendAndPlan(analyzeProject(params.projectPath), params.options as AdvisorOptions | undefined);
      if (!plan) {
        opts.respond(true, { data: { recommendation, plan: null, validationIssues, executed: false } });
        return;
      }
      const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun: params.dryRun });
      const result = await runner.execute(plan);
      opts.respond(true, { data: { recommendation, plan, result, validationIssues, executed: true } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.advisor.prompt", async (opts) => {
    try {
      const params = (opts.params ?? {}) as { projectPath: string; options?: Record<string, unknown> };
      if (!params.projectPath) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "projectPath is required" }); return; }
      const analysis = analyzeProject(params.projectPath);
      const rec = recommend(analysis, params.options as AdvisorOptions | undefined);
      const session = createPromptSession(rec);
      opts.respond(true, { data: session });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.advisor.resolveParams", async (opts) => {
    try {
      const params = (opts.params ?? {}) as { session: PromptSession; answers: PromptAnswers };
      if (!params.session) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "session is required" }); return; }
      const resolved = resolveParams(params.session, params.answers ?? {});
      opts.respond(true, { data: resolved });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.advisor.verify", async (opts) => {
    if (!state.orchestrator) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Orchestrator not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { projectPath: string; options?: Record<string, unknown>; dryRun?: boolean; skipProbes?: boolean };
      if (!params.projectPath) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "projectPath is required" }); return; }
      const { recommendation, plan, validationIssues } = recommendAndPlan(analyzeProject(params.projectPath), params.options as AdvisorOptions | undefined);
      if (!plan) {
        opts.respond(true, { data: { recommendation, plan: null, validationIssues, verified: false } });
        return;
      }
      const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun: params.dryRun });
      const result = await runner.execute(plan);
      const report = verify(result, { skipProbes: params.skipProbes });
      opts.respond(true, { data: { recommendation, plan, result, report, verified: true } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.advisor.formatReport", async (opts) => {
    try {
      const params = (opts.params ?? {}) as { report: any };
      if (!params.report) { opts.respond(false, undefined, { code: "INVALID_PARAMS", message: "report is required" }); return; }
      const markdown = formatReport(params.report);
      opts.respond(true, { data: { markdown } });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Hybrid / Arc ---
  api.registerGatewayMethod("azure.hybrid.arcServers", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string; status?: string };
      const servers = await state.hybridManager.listArcServers({
        resourceGroup: params.resourceGroup,
        status: params.status as "Connected" | "Disconnected" | "Error" | "Expired" | undefined,
      });
      opts.respond(true, { data: servers });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.arcServer", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; machineName: string };
      const server = await state.hybridManager.getArcServer(params.resourceGroup, params.machineName);
      opts.respond(true, { data: server });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.arcServerExtensions", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; machineName: string };
      const extensions = await state.hybridManager.listArcServerExtensions(params.resourceGroup, params.machineName);
      opts.respond(true, { data: extensions });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.arcKubernetes", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string; distribution?: string };
      const clusters = await state.hybridManager.listArcKubernetesClusters({
        resourceGroup: params.resourceGroup,
        distribution: params.distribution,
      });
      opts.respond(true, { data: clusters });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.arcKubernetesCluster", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; clusterName: string };
      const cluster = await state.hybridManager.getArcKubernetesCluster(params.resourceGroup, params.clusterName);
      opts.respond(true, { data: cluster });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.hciClusters", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const clusters = await state.hybridManager.listHCIClusters(params.resourceGroup);
      opts.respond(true, { data: clusters });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.hciCluster", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; clusterName: string };
      const cluster = await state.hybridManager.getHCICluster(params.resourceGroup, params.clusterName);
      opts.respond(true, { data: cluster });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.customLocations", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const locations = await state.hybridManager.listCustomLocations(params.resourceGroup);
      opts.respond(true, { data: locations });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.customLocation", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const location = await state.hybridManager.getCustomLocation(params.resourceGroup, params.name);
      opts.respond(true, { data: location });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.hybrid.discover", async (opts) => {
    if (!state.hybridManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Hybrid manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const result = await state.hybridManager.discoverAll(params.resourceGroup);
      opts.respond(true, { data: result });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Traffic Manager gateway methods ---
  api.registerGatewayMethod("azure.trafficmanager.list", async (opts) => {
    if (!state.trafficManagerManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Traffic Manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const profiles = await state.trafficManagerManager.listProfiles(params.resourceGroup);
      opts.respond(true, { data: profiles });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.trafficmanager.get", async (opts) => {
    if (!state.trafficManagerManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Traffic Manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const profile = await state.trafficManagerManager.getProfile(params.resourceGroup, params.name);
      opts.respond(true, { data: profile });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.trafficmanager.endpoints", async (opts) => {
    if (!state.trafficManagerManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Traffic Manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; profileName: string };
      const endpoints = await state.trafficManagerManager.listEndpoints(params.resourceGroup, params.profileName);
      opts.respond(true, { data: endpoints });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Bastion gateway methods ---
  api.registerGatewayMethod("azure.bastion.list", async (opts) => {
    if (!state.bastionManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Bastion manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const hosts = await state.bastionManager.listBastionHosts(params.resourceGroup);
      opts.respond(true, { data: hosts });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.bastion.get", async (opts) => {
    if (!state.bastionManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Bastion manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const host = await state.bastionManager.getBastionHost(params.resourceGroup, params.name);
      opts.respond(true, { data: host });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Front Door gateway methods ---
  api.registerGatewayMethod("azure.frontdoor.list", async (opts) => {
    if (!state.frontDoorManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Front Door manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const profiles = await state.frontDoorManager.listProfiles(params.resourceGroup);
      opts.respond(true, { data: profiles });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.frontdoor.get", async (opts) => {
    if (!state.frontDoorManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Front Door manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const profile = await state.frontDoorManager.getProfile(params.resourceGroup, params.name);
      opts.respond(true, { data: profile });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.frontdoor.endpoints", async (opts) => {
    if (!state.frontDoorManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Front Door manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; profileName: string };
      const endpoints = await state.frontDoorManager.listEndpoints(params.resourceGroup, params.profileName);
      opts.respond(true, { data: endpoints });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.frontdoor.origingroups", async (opts) => {
    if (!state.frontDoorManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Front Door manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; profileName: string };
      const groups = await state.frontDoorManager.listOriginGroups(params.resourceGroup, params.profileName);
      opts.respond(true, { data: groups });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  // --- Static Web Apps gateway methods ---
  api.registerGatewayMethod("azure.staticwebapp.list", async (opts) => {
    if (!state.staticWebAppsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Static Web Apps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup?: string };
      const apps = await state.staticWebAppsManager.listStaticApps(params.resourceGroup);
      opts.respond(true, { data: apps });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.staticwebapp.get", async (opts) => {
    if (!state.staticWebAppsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Static Web Apps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; name: string };
      const app = await state.staticWebAppsManager.getStaticApp(params.resourceGroup, params.name);
      opts.respond(true, { data: app });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.staticwebapp.builds", async (opts) => {
    if (!state.staticWebAppsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Static Web Apps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; appName: string };
      const builds = await state.staticWebAppsManager.listBuilds(params.resourceGroup, params.appName);
      opts.respond(true, { data: builds });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });

  api.registerGatewayMethod("azure.staticwebapp.domains", async (opts) => {
    if (!state.staticWebAppsManager) { opts.respond(false, undefined, { code: "NOT_INITIALIZED", message: "Static Web Apps manager not initialized" }); return; }
    try {
      const params = (opts.params ?? {}) as { resourceGroup: string; appName: string };
      const domains = await state.staticWebAppsManager.listCustomDomains(params.resourceGroup, params.appName);
      opts.respond(true, { data: domains });
    } catch (error) { opts.respond(false, undefined, { code: "AZURE_ERROR", message: String(error) }); }
  });
}
