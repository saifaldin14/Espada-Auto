/**
 * Azure Adapter — Compute Domain Module
 *
 * Discovers VMs and VMSS via AzureVMManager for deeper enrichment
 * beyond what Resource Graph provides (power state, OS details, GPU detection).
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper VM resources via AzureVMManager.
 * Enriches existing compute nodes and discovers VMs not found by Resource Graph.
 */
export async function discoverComputeDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getVMManager();
  if (!mgr) return;

  const m = mgr as {
    listVMs: (opts?: { resourceGroup?: string }) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      vmSize?: string;
      powerState?: string;
      provisioningState?: string;
      osType?: string;
      osDiskSizeGB?: number;
      adminUsername?: string;
      computerName?: string;
      tags?: Record<string, string>;
      networkInterfaces?: Array<{ id?: string }>;
      imageReference?: { publisher?: string; offer?: string; sku?: string; version?: string };
      availabilityZone?: string;
    }>>;
  };

  try {
    const vms = await m.listVMs();

    for (const vm of vms) {
      if (!vm.id) continue;

      // Check if this VM already exists from Resource Graph
      const existingNode = findNodeByNativeId(nodes, vm.id);

      if (existingNode) {
        // Enrich existing node with deeper metadata
        if (vm.powerState) {
          existingNode.status = mapAzureStatus(vm.provisioningState, vm.powerState);
        }
        if (vm.vmSize) {
          existingNode.metadata = {
            ...existingNode.metadata,
            vmSize: vm.vmSize,
            discoverySource: "vm-manager",
          };
          // Detect GPU instances
          const size = vm.vmSize.toLowerCase();
          if (/^standard_n[a-z]|^standard_nc|^standard_nd/.test(size)) {
            existingNode.metadata.isGpuInstance = true;
            existingNode.metadata.aiWorkload = true;
          }
        }
        if (vm.osType) existingNode.metadata.osType = vm.osType;
        if (vm.osDiskSizeGB) existingNode.metadata.osDiskSizeGB = vm.osDiskSizeGB;
        if (vm.availabilityZone) existingNode.metadata.availabilityZone = vm.availabilityZone;
        if (vm.imageReference) existingNode.metadata.imageReference = vm.imageReference;
        continue;
      }

      // Create new node for VM not found via Resource Graph
      const nodeId = buildAzureNodeId(ctx.subscriptionId, "compute", vm.id);
      const tags = vm.tags ?? {};

      nodes.push({
        id: nodeId,
        name: vm.name,
        resourceType: "compute",
        provider: "azure",
        region: vm.location,
        account: ctx.subscriptionId,
        nativeId: vm.id,
        status: mapAzureStatus(vm.provisioningState, vm.powerState),
        tags,
        metadata: {
          resourceGroup: vm.resourceGroup,
          vmSize: vm.vmSize,
          osType: vm.osType,
          osDiskSizeGB: vm.osDiskSizeGB,
          computerName: vm.computerName,
          availabilityZone: vm.availabilityZone,
          imageReference: vm.imageReference,
          discoverySource: "vm-manager",
          ...(vm.vmSize && /^standard_n[a-z]|^standard_nc|^standard_nd/.test(vm.vmSize.toLowerCase())
            ? { isGpuInstance: true, aiWorkload: true }
            : {}),
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Link VM → NIC
      if (vm.networkInterfaces) {
        for (const nic of vm.networkInterfaces) {
          if (!nic.id) continue;
          const nicNode = findNodeByNativeId(nodes, nic.id);
          if (nicNode) {
            pushEdgeIfNew(edges, makeAzureEdge(nodeId, nicNode.id, "attached-to", { field: "networkInterfaces" }));
          }
        }
      }
    }
  } catch {
    // VM manager call failed — skip silently (Resource Graph data is the baseline)
  }
}
