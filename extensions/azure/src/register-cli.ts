import type { EspadaPluginApi, EspadaPluginCliContext } from "espada/plugin-sdk";
import { formatErrorMessage } from "./retry.js";
import { theme, type AzurePluginState } from "./plugin-state.js";
import type { AzurePagedResult } from "./types.js";
import { validatePagination } from "./pagination.js";
import { Orchestrator } from "./orchestration/index.js";
import { analyzeProject, recommend, recommendAndPlan, createPromptSession, verify, formatReport } from "./advisor/index.js";

export function registerAzureCli(api: EspadaPluginApi, state: AzurePluginState): void {
    api.registerCli((ctx: EspadaPluginCliContext) => {
      const az = ctx.program.command("azure").description("Azure infrastructure management");

      // --- VM commands ---
      const vmCmd = az.command("vm").description("Virtual Machine management");

      vmCmd
        .command("list")
        .description("List virtual machines")
        .option("--resource-group <rg>", "Filter by resource group")
        .option("--limit <n>", "Max items to return", parseInt)
        .option("--offset <n>", "Items to skip", parseInt)
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string; limit?: number; offset?: number };
          if (!state.vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            validatePagination({ limit: options.limit, offset: options.offset });
            const baseOpts = options.resourceGroup ? { resourceGroup: options.resourceGroup } : {};
            if (options.limit !== undefined) {
              const result = await state.vmManager.listVMs({ ...baseOpts, limit: options.limit, offset: options.offset }) as AzurePagedResult<import("./vms/types.js").VMInstance>;
              if (result.items.length === 0) { console.log("No VMs found"); return; }
              console.log("\nVirtual Machines:\n");
              for (const vm of result.items) {
                console.log(`  ${vm.id}`);
                console.log(`    Name: ${vm.name}`);
                console.log(`    Size: ${vm.vmSize}`);
                console.log(`    State: ${vm.powerState}`);
                console.log(`    Location: ${vm.location}`);
                console.log();
              }
              if (result.hasMore) console.log(theme.muted(`  ... more results available (use --offset ${(options.offset ?? 0) + options.limit})`));
            } else {
              const vms = await state.vmManager.listVMs(options.resourceGroup ? { resourceGroup: options.resourceGroup } : undefined);
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
            }
          } catch (error) {
            console.error(theme.error(`Failed to list VMs: ${formatErrorMessage(error)}`));
          }
        });

      vmCmd
        .command("start <resourceGroup> <vmName>")
        .description("Start a virtual machine")
        .action(async (resourceGroup: string, vmName: string) => {
          if (!state.vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            await state.vmManager.startVM(resourceGroup, vmName);
            console.log(theme.success(`Started VM: ${vmName}`));
          } catch (error) {
            console.error(theme.error(`Failed to start VM: ${formatErrorMessage(error)}`));
          }
        });

      vmCmd
        .command("stop <resourceGroup> <vmName>")
        .description("Stop a virtual machine")
        .action(async (resourceGroup: string, vmName: string) => {
          if (!state.vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            await state.vmManager.stopVM(resourceGroup, vmName);
            console.log(theme.success(`Stopped VM: ${vmName}`));
          } catch (error) {
            console.error(theme.error(`Failed to stop VM: ${formatErrorMessage(error)}`));
          }
        });

      vmCmd
        .command("restart <resourceGroup> <vmName>")
        .description("Restart a virtual machine")
        .action(async (resourceGroup: string, vmName: string) => {
          if (!state.vmManager) { console.error(theme.error("VM manager not initialized")); return; }
          try {
            await state.vmManager.restartVM(resourceGroup, vmName);
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
        .option("--limit <n>", "Max items to return", parseInt)
        .option("--offset <n>", "Items to skip", parseInt)
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string; limit?: number; offset?: number };
          if (!state.storageManager) { console.error(theme.error("Storage manager not initialized")); return; }
          try {
            validatePagination({ limit: options.limit, offset: options.offset });
            if (options.limit !== undefined) {
              const result = await state.storageManager.listStorageAccounts(options.resourceGroup, { limit: options.limit, offset: options.offset }) as AzurePagedResult<import("./storage/types.js").StorageAccount>;
              if (result.items.length === 0) { console.log("No storage accounts found"); return; }
              console.log("\nStorage Accounts:\n");
              for (const sa of result.items) {
                console.log(`  ${sa.name}`);
                console.log(`    Kind: ${sa.kind}`);
                console.log(`    SKU: ${sa.sku}`);
                console.log(`    Location: ${sa.location}`);
                console.log();
              }
              if (result.hasMore) console.log(theme.muted(`  ... more results available (use --offset ${(options.offset ?? 0) + options.limit})`));
            } else {
              const accounts = await state.storageManager.listStorageAccounts(options.resourceGroup);
              if (accounts.length === 0) { console.log("No storage accounts found"); return; }
              console.log("\nStorage Accounts:\n");
              for (const sa of accounts) {
                console.log(`  ${sa.name}`);
                console.log(`    Kind: ${sa.kind}`);
                console.log(`    SKU: ${sa.sku}`);
                console.log(`    Location: ${sa.location}`);
                console.log();
              }
            }
          } catch (error) {
            console.error(theme.error(`Failed to list storage accounts: ${formatErrorMessage(error)}`));
          }
        });

      storageCmd
        .command("containers <resourceGroup> <accountName>")
        .description("List containers in a storage account")
        .action(async (resourceGroup: string, accountName: string) => {
          if (!state.storageManager) { console.error(theme.error("Storage manager not initialized")); return; }
          try {
            const containers = await state.storageManager.listContainers(resourceGroup, accountName);
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
        .option("--limit <n>", "Max items to return", parseInt)
        .option("--offset <n>", "Items to skip", parseInt)
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { limit?: number; offset?: number };
          if (!state.resourceManager) { console.error(theme.error("Resource manager not initialized")); return; }
          try {
            validatePagination({ limit: options.limit, offset: options.offset });
            if (options.limit !== undefined) {
              const result = await state.resourceManager.listResourceGroups({ limit: options.limit, offset: options.offset }) as AzurePagedResult<import("./resources/types.js").ResourceGroup>;
              if (result.items.length === 0) { console.log("No resource groups found"); return; }
              console.log("\nResource Groups:\n");
              for (const rg of result.items) {
                console.log(`  ${rg.name}  ${theme.muted(rg.location)}`);
              }
              if (result.hasMore) console.log(theme.muted(`  ... more results available (use --offset ${(options.offset ?? 0) + options.limit})`));
            } else {
              const groups = await state.resourceManager.listResourceGroups();
              if (groups.length === 0) { console.log("No resource groups found"); return; }
              console.log("\nResource Groups:\n");
              for (const rg of groups) {
                console.log(`  ${rg.name}  ${theme.muted(rg.location)}`);
              }
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
          if (!state.functionsManager) { console.error(theme.error("Functions manager not initialized")); return; }
          try {
            const apps = await state.functionsManager.listFunctionApps(options.resourceGroup);
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
          if (!state.containerManager) { console.error(theme.error("Container manager not initialized")); return; }
          try {
            const clusters = await state.containerManager.listAKSClusters(options.resourceGroup);
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
          if (!state.keyVaultManager) { console.error(theme.error("KeyVault manager not initialized")); return; }
          try {
            const vaults = await state.keyVaultManager.listVaults(options.resourceGroup);
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
          if (!state.sqlManager) { console.error(theme.error("SQL manager not initialized")); return; }
          try {
            const servers = await state.sqlManager.listServers(options.resourceGroup);
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
          if (!state.costManager) { console.error(theme.error("Cost manager not initialized")); return; }
          try {
            const result = await state.costManager.queryCosts({ timeframe: options.timeframe });
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
          if (!state.subscriptionManager) { console.error(theme.error("Subscription manager not initialized")); return; }
          try {
            const subs = await state.subscriptionManager.listSubscriptions();
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
          if (!state.credentialsManager) { console.error(theme.error("Not initialized")); return; }
          try {
            const result = await state.credentialsManager.getCredential();
            console.log("\nAzure Status:\n");
            console.log(`  Authenticated: ${theme.success("yes")}`);
            console.log(`  Subscription: ${result.subscriptionId ?? state.config.defaultSubscription ?? theme.muted("not set")}`);
            console.log(`  Tenant: ${result.tenantId ?? state.config.defaultTenantId ?? theme.muted("not set")}`);
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
          if (!state.dnsManager) { console.error(theme.error("DNS manager not initialized")); return; }
          try {
            const zones = await state.dnsManager.listZones(options.resourceGroup);
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
          if (!state.dnsManager) { console.error(theme.error("DNS manager not initialized")); return; }
          try {
            const records = await state.dnsManager.listRecordSets(resourceGroup, zoneName);
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
          if (!state.redisManager) { console.error(theme.error("Redis manager not initialized")); return; }
          try {
            const caches = await state.redisManager.listCaches(options.resourceGroup);
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
          if (!state.redisManager) { console.error(theme.error("Redis manager not initialized")); return; }
          try {
            const cache = await state.redisManager.getCache(resourceGroup, cacheName);
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
          if (!state.cdnManager) { console.error(theme.error("CDN manager not initialized")); return; }
          try {
            const profiles = await state.cdnManager.listProfiles(options.resourceGroup);
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
          if (!state.cdnManager) { console.error(theme.error("CDN manager not initialized")); return; }
          try {
            const endpoints = await state.cdnManager.listEndpoints(resourceGroup, profileName);
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
          if (!state.networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const vnets = await state.networkManager.listVNets(options.resourceGroup);
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
          if (!state.networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const nsgs = await state.networkManager.listNSGs(options.resourceGroup);
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
          if (!state.networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const lbs = await state.networkManager.listLoadBalancers(options.resourceGroup);
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
          if (!state.networkManager) { console.error(theme.error("Network manager not initialized")); return; }
          try {
            const pips = await state.networkManager.listPublicIPs(options.resourceGroup);
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
          if (!state.cosmosDBManager) { console.error(theme.error("Cosmos DB manager not initialized")); return; }
          try {
            const accounts = await state.cosmosDBManager.listAccounts(options.resourceGroup);
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
          if (!state.cosmosDBManager) { console.error(theme.error("Cosmos DB manager not initialized")); return; }
          try {
            const dbs = await state.cosmosDBManager.listDatabases(resourceGroup, accountName);
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
          if (!state.serviceBusManager) { console.error(theme.error("Service Bus manager not initialized")); return; }
          try {
            const ns = await state.serviceBusManager.listNamespaces(options.resourceGroup);
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
          if (!state.serviceBusManager) { console.error(theme.error("Service Bus manager not initialized")); return; }
          try {
            const queues = await state.serviceBusManager.listQueues(resourceGroup, namespace);
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
          if (!state.serviceBusManager) { console.error(theme.error("Service Bus manager not initialized")); return; }
          try {
            const topics = await state.serviceBusManager.listTopics(resourceGroup, namespace);
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
          if (!state.eventGridManager) { console.error(theme.error("Event Grid manager not initialized")); return; }
          try {
            const topics = await state.eventGridManager.listTopics(options.resourceGroup);
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
          if (!state.eventGridManager) { console.error(theme.error("Event Grid manager not initialized")); return; }
          try {
            const domains = await state.eventGridManager.listDomains(options.resourceGroup);
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
          if (!state.securityManager) { console.error(theme.error("Security manager not initialized")); return; }
          try {
            const scores = await state.securityManager.getSecureScores();
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
          if (!state.securityManager) { console.error(theme.error("Security manager not initialized")); return; }
          try {
            const alerts = await state.securityManager.listAlerts(options.resourceGroup);
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
          if (!state.securityManager) { console.error(theme.error("Security manager not initialized")); return; }
          try {
            const recs = await state.securityManager.listRecommendations();
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
          if (!state.iamManager) { console.error(theme.error("IAM manager not initialized")); return; }
          try {
            const roles = await state.iamManager.listRoleDefinitions(options.scope);
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
          if (!state.iamManager) { console.error(theme.error("IAM manager not initialized")); return; }
          try {
            const assignments = await state.iamManager.listRoleAssignments(options.scope);
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
          if (!state.policyManager) { console.error(theme.error("Policy manager not initialized")); return; }
          try {
            const defs = await state.policyManager.listDefinitions();
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
          if (!state.policyManager) { console.error(theme.error("Policy manager not initialized")); return; }
          try {
            const assignments = await state.policyManager.listAssignments(options.scope);
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
          if (!state.policyManager) { console.error(theme.error("Policy manager not initialized")); return; }
          try {
            const states = await state.policyManager.getComplianceState(options.scope);
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
          if (!state.backupManager) { console.error(theme.error("Backup manager not initialized")); return; }
          try {
            const vaults = await state.backupManager.listVaults(options.resourceGroup);
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
          if (!state.backupManager) { console.error(theme.error("Backup manager not initialized")); return; }
          try {
            const items = await state.backupManager.listBackupItems(resourceGroup, vaultName);
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
          if (!state.backupManager) { console.error(theme.error("Backup manager not initialized")); return; }
          try {
            const jobs = await state.backupManager.listBackupJobs(resourceGroup, vaultName);
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
          if (!state.automationManager) { console.error(theme.error("Automation manager not initialized")); return; }
          try {
            const accounts = await state.automationManager.listAccounts(options.resourceGroup);
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
          if (!state.automationManager) { console.error(theme.error("Automation manager not initialized")); return; }
          try {
            const runbooks = await state.automationManager.listRunbooks(resourceGroup, accountName);
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
          if (!state.automationManager) { console.error(theme.error("Automation manager not initialized")); return; }
          try {
            const jobs = await state.automationManager.listJobs(resourceGroup, accountName);
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
          if (!state.logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            const workflows = await state.logicManager.listWorkflows(options.resourceGroup);
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
          if (!state.logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            const runs = await state.logicManager.listRuns(resourceGroup, workflowName);
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
          if (!state.logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            await state.logicManager.enableWorkflow(resourceGroup, workflowName);
            console.log(theme.success(`Enabled Logic App: ${workflowName}`));
          } catch (error) {
            console.error(theme.error(`Failed to enable Logic App: ${formatErrorMessage(error)}`));
          }
        });

      logicCmd
        .command("disable <resourceGroup> <workflowName>")
        .description("Disable a Logic App workflow")
        .action(async (resourceGroup: string, workflowName: string) => {
          if (!state.logicManager) { console.error(theme.error("Logic Apps manager not initialized")); return; }
          try {
            await state.logicManager.disableWorkflow(resourceGroup, workflowName);
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
          if (!state.apimManager) { console.error(theme.error("API Management manager not initialized")); return; }
          try {
            const services = await state.apimManager.listServices(options.resourceGroup);
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
          if (!state.apimManager) { console.error(theme.error("API Management manager not initialized")); return; }
          try {
            const apis = await state.apimManager.listAPIs(resourceGroup, serviceName);
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
          if (!state.devOpsManager) { console.error(theme.error("DevOps manager not initialized")); return; }
          try {
            const projects = await state.devOpsManager.listProjects();
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
          if (!state.devOpsManager) { console.error(theme.error("DevOps manager not initialized")); return; }
          try {
            const pipelines = await state.devOpsManager.listPipelines(projectName);
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
          if (!state.devOpsManager) { console.error(theme.error("DevOps manager not initialized")); return; }
          try {
            const repos = await state.devOpsManager.listRepositories(projectName);
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
          if (!state.patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const pats = state.patManager.listPATs(opts.org);
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
          if (!state.patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const summary = await state.patManager.storePAT({
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
          if (!state.patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const deleted = await state.patManager.deletePAT(id);
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
          if (!state.patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            if (id) {
              const result = await state.patManager.validatePAT(id);
              if (result.valid) {
                console.log(theme.success(`PAT valid — ${result.displayName} (${result.emailAddress})`));
              } else {
                console.error(theme.error(`PAT invalid: ${result.error}`));
              }
            } else {
              const results = await state.patManager.validateAll();
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
          if (!state.patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const summary = await state.patManager.rotatePAT(id, opts.token, opts.expires);
            console.log(theme.success(`PAT rotated: ${summary.label}`));
          } catch (error) {
            console.error(theme.error(`Failed to rotate PAT: ${formatErrorMessage(error)}`));
          }
        });

      patCmd
        .command("check-expiry")
        .description("Check for expired or expiring-soon PATs")
        .action(() => {
          if (!state.patManager) { console.error(theme.error("PAT manager not initialized")); return; }
          try {
            const problems = state.patManager.checkExpiry();
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
          if (!state.orchestrator) { console.error(theme.error("Orchestrator not initialized")); return; }
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
            const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun });
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

      advisorCmd
        .command("prompt <projectPath>")
        .description("Analyze a project and interactively prompt for missing blueprint parameters")
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
            const session = createPromptSession(rec);
            if (!session) {
              console.log(theme.warn("No blueprint matched — cannot determine parameters to prompt."));
              return;
            }
            if (session.ready) {
              console.log(theme.success("All parameters are already inferred — no prompting needed."));
              console.log(`  Blueprint: ${session.blueprintName}`);
              console.log(`  Params: ${JSON.stringify(session.inferredParams, null, 2)}`);
              return;
            }
            console.log(`\n${theme.info(`Blueprint: ${session.blueprintName}`)}\n`);
            console.log(`${session.message}\n`);
            for (const q of session.questions) {
              const tag = q.required ? theme.warn("[REQUIRED]") : theme.muted("[optional]");
              console.log(`  ${tag} ${q.param}: ${q.question}`);
              if (q.hint) console.log(`         ${theme.muted(q.hint)}`);
              if (q.choices) console.log(`         ${theme.muted(`Choices: ${q.choices.join(", ")}`)}`);
              if (q.default !== undefined) console.log(`         ${theme.muted(`Default: ${String(q.default)}`)}`);
            }
          } catch (error) {
            console.error(theme.error(`Prompt failed: ${formatErrorMessage(error)}`));
          }
        });

      advisorCmd
        .command("verify <projectPath>")
        .description("Run post-deploy health checks against a previous deployment result")
        .option("--region <region>", "Preferred Azure region", "eastus")
        .option("--project-name <name>", "Override project name")
        .option("--prefer-containers", "Prefer container-based deployment")
        .option("--tenant-id <id>", "Azure AD tenant ID")
        .option("--live", "Execute for real before verifying (default is dry-run)")
        .option("--skip-probes", "Skip connectivity probes")
        .action(async (projectPath: string, ...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as {
            region?: string; projectName?: string; preferContainers?: boolean;
            tenantId?: string; live?: boolean; skipProbes?: boolean;
          };
          if (!state.orchestrator) { console.error(theme.error("Orchestrator not initialized")); return; }
          try {
            const analysis = analyzeProject(projectPath);
            const { recommendation, plan, validationIssues } = recommendAndPlan(analysis, {
              defaultRegion: options.region,
              projectName: options.projectName,
              preferContainers: options.preferContainers,
              tenantId: options.tenantId,
            });
            if (!plan) {
              console.log(theme.warn("Could not generate an execution plan."));
              if (validationIssues.length > 0) for (const i of validationIssues) console.log(`  - ${i}`);
              return;
            }
            const dryRun = !options.live;
            const runner = new Orchestrator({ ...state.orchestrator["options"], dryRun });
            const result = await runner.execute(plan);
            const report = verify(result, { skipProbes: options.skipProbes });
            console.log(formatReport(report));
          } catch (error) {
            console.error(theme.error(`Verify failed: ${formatErrorMessage(error)}`));
          }
        });

      // --- Hybrid / Arc commands ---
      const hybridCmd = az.command("hybrid").description("Azure Arc & hybrid infrastructure management");

      hybridCmd
        .command("arc-servers")
        .description("List Azure Arc-enabled servers")
        .option("--resource-group <rg>", "Filter by resource group")
        .option("--status <status>", "Filter by agent status (Connected, Disconnected, Error, Expired)")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string; status?: string };
          if (!state.hybridManager) { console.error(theme.error("Hybrid manager not initialized")); return; }
          try {
            const servers = await state.hybridManager.listArcServers({
              resourceGroup: options.resourceGroup,
              status: options.status as "Connected" | "Disconnected" | "Error" | "Expired" | undefined,
            });
            if (servers.length === 0) { console.log("No Arc servers found"); return; }
            console.log("\nAzure Arc Servers:\n");
            for (const s of servers) {
              console.log(`  ${s.name}`);
              console.log(`    Status: ${s.status}`);
              console.log(`    OS: ${s.osType} (${s.osSku})`);
              console.log(`    Agent: ${s.agentVersion}`);
              console.log(`    Location: ${s.location}`);
              console.log(`    Resource Group: ${s.resourceGroup}`);
              if (s.machineFqdn) console.log(`    FQDN: ${s.machineFqdn}`);
              console.log();
            }
            console.log(theme.muted(`Total: ${servers.length} server(s)`));
          } catch (error) {
            console.error(theme.error(`Failed to list Arc servers: ${formatErrorMessage(error)}`));
          }
        });

      hybridCmd
        .command("arc-k8s")
        .description("List Azure Arc-connected Kubernetes clusters")
        .option("--resource-group <rg>", "Filter by resource group")
        .option("--distribution <dist>", "Filter by K8s distribution")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string; distribution?: string };
          if (!state.hybridManager) { console.error(theme.error("Hybrid manager not initialized")); return; }
          try {
            const clusters = await state.hybridManager.listArcKubernetesClusters({
              resourceGroup: options.resourceGroup,
              distribution: options.distribution,
            });
            if (clusters.length === 0) { console.log("No Arc Kubernetes clusters found"); return; }
            console.log("\nAzure Arc Kubernetes Clusters:\n");
            for (const c of clusters) {
              console.log(`  ${c.name}`);
              console.log(`    K8s Version: ${c.kubernetesVersion}`);
              console.log(`    Distribution: ${c.distribution}`);
              console.log(`    Nodes: ${c.totalNodeCount} (${c.totalCoreCount} cores)`);
              console.log(`    Connectivity: ${c.connectivityStatus}`);
              console.log(`    Agent: ${c.agentVersion}`);
              console.log(`    Location: ${c.location}`);
              console.log();
            }
            console.log(theme.muted(`Total: ${clusters.length} cluster(s)`));
          } catch (error) {
            console.error(theme.error(`Failed to list Arc K8s clusters: ${formatErrorMessage(error)}`));
          }
        });

      hybridCmd
        .command("hci")
        .description("List Azure Stack HCI clusters")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!state.hybridManager) { console.error(theme.error("Hybrid manager not initialized")); return; }
          try {
            const clusters = await state.hybridManager.listHCIClusters(options.resourceGroup);
            if (clusters.length === 0) { console.log("No HCI clusters found"); return; }
            console.log("\nAzure Stack HCI Clusters:\n");
            for (const c of clusters) {
              console.log(`  ${c.name}`);
              console.log(`    Status: ${c.status}`);
              console.log(`    Nodes: ${c.nodeCount}`);
              console.log(`    Version: ${c.clusterVersion ?? "N/A"}`);
              console.log(`    Location: ${c.location}`);
              if (c.lastSyncTimestamp) console.log(`    Last Sync: ${c.lastSyncTimestamp}`);
              if (c.trialDaysRemaining > 0) console.log(`    Trial Days: ${c.trialDaysRemaining}`);
              console.log();
            }
            console.log(theme.muted(`Total: ${clusters.length} cluster(s)`));
          } catch (error) {
            console.error(theme.error(`Failed to list HCI clusters: ${formatErrorMessage(error)}`));
          }
        });

      hybridCmd
        .command("custom-locations")
        .description("List Azure Custom Locations")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!state.hybridManager) { console.error(theme.error("Hybrid manager not initialized")); return; }
          try {
            const locations = await state.hybridManager.listCustomLocations(options.resourceGroup);
            if (locations.length === 0) { console.log("No custom locations found"); return; }
            console.log("\nAzure Custom Locations:\n");
            for (const cl of locations) {
              console.log(`  ${cl.displayName ?? cl.name}`);
              console.log(`    Host: ${cl.hostResourceId}`);
              console.log(`    Host Type: ${cl.hostType}`);
              console.log(`    Namespace: ${cl.namespace ?? "N/A"}`);
              console.log(`    State: ${cl.provisioningState}`);
              console.log(`    Extensions: ${cl.clusterExtensionIds?.length ?? 0}`);
              console.log();
            }
            console.log(theme.muted(`Total: ${locations.length} location(s)`));
          } catch (error) {
            console.error(theme.error(`Failed to list custom locations: ${formatErrorMessage(error)}`));
          }
        });

      hybridCmd
        .command("discover")
        .description("Full hybrid infrastructure discovery (Arc servers + K8s + HCI + Custom Locations)")
        .option("--resource-group <rg>", "Filter by resource group")
        .action(async (...args: unknown[]) => {
          const options = (args[args.length - 1] ?? {}) as { resourceGroup?: string };
          if (!state.hybridManager) { console.error(theme.error("Hybrid manager not initialized")); return; }
          try {
            const result = await state.hybridManager.discoverAll(options.resourceGroup);
            console.log("\nHybrid Infrastructure Discovery:\n");
            console.log(`  Arc Servers:      ${result.arcServers.length}`);
            console.log(`  Arc K8s Clusters: ${result.arcClusters.length}`);
            console.log(`  HCI Clusters:     ${result.hciClusters.length}`);
            console.log(`  Custom Locations: ${result.customLocations.length}`);
            console.log(`\n  Subscription: ${result.subscriptionId}`);
            console.log(`  Discovered At: ${result.discoveredAt}`);
            const total = result.arcServers.length + result.arcClusters.length + result.hciClusters.length + result.customLocations.length;
            console.log(theme.muted(`\nTotal: ${total} resource(s)`));
          } catch (error) {
            console.error(theme.error(`Failed to discover hybrid resources: ${formatErrorMessage(error)}`));
          }
        });
    });
}
