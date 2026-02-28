/**
 * Azure Adapter — DNS Domain Module
 *
 * Discovers DNS zones, record sets, and creates resolution edges.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper DNS resources via AzureDNSManager.
 */
export async function discoverDNSDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getDNSManager();
  if (!mgr) return;

  const m = mgr as {
    listZones: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      zoneType?: string;
      numberOfRecordSets?: number;
      maxNumberOfRecordSets?: number;
      nameServers?: string[];
      tags?: Record<string, string>;
    }>>;
    listRecordSets: (rg: string, zoneName: string) => Promise<Array<{
      id?: string;
      name: string;
      type?: string;
      ttl?: number;
      aRecords?: Array<{ ipv4Address?: string }>;
      cnameRecord?: { cname?: string };
      aliasTarget?: { resourceId?: string };
    }>>;
  };

  try {
    const zones = await m.listZones();
    for (const zone of zones) {
      if (!zone.id) continue;

      const existing = findNodeByNativeId(nodes, zone.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "dns", zone.id);

      if (existing) {
        existing.metadata.zoneType = zone.zoneType;
        existing.metadata.recordSetCount = zone.numberOfRecordSets;
        existing.metadata.nameServers = zone.nameServers;
        existing.metadata.discoverySource = "dns-manager";
      } else {
        const tags = zone.tags ?? {};
        nodes.push({
          id: nodeId,
          name: zone.name,
          resourceType: "dns",
          provider: "azure",
          region: zone.location,
          account: ctx.subscriptionId,
          nativeId: zone.id,
          status: "running",
          tags,
          metadata: {
            resourceGroup: zone.resourceGroup,
            zoneType: zone.zoneType,
            recordSetCount: zone.numberOfRecordSets,
            maxRecordSets: zone.maxNumberOfRecordSets,
            nameServers: zone.nameServers,
            discoverySource: "dns-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Discover record sets and create resolution edges
      try {
        const records = await m.listRecordSets(zone.resourceGroup, zone.name);
        for (const record of records) {
          // Link DNS alias targets to Azure resources
          if (record.aliasTarget?.resourceId) {
            const targetNode = findNodeByNativeId(nodes, record.aliasTarget.resourceId);
            if (targetNode) {
              pushEdgeIfNew(edges, makeAzureEdge(nodeId, targetNode.id, "resolves-to", {
                field: "dnsRecord",
                recordName: record.name,
                recordType: record.type,
              }));
            }
          }
        }
      } catch {
        // Record set enumeration failed
      }
    }
  } catch {
    // DNS zone discovery failed
  }
}
