/**
 * Azure Adapter — Messaging Domain Module
 *
 * Discovers Service Bus namespaces/queues/topics, Event Hubs namespaces,
 * and Event Grid topics/subscriptions via respective managers.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper Service Bus resources.
 */
export async function discoverServiceBusDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getServiceBusManager();
  if (!mgr) return;

  const m = mgr as {
    listNamespaces: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      tier?: string;
      endpoint?: string;
      provisioningState?: string;
      createdAt?: string;
      tags?: Record<string, string>;
    }>>;
    listQueues: (rg: string, ns: string) => Promise<Array<{
      id?: string;
      name: string;
      maxSizeInMegabytes?: number;
      messageCount?: number;
      status?: string;
    }>>;
    listTopics: (rg: string, ns: string) => Promise<Array<{
      id?: string;
      name: string;
      maxSizeInMegabytes?: number;
      subscriptionCount?: number;
      status?: string;
    }>>;
  };

  try {
    const namespaces = await m.listNamespaces();
    for (const ns of namespaces) {
      if (!ns.id) continue;

      const existing = findNodeByNativeId(nodes, ns.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "queue", ns.id);

      if (existing) {
        if (ns.sku) existing.metadata.sbSku = ns.sku;
        if (ns.tier) existing.metadata.sbTier = ns.tier;
        if (ns.endpoint) existing.metadata.endpoint = ns.endpoint;
        existing.metadata.resourceSubtype = "servicebus-namespace";
        existing.metadata.discoverySource = "servicebus-manager";
      } else {
        const tags = ns.tags ?? {};
        nodes.push({
          id: nodeId,
          name: ns.name,
          resourceType: "queue",
          provider: "azure",
          region: ns.location,
          account: ctx.subscriptionId,
          nativeId: ns.id,
          status: mapAzureStatus(ns.provisioningState),
          tags,
          metadata: {
            resourceGroup: ns.resourceGroup,
            resourceSubtype: "servicebus-namespace",
            sbSku: ns.sku,
            sbTier: ns.tier,
            endpoint: ns.endpoint,
            discoverySource: "servicebus-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: ns.createdAt ?? null,
        });
      }

      // Discover queues within namespace
      try {
        const queues = await m.listQueues(ns.resourceGroup, ns.name);
        for (const q of queues) {
          const queueId = q.id ?? `${ns.id}/queues/${q.name}`;
          if (findNodeByNativeId(nodes, queueId)) continue;

          const qNodeId = buildAzureNodeId(ctx.subscriptionId, "queue", queueId);
          nodes.push({
            id: qNodeId,
            name: q.name,
            resourceType: "queue",
            provider: "azure",
            region: ns.location,
            account: ctx.subscriptionId,
            nativeId: queueId,
            status: q.status === "Active" ? "running" : "unknown",
            tags: {},
            metadata: {
              resourceGroup: ns.resourceGroup,
              resourceSubtype: "servicebus-queue",
              maxSizeInMegabytes: q.maxSizeInMegabytes,
              messageCount: q.messageCount,
              discoverySource: "servicebus-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(qNodeId, nodeId, "runs-in", { field: "namespace" }));
        }
      } catch {
        // Queue enumeration failed
      }

      // Discover topics within namespace
      try {
        const topics = await m.listTopics(ns.resourceGroup, ns.name);
        for (const t of topics) {
          const topicId = t.id ?? `${ns.id}/topics/${t.name}`;
          if (findNodeByNativeId(nodes, topicId)) continue;

          const tNodeId = buildAzureNodeId(ctx.subscriptionId, "topic", topicId);
          nodes.push({
            id: tNodeId,
            name: t.name,
            resourceType: "topic",
            provider: "azure",
            region: ns.location,
            account: ctx.subscriptionId,
            nativeId: topicId,
            status: t.status === "Active" ? "running" : "unknown",
            tags: {},
            metadata: {
              resourceGroup: ns.resourceGroup,
              resourceSubtype: "servicebus-topic",
              maxSizeInMegabytes: t.maxSizeInMegabytes,
              subscriptionCount: t.subscriptionCount,
              discoverySource: "servicebus-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(tNodeId, nodeId, "runs-in", { field: "namespace" }));
        }
      } catch {
        // Topic enumeration failed
      }
    }
  } catch {
    // Service Bus discovery failed
  }
}

/**
 * Discover deeper Event Hubs resources.
 */
export async function discoverEventHubsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getEventHubsManager();
  if (!mgr) return;

  const m = mgr as {
    listNamespaces: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      tier?: string;
      capacity?: number;
      isAutoInflateEnabled?: boolean;
      maximumThroughputUnits?: number;
      provisioningState?: string;
      kafkaEnabled?: boolean;
      tags?: Record<string, string>;
    }>>;
    listEventHubs: (rg: string, ns: string) => Promise<Array<{
      id?: string;
      name: string;
      partitionCount?: number;
      messageRetentionInDays?: number;
      status?: string;
    }>>;
  };

  try {
    const namespaces = await m.listNamespaces();
    for (const ns of namespaces) {
      if (!ns.id) continue;

      const existing = findNodeByNativeId(nodes, ns.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "stream", ns.id);

      if (existing) {
        existing.metadata.ehSku = ns.sku;
        existing.metadata.ehCapacity = ns.capacity;
        existing.metadata.kafkaEnabled = ns.kafkaEnabled;
        existing.metadata.autoInflate = ns.isAutoInflateEnabled;
        existing.metadata.resourceSubtype = "eventhubs-namespace";
        existing.metadata.discoverySource = "eventhubs-manager";
      } else {
        const tags = ns.tags ?? {};
        nodes.push({
          id: nodeId,
          name: ns.name,
          resourceType: "stream",
          provider: "azure",
          region: ns.location,
          account: ctx.subscriptionId,
          nativeId: ns.id,
          status: mapAzureStatus(ns.provisioningState),
          tags,
          metadata: {
            resourceGroup: ns.resourceGroup,
            resourceSubtype: "eventhubs-namespace",
            ehSku: ns.sku,
            ehCapacity: ns.capacity,
            kafkaEnabled: ns.kafkaEnabled,
            autoInflate: ns.isAutoInflateEnabled,
            maximumThroughputUnits: ns.maximumThroughputUnits,
            discoverySource: "eventhubs-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Discover event hubs within namespace
      try {
        const hubs = await m.listEventHubs(ns.resourceGroup, ns.name);
        for (const hub of hubs) {
          const hubId = hub.id ?? `${ns.id}/eventhubs/${hub.name}`;
          if (findNodeByNativeId(nodes, hubId)) continue;

          const hubNodeId = buildAzureNodeId(ctx.subscriptionId, "stream", hubId);
          nodes.push({
            id: hubNodeId,
            name: hub.name,
            resourceType: "stream",
            provider: "azure",
            region: ns.location,
            account: ctx.subscriptionId,
            nativeId: hubId,
            status: hub.status === "Active" ? "running" : "unknown",
            tags: {},
            metadata: {
              resourceGroup: ns.resourceGroup,
              resourceSubtype: "event-hub",
              partitionCount: hub.partitionCount,
              messageRetentionInDays: hub.messageRetentionInDays,
              discoverySource: "eventhubs-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(hubNodeId, nodeId, "runs-in", { field: "namespace" }));
        }
      } catch {
        // Event Hub enumeration failed
      }
    }
  } catch {
    // Event Hubs discovery failed
  }
}

/**
 * Discover deeper Event Grid resources.
 */
export async function discoverEventGridDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getEventGridManager();
  if (!mgr) return;

  const m = mgr as {
    listTopics: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      endpoint?: string;
      provisioningState?: string;
      publicNetworkAccess?: string;
      inputSchema?: string;
      tags?: Record<string, string>;
    }>>;
    listEventSubscriptions: (scope?: string) => Promise<Array<{
      id?: string;
      name: string;
      destination?: { endpointType?: string; resourceId?: string };
      filter?: { subjectBeginsWith?: string };
    }>>;
  };

  try {
    const topics = await m.listTopics();
    for (const topic of topics) {
      if (!topic.id) continue;

      const existing = findNodeByNativeId(nodes, topic.id);
      if (existing) {
        if (topic.endpoint) existing.metadata.endpoint = topic.endpoint;
        if (topic.inputSchema) existing.metadata.inputSchema = topic.inputSchema;
        existing.metadata.publicNetworkAccess = topic.publicNetworkAccess;
        existing.metadata.discoverySource = "eventgrid-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "topic", topic.id);
      const tags = topic.tags ?? {};

      nodes.push({
        id: nodeId,
        name: topic.name,
        resourceType: "topic",
        provider: "azure",
        region: topic.location,
        account: ctx.subscriptionId,
        nativeId: topic.id,
        status: mapAzureStatus(topic.provisioningState),
        tags,
        metadata: {
          resourceGroup: topic.resourceGroup,
          resourceSubtype: "eventgrid-topic",
          endpoint: topic.endpoint,
          publicNetworkAccess: topic.publicNetworkAccess,
          inputSchema: topic.inputSchema,
          discoverySource: "eventgrid-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // Event Grid discovery failed
  }

  // Discover event subscriptions and link to targets
  try {
    const subscriptions = await m.listEventSubscriptions();
    for (const sub of subscriptions) {
      if (!sub.destination?.resourceId) continue;

      const targetNode = findNodeByNativeId(nodes, sub.destination.resourceId);
      if (!targetNode) continue;

      // Find any topic nodes and link subscriptions
      for (const node of nodes) {
        if (node.metadata.resourceSubtype === "eventgrid-topic" && node.provider === "azure") {
          pushEdgeIfNew(edges, makeAzureEdge(node.id, targetNode.id, "triggers", {
            field: "eventSubscription",
            subscriptionName: sub.name,
            endpointType: sub.destination.endpointType,
          }));
        }
      }
    }
  } catch {
    // Event subscriptions discovery failed
  }
}
