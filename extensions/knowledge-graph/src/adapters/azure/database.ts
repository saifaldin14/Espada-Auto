/**
 * Azure Adapter — Database Domain Module
 *
 * Discovers SQL Servers/Databases, CosmosDB accounts, and Redis caches
 * via Azure database managers for deeper enrichment.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper SQL resources via AzureSQLManager.
 */
export async function discoverSQLDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSQLManager();
  if (!mgr) return;

  const m = mgr as {
    listServers: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      fullyQualifiedDomainName?: string;
      administratorLogin?: string;
      version?: string;
      state?: string;
      publicNetworkAccess?: string;
      tags?: Record<string, string>;
    }>>;
    listDatabases: (rg: string, serverName: string) => Promise<Array<{
      id: string;
      name: string;
      serverName?: string;
      resourceGroup: string;
      location: string;
      status?: string;
      edition?: string;
      serviceLevelObjective?: string;
      maxSizeBytes?: number;
      elasticPoolId?: string;
      zoneRedundant?: boolean;
      creationDate?: string;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const servers = await m.listServers();
    for (const server of servers) {
      if (!server.id) continue;

      const existing = findNodeByNativeId(nodes, server.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "database", server.id);

      if (existing) {
        existing.metadata.fqdn = server.fullyQualifiedDomainName;
        existing.metadata.sqlVersion = server.version;
        existing.metadata.publicNetworkAccess = server.publicNetworkAccess;
        existing.metadata.resourceSubtype = "sql-server";
        existing.metadata.discoverySource = "sql-manager";
      } else {
        const tags = server.tags ?? {};
        nodes.push({
          id: nodeId,
          name: server.name,
          resourceType: "database",
          provider: "azure",
          region: server.location,
          account: ctx.subscriptionId,
          nativeId: server.id,
          status: server.state === "Ready" ? "running" : mapAzureStatus(server.state),
          tags,
          metadata: {
            resourceGroup: server.resourceGroup,
            resourceSubtype: "sql-server",
            fqdn: server.fullyQualifiedDomainName,
            sqlVersion: server.version,
            publicNetworkAccess: server.publicNetworkAccess,
            discoverySource: "sql-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Discover databases on this server
      try {
        const databases = await m.listDatabases(server.resourceGroup, server.name);
        for (const db of databases) {
          if (!db.id || db.name === "master") continue;

          const dbExisting = findNodeByNativeId(nodes, db.id);
          if (dbExisting) {
            if (db.edition) dbExisting.metadata.edition = db.edition;
            if (db.serviceLevelObjective) dbExisting.metadata.serviceObjective = db.serviceLevelObjective;
            if (db.maxSizeBytes) dbExisting.metadata.maxSizeGb = db.maxSizeBytes / (1024 ** 3);
            if (db.zoneRedundant !== undefined) dbExisting.metadata.zoneRedundant = db.zoneRedundant;
            dbExisting.metadata.discoverySource = "sql-manager";

            // Ensure edge to server
            pushEdgeIfNew(edges, makeAzureEdge(dbExisting.id, nodeId, "runs-in", { field: "sql-server" }));
            continue;
          }

          const dbNodeId = buildAzureNodeId(ctx.subscriptionId, "database", db.id);
          const dbTags = db.tags ?? {};

          nodes.push({
            id: dbNodeId,
            name: db.name,
            resourceType: "database",
            provider: "azure",
            region: db.location,
            account: ctx.subscriptionId,
            nativeId: db.id,
            status: db.status === "Online" ? "running" : mapAzureStatus(db.status),
            tags: dbTags,
            metadata: {
              resourceGroup: db.resourceGroup,
              resourceSubtype: "sql-database",
              serverName: server.name,
              edition: db.edition,
              serviceObjective: db.serviceLevelObjective,
              maxSizeGb: db.maxSizeBytes ? db.maxSizeBytes / (1024 ** 3) : undefined,
              elasticPoolId: db.elasticPoolId,
              zoneRedundant: db.zoneRedundant,
              discoverySource: "sql-manager",
            },
            costMonthly: null,
            owner: dbTags["Owner"] ?? dbTags["owner"] ?? null,
            createdAt: db.creationDate ?? null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(dbNodeId, nodeId, "runs-in", { field: "sql-server" }));
        }
      } catch {
        // Database enumeration failed for this server
      }
    }
  } catch {
    // SQL discovery failed
  }
}

/**
 * Discover deeper CosmosDB resources via AzureCosmosDBManager.
 */
export async function discoverCosmosDBDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getCosmosDBManager();
  if (!mgr) return;

  const m = mgr as {
    listAccounts: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      kind?: string;
      documentEndpoint?: string;
      provisioningState?: string;
      consistencyPolicy?: { defaultConsistencyLevel?: string };
      enableAutomaticFailover?: boolean;
      enableMultipleWriteLocations?: boolean;
      privateEndpointConnections?: Array<{ privateEndpointId?: string }>;
      virtualNetworkRules?: Array<{ id?: string }>;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const accounts = await m.listAccounts();
    for (const acct of accounts) {
      if (!acct.id) continue;

      const existing = findNodeByNativeId(nodes, acct.id);
      if (existing) {
        if (acct.kind) existing.metadata.cosmosKind = acct.kind;
        if (acct.documentEndpoint) existing.metadata.endpoint = acct.documentEndpoint;
        if (acct.consistencyPolicy) existing.metadata.consistencyLevel = acct.consistencyPolicy.defaultConsistencyLevel;
        existing.metadata.autoFailover = acct.enableAutomaticFailover;
        existing.metadata.multiRegionWrites = acct.enableMultipleWriteLocations;
        existing.metadata.discoverySource = "cosmosdb-manager";

        // Link CosmosDB → private endpoints
        for (const pe of acct.privateEndpointConnections ?? []) {
          if (pe.privateEndpointId) {
            const peNode = findNodeByNativeId(nodes, pe.privateEndpointId);
            if (peNode) pushEdgeIfNew(edges, makeAzureEdge(existing.id, peNode.id, "peers-with", { field: "privateEndpointConnections" }));
          }
        }
        // Link CosmosDB → VNet rules
        for (const rule of acct.virtualNetworkRules ?? []) {
          if (rule.id) {
            const subnetNode = findNodeByNativeId(nodes, rule.id);
            if (subnetNode) pushEdgeIfNew(edges, makeAzureEdge(existing.id, subnetNode.id, "secured-by", { field: "virtualNetworkRules" }));
          }
        }
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "database", acct.id);
      const tags = acct.tags ?? {};

      nodes.push({
        id: nodeId,
        name: acct.name,
        resourceType: "database",
        provider: "azure",
        region: acct.location,
        account: ctx.subscriptionId,
        nativeId: acct.id,
        status: mapAzureStatus(acct.provisioningState),
        tags,
        metadata: {
          resourceGroup: acct.resourceGroup,
          resourceSubtype: "cosmosdb",
          cosmosKind: acct.kind,
          endpoint: acct.documentEndpoint,
          consistencyLevel: acct.consistencyPolicy?.defaultConsistencyLevel,
          autoFailover: acct.enableAutomaticFailover,
          multiRegionWrites: acct.enableMultipleWriteLocations,
          discoverySource: "cosmosdb-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Link CosmosDB → private endpoints
      for (const pe of acct.privateEndpointConnections ?? []) {
        if (pe.privateEndpointId) {
          const peNode = findNodeByNativeId(nodes, pe.privateEndpointId);
          if (peNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, peNode.id, "peers-with", { field: "privateEndpointConnections" }));
        }
      }
      // Link CosmosDB → VNet rules
      for (const rule of acct.virtualNetworkRules ?? []) {
        if (rule.id) {
          const subnetNode = findNodeByNativeId(nodes, rule.id);
          if (subnetNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, subnetNode.id, "secured-by", { field: "virtualNetworkRules" }));
        }
      }
    }
  } catch {
    // CosmosDB discovery failed
  }
}

/**
 * Discover deeper Redis resources via AzureRedisManager.
 */
export async function discoverRedisDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getRedisManager();
  if (!mgr) return;

  const m = mgr as {
    listCaches: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      hostName?: string;
      port?: number;
      sslPort?: number;
      sku?: string;
      provisioningState?: string;
      redisVersion?: string;
      enableNonSslPort?: boolean;
      minimumTlsVersion?: string;
      subnetId?: string;
      privateEndpointConnections?: Array<{ privateEndpointId?: string }>;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const caches = await m.listCaches();
    for (const cache of caches) {
      if (!cache.id) continue;

      const existing = findNodeByNativeId(nodes, cache.id);
      if (existing) {
        if (cache.hostName) existing.metadata.hostName = cache.hostName;
        if (cache.redisVersion) existing.metadata.redisVersion = cache.redisVersion;
        if (cache.minimumTlsVersion) existing.metadata.minimumTlsVersion = cache.minimumTlsVersion;
        existing.metadata.enableNonSslPort = cache.enableNonSslPort;
        existing.metadata.discoverySource = "redis-manager";

        // Link Redis → subnet
        if (cache.subnetId) {
          const subnetNode = findNodeByNativeId(nodes, cache.subnetId);
          if (subnetNode) pushEdgeIfNew(edges, makeAzureEdge(existing.id, subnetNode.id, "runs-in", { field: "subnetId" }));
        }
        // Link Redis → private endpoints
        for (const pe of cache.privateEndpointConnections ?? []) {
          if (pe.privateEndpointId) {
            const peNode = findNodeByNativeId(nodes, pe.privateEndpointId);
            if (peNode) pushEdgeIfNew(edges, makeAzureEdge(existing.id, peNode.id, "peers-with", { field: "privateEndpointConnections" }));
          }
        }
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "cache", cache.id);
      const tags = cache.tags ?? {};

      nodes.push({
        id: nodeId,
        name: cache.name,
        resourceType: "cache",
        provider: "azure",
        region: cache.location,
        account: ctx.subscriptionId,
        nativeId: cache.id,
        status: mapAzureStatus(cache.provisioningState),
        tags,
        metadata: {
          resourceGroup: cache.resourceGroup,
          hostName: cache.hostName,
          port: cache.port,
          sslPort: cache.sslPort,
          redisSku: cache.sku,
          redisVersion: cache.redisVersion,
          enableNonSslPort: cache.enableNonSslPort,
          minimumTlsVersion: cache.minimumTlsVersion,
          discoverySource: "redis-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Link Redis → subnet
      if (cache.subnetId) {
        const subnetNode = findNodeByNativeId(nodes, cache.subnetId);
        if (subnetNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, subnetNode.id, "runs-in", { field: "subnetId" }));
      }
      // Link Redis → private endpoints
      for (const pe of cache.privateEndpointConnections ?? []) {
        if (pe.privateEndpointId) {
          const peNode = findNodeByNativeId(nodes, pe.privateEndpointId);
          if (peNode) pushEdgeIfNew(edges, makeAzureEdge(nodeId, peNode.id, "peers-with", { field: "privateEndpointConnections" }));
        }
      }
    }
  } catch {
    // Redis discovery failed
  }
}

// =============================================================================
// Flexible Server Database Discovery (MySQL / PostgreSQL)
// =============================================================================

/**
 * Discover Azure Database for MySQL/PostgreSQL flexible servers.
 */
export async function discoverFlexDatabaseDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getDatabaseManager();
  if (!mgr) return;

  const m = mgr as {
    listMySQLFlexServers?: () => Promise<unknown[]>;
    listPostgreSQLFlexServers?: () => Promise<unknown[]>;
  };

  // MySQL Flexible Servers
  const mysqlServers = await m.listMySQLFlexServers?.() ?? [];
  for (const raw of mysqlServers) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "mysql-flex";
    const location = (s["location"] as string) ?? "unknown";
    const state = (s["state"] as string) ?? "";

    const existing = findNodeByNativeId(nodes, id);
    if (existing) {
      existing.metadata.resourceSubtype = "mysql-flexible-server";
      existing.metadata.version = (s["version"] as string) ?? null;
      existing.metadata.discoverySource = "database-manager";
      continue;
    }

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "database", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "database",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: state.toLowerCase() === "ready" ? "running" : state.toLowerCase() === "stopped" ? "stopped" : "unknown",
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.dbformysql/flexibleservers",
        resourceSubtype: "mysql-flexible-server",
        version: (s["version"] as string) ?? null,
        sku: (s["sku"] as Record<string, unknown>)?.["name"] ?? null,
        haEnabled: (s["highAvailability"] as Record<string, unknown>)?.["mode"] ?? null,
        discoverySource: "database-manager",
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }

  // PostgreSQL Flexible Servers
  const pgServers = await m.listPostgreSQLFlexServers?.() ?? [];
  for (const raw of pgServers) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "pg-flex";
    const location = (s["location"] as string) ?? "unknown";
    const state = (s["state"] as string) ?? "";

    const existing = findNodeByNativeId(nodes, id);
    if (existing) {
      existing.metadata.resourceSubtype = "postgresql-flexible-server";
      existing.metadata.version = (s["version"] as string) ?? null;
      existing.metadata.discoverySource = "database-manager";
      continue;
    }

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "database", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "database",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: state.toLowerCase() === "ready" ? "running" : state.toLowerCase() === "stopped" ? "stopped" : "unknown",
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.dbforpostgresql/flexibleservers",
        resourceSubtype: "postgresql-flexible-server",
        version: (s["version"] as string) ?? null,
        sku: (s["sku"] as Record<string, unknown>)?.["name"] ?? null,
        haEnabled: (s["highAvailability"] as Record<string, unknown>)?.["mode"] ?? null,
        discoverySource: "database-manager",
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}
