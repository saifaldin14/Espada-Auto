/**
 * Azure Adapter — Network Domain Module
 *
 * Discovers VNets, Subnets, NSGs, Load Balancers, Public IPs, Firewalls,
 * Application Gateways, and Front Door via Azure network managers.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper network resources via AzureNetworkManager.
 */
export async function discoverNetworkDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getNetworkManager();
  if (!mgr) return;

  const m = mgr as {
    listVNets: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      addressSpace?: string[];
      provisioningState?: string;
      enableDdosProtection?: boolean;
      subnets?: Array<{ id?: string; name?: string; addressPrefix?: string; networkSecurityGroupId?: string }>;
      tags?: Record<string, string>;
    }>>;
    listNSGs: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      provisioningState?: string;
      securityRules?: Array<{
        name?: string;
        direction?: string;
        access?: string;
        priority?: number;
        protocol?: string;
        sourceAddressPrefix?: string;
        destinationPortRange?: string;
      }>;
      tags?: Record<string, string>;
    }>>;
    listLoadBalancers: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      provisioningState?: string;
      frontendIPConfigurations?: Array<{ publicIPAddressId?: string; subnetId?: string }>;
      backendAddressPools?: Array<{ id?: string; name?: string }>;
      tags?: Record<string, string>;
    }>>;
    listPublicIPs: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      ipAddress?: string;
      publicIPAllocationMethod?: string;
      provisioningState?: string;
      tags?: Record<string, string>;
    }>>;
  };

  // --- VNets with Subnets ---
  try {
    const vnets = await m.listVNets();
    for (const vnet of vnets) {
      if (!vnet.id) continue;

      const existing = findNodeByNativeId(nodes, vnet.id);
      if (existing) {
        if (vnet.addressSpace) existing.metadata.addressSpace = vnet.addressSpace;
        if (vnet.enableDdosProtection !== undefined) existing.metadata.ddosProtection = vnet.enableDdosProtection;
        existing.metadata.subnetCount = vnet.subnets?.length ?? 0;
        existing.metadata.discoverySource = "network-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "vpc", vnet.id);
      const tags = vnet.tags ?? {};

      nodes.push({
        id: nodeId,
        name: vnet.name,
        resourceType: "vpc",
        provider: "azure",
        region: vnet.location,
        account: ctx.subscriptionId,
        nativeId: vnet.id,
        status: mapAzureStatus(vnet.provisioningState),
        tags,
        metadata: {
          resourceGroup: vnet.resourceGroup,
          addressSpace: vnet.addressSpace,
          ddosProtection: vnet.enableDdosProtection,
          subnetCount: vnet.subnets?.length ?? 0,
          discoverySource: "network-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Create subnets as nodes and link to VNet
      if (vnet.subnets) {
        for (const subnet of vnet.subnets) {
          if (!subnet.id) continue;

          const subnetExisting = findNodeByNativeId(nodes, subnet.id);
          if (subnetExisting) {
            pushEdgeIfNew(edges, makeAzureEdge(subnetExisting.id, nodeId, "runs-in", { field: "vnet-subnet" }));
            continue;
          }

          const subnetNodeId = buildAzureNodeId(ctx.subscriptionId, "subnet", subnet.id);
          nodes.push({
            id: subnetNodeId,
            name: subnet.name ?? "subnet",
            resourceType: "subnet",
            provider: "azure",
            region: vnet.location,
            account: ctx.subscriptionId,
            nativeId: subnet.id,
            status: "running",
            tags: {},
            metadata: {
              resourceGroup: vnet.resourceGroup,
              addressPrefix: subnet.addressPrefix,
              discoverySource: "network-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(subnetNodeId, nodeId, "runs-in", { field: "vnet-subnet" }));

          // Link subnet → NSG
          if (subnet.networkSecurityGroupId) {
            const nsgNode = findNodeByNativeId(nodes, subnet.networkSecurityGroupId);
            if (nsgNode) {
              pushEdgeIfNew(edges, makeAzureEdge(subnetNodeId, nsgNode.id, "secured-by", { field: "networkSecurityGroup" }));
            }
          }
        }
      }
    }
  } catch {
    // VNet discovery failed — skip silently
  }

  // --- NSGs ---
  try {
    const nsgs = await m.listNSGs();
    for (const nsg of nsgs) {
      if (!nsg.id) continue;

      const existing = findNodeByNativeId(nodes, nsg.id);
      if (existing) {
        if (nsg.securityRules) {
          existing.metadata.ruleCount = nsg.securityRules.length;
          existing.metadata.securityRules = nsg.securityRules;
        }
        existing.metadata.discoverySource = "network-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "security-group", nsg.id);
      const tags = nsg.tags ?? {};

      nodes.push({
        id: nodeId,
        name: nsg.name,
        resourceType: "security-group",
        provider: "azure",
        region: nsg.location,
        account: ctx.subscriptionId,
        nativeId: nsg.id,
        status: mapAzureStatus(nsg.provisioningState),
        tags,
        metadata: {
          resourceGroup: nsg.resourceGroup,
          ruleCount: nsg.securityRules?.length ?? 0,
          securityRules: nsg.securityRules,
          discoverySource: "network-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // NSG discovery failed
  }

  // --- Load Balancers ---
  try {
    const lbs = await m.listLoadBalancers();
    for (const lb of lbs) {
      if (!lb.id) continue;

      const existing = findNodeByNativeId(nodes, lb.id);
      if (existing) {
        if (lb.sku) existing.metadata.lbSku = lb.sku;
        existing.metadata.backendPoolCount = lb.backendAddressPools?.length ?? 0;
        existing.metadata.discoverySource = "network-manager";

        // Link LB → public IPs
        if (lb.frontendIPConfigurations) {
          for (const fe of lb.frontendIPConfigurations) {
            if (fe.publicIPAddressId) {
              const pipNode = findNodeByNativeId(nodes, fe.publicIPAddressId);
              if (pipNode) {
                pushEdgeIfNew(edges, makeAzureEdge(existing.id, pipNode.id, "uses", { field: "frontendIPConfigurations" }));
              }
            }
          }
        }
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "load-balancer", lb.id);
      const tags = lb.tags ?? {};

      nodes.push({
        id: nodeId,
        name: lb.name,
        resourceType: "load-balancer",
        provider: "azure",
        region: lb.location,
        account: ctx.subscriptionId,
        nativeId: lb.id,
        status: mapAzureStatus(lb.provisioningState),
        tags,
        metadata: {
          resourceGroup: lb.resourceGroup,
          lbSku: lb.sku,
          backendPoolCount: lb.backendAddressPools?.length ?? 0,
          discoverySource: "network-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // LB discovery failed
  }

  // --- Public IPs ---
  try {
    const pips = await m.listPublicIPs();
    for (const pip of pips) {
      if (!pip.id) continue;

      const existing = findNodeByNativeId(nodes, pip.id);
      if (existing) {
        if (pip.ipAddress) existing.metadata.ipAddress = pip.ipAddress;
        if (pip.publicIPAllocationMethod) existing.metadata.allocationMethod = pip.publicIPAllocationMethod;
        existing.metadata.discoverySource = "network-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "network", pip.id);
      const tags = pip.tags ?? {};

      nodes.push({
        id: nodeId,
        name: pip.name,
        resourceType: "network",
        provider: "azure",
        region: pip.location,
        account: ctx.subscriptionId,
        nativeId: pip.id,
        status: mapAzureStatus(pip.provisioningState),
        tags,
        metadata: {
          resourceGroup: pip.resourceGroup,
          resourceSubtype: "public-ip",
          ipAddress: pip.ipAddress,
          allocationMethod: pip.publicIPAllocationMethod,
          discoverySource: "network-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // Public IP discovery failed
  }
}

/**
 * Discover Azure Firewall resources.
 */
export async function discoverFirewallDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getFirewallManager();
  if (!mgr) return;

  const m = mgr as {
    listFirewalls: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      provisioningState?: string;
      threatIntelMode?: string;
      skuTier?: string;
      firewallPolicyId?: string;
      ipConfigurations?: Array<{ publicIPAddressId?: string; subnetId?: string }>;
      tags?: Record<string, string>;
    }>>;
    listPolicies: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      provisioningState?: string;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const firewalls = await m.listFirewalls();
    for (const fw of firewalls) {
      if (!fw.id) continue;

      const existing = findNodeByNativeId(nodes, fw.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "network", fw.id);

      if (existing) {
        existing.metadata.threatIntelMode = fw.threatIntelMode;
        existing.metadata.skuTier = fw.skuTier;
        existing.metadata.resourceSubtype = "firewall";
        existing.metadata.discoverySource = "firewall-manager";
      } else {
        const tags = fw.tags ?? {};
        nodes.push({
          id: nodeId,
          name: fw.name,
          resourceType: "network",
          provider: "azure",
          region: fw.location,
          account: ctx.subscriptionId,
          nativeId: fw.id,
          status: mapAzureStatus(fw.provisioningState),
          tags,
          metadata: {
            resourceGroup: fw.resourceGroup,
            resourceSubtype: "firewall",
            threatIntelMode: fw.threatIntelMode,
            skuTier: fw.skuTier,
            discoverySource: "firewall-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Link firewall → subnets and public IPs
      if (fw.ipConfigurations) {
        for (const ipConf of fw.ipConfigurations) {
          if (ipConf.subnetId) {
            const subnetNode = findNodeByNativeId(nodes, ipConf.subnetId);
            if (subnetNode) {
              pushEdgeIfNew(edges, makeAzureEdge(nodeId, subnetNode.id, "runs-in", { field: "ipConfiguration.subnet" }));
            }
          }
          if (ipConf.publicIPAddressId) {
            const pipNode = findNodeByNativeId(nodes, ipConf.publicIPAddressId);
            if (pipNode) {
              pushEdgeIfNew(edges, makeAzureEdge(nodeId, pipNode.id, "uses", { field: "ipConfiguration.publicIP" }));
            }
          }
        }
      }

      // Link firewall → policy
      if (fw.firewallPolicyId) {
        const policyNode = findNodeByNativeId(nodes, fw.firewallPolicyId);
        if (policyNode) {
          pushEdgeIfNew(edges, makeAzureEdge(nodeId, policyNode.id, "secured-by", { field: "firewallPolicy" }));
        }
      }
    }
  } catch {
    // Firewall discovery failed
  }
}

/**
 * Discover Application Gateways.
 */
export async function discoverAppGatewayDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getAppGatewayManager();
  if (!mgr) return;

  const m = mgr as {
    listGateways: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      provisioningState?: string;
      operationalState?: string;
      skuName?: string;
      skuTier?: string;
      skuCapacity?: number;
      enableHttp2?: boolean;
      firewallPolicyId?: string;
      frontendIPConfigurations?: Array<{ publicIPAddressId?: string; subnetId?: string }>;
      backendAddressPools?: Array<{ id?: string; name?: string }>;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const gateways = await m.listGateways();
    for (const gw of gateways) {
      if (!gw.id) continue;

      const existing = findNodeByNativeId(nodes, gw.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "load-balancer", gw.id);

      if (existing) {
        existing.metadata.skuName = gw.skuName;
        existing.metadata.skuTier = gw.skuTier;
        existing.metadata.enableHttp2 = gw.enableHttp2;
        existing.metadata.operationalState = gw.operationalState;
        existing.metadata.resourceSubtype = "application-gateway";
        existing.metadata.discoverySource = "appgateway-manager";
      } else {
        const tags = gw.tags ?? {};
        nodes.push({
          id: nodeId,
          name: gw.name,
          resourceType: "load-balancer",
          provider: "azure",
          region: gw.location,
          account: ctx.subscriptionId,
          nativeId: gw.id,
          status: mapAzureStatus(gw.provisioningState),
          tags,
          metadata: {
            resourceGroup: gw.resourceGroup,
            resourceSubtype: "application-gateway",
            skuName: gw.skuName,
            skuTier: gw.skuTier,
            skuCapacity: gw.skuCapacity,
            enableHttp2: gw.enableHttp2,
            operationalState: gw.operationalState,
            discoverySource: "appgateway-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Link AppGW → backend pools, frontend IPs
      if (gw.frontendIPConfigurations) {
        for (const fe of gw.frontendIPConfigurations) {
          if (fe.publicIPAddressId) {
            const pipNode = findNodeByNativeId(nodes, fe.publicIPAddressId);
            if (pipNode) {
              pushEdgeIfNew(edges, makeAzureEdge(nodeId, pipNode.id, "uses", { field: "frontendIPConfigurations" }));
            }
          }
          if (fe.subnetId) {
            const subNode = findNodeByNativeId(nodes, fe.subnetId);
            if (subNode) {
              pushEdgeIfNew(edges, makeAzureEdge(nodeId, subNode.id, "runs-in", { field: "frontendIPConfigurations.subnet" }));
            }
          }
        }
      }

      // Link AppGW → Firewall Policy (WAF)
      if (gw.firewallPolicyId) {
        const policyNode = findNodeByNativeId(nodes, gw.firewallPolicyId);
        if (policyNode) {
          pushEdgeIfNew(edges, makeAzureEdge(nodeId, policyNode.id, "secured-by", { field: "firewallPolicy" }));
        }
      }
    }
  } catch {
    // AppGW discovery failed
  }
}

/**
 * Discover Front Door resources.
 */
export async function discoverFrontDoorDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getFrontDoorManager();
  if (!mgr) return;

  const m = mgr as {
    listProfiles: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      skuName?: string;
      provisioningState?: string;
      resourceState?: string;
      frontDoorId?: string;
      originResponseTimeoutSeconds?: number;
      wafPolicyId?: string;
      endpoints?: Array<{
        id?: string;
        name?: string;
        origins?: Array<{ hostName?: string; resourceId?: string }>;
      }>;
      tags?: Record<string, string>;
    }>>;
  };

  try {
    const profiles = await m.listProfiles();
    for (const profile of profiles) {
      if (!profile.id) continue;

      const existing = findNodeByNativeId(nodes, profile.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "cdn", profile.id);

      if (existing) {
        existing.metadata.skuName = profile.skuName;
        existing.metadata.frontDoorId = profile.frontDoorId;
        existing.metadata.resourceSubtype = "front-door";
        existing.metadata.discoverySource = "frontdoor-manager";
        if (profile.originResponseTimeoutSeconds !== undefined) {
          existing.metadata.originResponseTimeoutSeconds = profile.originResponseTimeoutSeconds;
        }
      } else {
        const tags = profile.tags ?? {};
        nodes.push({
          id: nodeId,
          name: profile.name,
          resourceType: "cdn",
          provider: "azure",
          region: profile.location,
          account: ctx.subscriptionId,
          nativeId: profile.id,
          status: mapAzureStatus(profile.provisioningState),
          tags,
          metadata: {
            resourceGroup: profile.resourceGroup,
            resourceSubtype: "front-door",
            skuName: profile.skuName,
            frontDoorId: profile.frontDoorId,
            resourceState: profile.resourceState,
            originResponseTimeoutSeconds: profile.originResponseTimeoutSeconds,
            discoverySource: "frontdoor-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Link Front Door → WAF policy
      if (profile.wafPolicyId) {
        const wafNode = findNodeByNativeId(nodes, profile.wafPolicyId);
        if (wafNode) {
          pushEdgeIfNew(edges, makeAzureEdge(nodeId, wafNode.id, "secured-by", { field: "wafPolicy" }));
        }
      }

      // Link Front Door → origin backend resources
      if (profile.endpoints) {
        for (const ep of profile.endpoints) {
          if (!ep.origins) continue;
          for (const origin of ep.origins) {
            if (origin.resourceId) {
              const originNode = findNodeByNativeId(nodes, origin.resourceId);
              if (originNode) {
                pushEdgeIfNew(edges, makeAzureEdge(nodeId, originNode.id, "uses", { field: "endpoint.origins" }));
              }
            }
          }
        }
      }
    }
  } catch {
    // Front Door discovery failed
  }
}
