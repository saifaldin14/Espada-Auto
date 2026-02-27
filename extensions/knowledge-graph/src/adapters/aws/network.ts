/**
 * AWS Adapter — Network Domain Module
 *
 * Discovers deeper networking resources: VPC peering connections,
 * Transit Gateways, NAT Gateways, Network ACLs, VPC Endpoints,
 * and Flow Logs via the NetworkManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId } from "./utils.js";

/**
 * Discover deeper networking resources via NetworkManager.
 *
 * Enriches existing VPC/subnet nodes and discovers new resources:
 * VPC peering, Transit Gateways, NACLs, VPC Endpoints, and Flow Logs.
 */
export async function discoverNetworkDeeper(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getNetworkManager();
  if (!mgr) return;

  const m = mgr as {
    listVPCPeering: (opts?: { region?: string }) => Promise<{
      success: boolean;
      data?: Array<{
        vpcPeeringConnectionId?: string;
        status?: { code?: string };
        requesterVpcInfo?: { vpcId?: string; ownerId?: string; cidrBlock?: string; region?: string };
        accepterVpcInfo?: { vpcId?: string; ownerId?: string; cidrBlock?: string; region?: string };
        tags?: Record<string, string>;
      }>;
    }>;
    listTransitGateways: (region?: string) => Promise<{
      success: boolean;
      data?: Array<{
        transitGatewayId?: string;
        transitGatewayArn?: string;
        state?: string;
        ownerId?: string;
        description?: string;
        amazonSideAsn?: number;
        tags?: Record<string, string>;
        creationTime?: string;
      }>;
    }>;
    listNetworkACLs: (vpcId?: string, region?: string) => Promise<{
      success: boolean;
      data?: Array<{
        networkAclId?: string;
        vpcId?: string;
        isDefault?: boolean;
        associations?: Array<{ subnetId?: string }>;
        entries?: Array<{ ruleNumber?: number; ruleAction?: string; protocol?: string }>;
        tags?: Record<string, string>;
      }>;
    }>;
    listVPCEndpoints: (opts?: { region?: string }) => Promise<{
      success: boolean;
      data?: Array<{
        vpcEndpointId?: string;
        vpcEndpointType?: string;
        vpcId?: string;
        serviceName?: string;
        state?: string;
        routeTableIds?: string[];
        subnetIds?: string[];
        privateDnsEnabled?: boolean;
        tags?: Record<string, string>;
        creationTimestamp?: string;
      }>;
    }>;
    listFlowLogs: (opts?: { region?: string }) => Promise<{
      success: boolean;
      data?: Array<{
        flowLogId?: string;
        flowLogStatus?: string;
        resourceId?: string;
        trafficType?: string;
        logDestinationType?: string;
        logDestination?: string;
        logGroupName?: string;
        deliverLogsStatus?: string;
        tags?: Record<string, string>;
        creationTime?: string;
      }>;
    }>;
    listNATGateways: (opts?: { region?: string }) => Promise<{
      success: boolean;
      data?: Array<{
        natGatewayId?: string;
        vpcId?: string;
        subnetId?: string;
        state?: string;
        connectivityType?: string;
        natGatewayAddresses?: Array<{ publicIp?: string; allocationId?: string; privateIp?: string }>;
        tags?: Record<string, string>;
        createTime?: string;
      }>;
    }>;
  };

  // --- VPC Peering Connections ---
  try {
    const result = await m.listVPCPeering();
    if (result.success && result.data) {
      for (const peering of result.data) {
        if (!peering.vpcPeeringConnectionId) continue;

        const peeringNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `vpc-peering-${peering.vpcPeeringConnectionId}`,
        );

        const name = peering.tags?.["Name"] ?? `peering-${peering.vpcPeeringConnectionId}`;

        nodes.push({
          id: peeringNodeId,
          name,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: peering.vpcPeeringConnectionId,
          status: peering.status?.code === "active" ? "running" : "stopped",
          tags: peering.tags ?? {},
          metadata: {
            resourceSubtype: "vpc-peering-connection",
            statusCode: peering.status?.code,
            requesterVpcId: peering.requesterVpcInfo?.vpcId,
            requesterCidr: peering.requesterVpcInfo?.cidrBlock,
            accepterVpcId: peering.accepterVpcInfo?.vpcId,
            accepterCidr: peering.accepterVpcInfo?.cidrBlock,
            discoverySource: "network-manager",
          },
          costMonthly: 0, // VPC peering: no hourly cost (data transfer only)
          owner: peering.tags?.["Owner"] ?? null,
          createdAt: null,
        });

        // Link peering → requester VPC
        if (peering.requesterVpcInfo?.vpcId) {
          const reqVpc = nodes.find(
            (n) => n.resourceType === "vpc" && n.nativeId === peering.requesterVpcInfo!.vpcId,
          );
          if (reqVpc) {
            const edgeId = `${peeringNodeId}--peers-with--${reqVpc.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: peeringNodeId,
                targetNodeId: reqVpc.id,
                relationshipType: "peers-with",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { role: "requester" },
              });
            }
          }
        }

        // Link peering → accepter VPC
        if (peering.accepterVpcInfo?.vpcId) {
          const accVpc = nodes.find(
            (n) => n.resourceType === "vpc" && n.nativeId === peering.accepterVpcInfo!.vpcId,
          );
          if (accVpc) {
            const edgeId = `${peeringNodeId}--peers-with--${accVpc.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: peeringNodeId,
                targetNodeId: accVpc.id,
                relationshipType: "peers-with",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { role: "accepter" },
              });
            }
          }
        }
      }
    }
  } catch {
    // VPC peering discovery is best-effort
  }

  // --- Transit Gateways ---
  try {
    const result = await m.listTransitGateways();
    if (result.success && result.data) {
      for (const tgw of result.data) {
        if (!tgw.transitGatewayId) continue;

        // Check if already discovered by base adapter
        const existing = nodes.find(
          (n) =>
            n.resourceType === "transit-gateway" &&
            (n.nativeId === tgw.transitGatewayId || n.nativeId === tgw.transitGatewayArn),
        );

        if (existing) {
          existing.metadata["amazonSideAsn"] = tgw.amazonSideAsn;
          existing.metadata["discoverySource"] = "network-manager";
          continue;
        }

        const tgwNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "transit-gateway",
          tgw.transitGatewayId,
        );

        nodes.push({
          id: tgwNodeId,
          name: tgw.tags?.["Name"] ?? tgw.transitGatewayId,
          resourceType: "transit-gateway",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: tgw.transitGatewayArn ?? tgw.transitGatewayId,
          status: tgw.state === "available" ? "running" : "stopped",
          tags: tgw.tags ?? {},
          metadata: {
            description: tgw.description,
            amazonSideAsn: tgw.amazonSideAsn,
            discoverySource: "network-manager",
          },
          costMonthly: 36, // ~$0.05/hr per attachment hour
          owner: tgw.tags?.["Owner"] ?? null,
          createdAt: tgw.creationTime ?? null,
        });
      }
    }
  } catch {
    // Transit Gateway discovery is best-effort
  }

  // --- Network ACLs ---
  try {
    const result = await m.listNetworkACLs();
    if (result.success && result.data) {
      for (const nacl of result.data) {
        if (!nacl.networkAclId) continue;

        const naclNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `nacl-${nacl.networkAclId}`,
        );

        nodes.push({
          id: naclNodeId,
          name: nacl.tags?.["Name"] ?? nacl.networkAclId,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: nacl.networkAclId,
          status: "running",
          tags: nacl.tags ?? {},
          metadata: {
            resourceSubtype: "network-acl",
            isDefault: nacl.isDefault,
            ruleCount: nacl.entries?.length ?? 0,
            associatedSubnets: nacl.associations?.map((a) => a.subnetId).filter(Boolean),
            discoverySource: "network-manager",
          },
          costMonthly: 0,
          owner: nacl.tags?.["Owner"] ?? null,
          createdAt: null,
        });

        // Link NACL → VPC
        if (nacl.vpcId) {
          const vpcNode = nodes.find(
            (n) => n.resourceType === "vpc" && n.nativeId === nacl.vpcId,
          );
          if (vpcNode) {
            const edgeId = `${naclNodeId}--deployed-at--${vpcNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: naclNodeId,
                targetNodeId: vpcNode.id,
                relationshipType: "deployed-at",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }

        // Link NACL → subnets
        if (nacl.associations) {
          for (const assoc of nacl.associations) {
            if (!assoc.subnetId) continue;
            const subnetNode = nodes.find(
              (n) => n.resourceType === "subnet" && n.nativeId === assoc.subnetId,
            );
            if (!subnetNode) continue;
            const edgeId = `${naclNodeId}--secures--${subnetNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: naclNodeId,
                targetNodeId: subnetNode.id,
                relationshipType: "secures",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  } catch {
    // NACL discovery is best-effort
  }

  // --- VPC Endpoints ---
  try {
    const result = await m.listVPCEndpoints();
    if (result.success && result.data) {
      for (const vpce of result.data) {
        if (!vpce.vpcEndpointId) continue;

        // Check if already discovered by base adapter
        const existing = nodes.find(
          (n) =>
            n.resourceType === "vpc-endpoint" && n.nativeId === vpce.vpcEndpointId,
        );

        if (existing) {
          existing.metadata["endpointType"] = vpce.vpcEndpointType;
          existing.metadata["serviceName"] = vpce.serviceName;
          existing.metadata["privateDnsEnabled"] = vpce.privateDnsEnabled;
          existing.metadata["discoverySource"] = "network-manager";
          continue;
        }

        const vpceNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "vpc-endpoint",
          vpce.vpcEndpointId,
        );

        nodes.push({
          id: vpceNodeId,
          name: vpce.tags?.["Name"] ?? vpce.vpcEndpointId,
          resourceType: "vpc-endpoint",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: vpce.vpcEndpointId,
          status: vpce.state === "available" ? "running" : "stopped",
          tags: vpce.tags ?? {},
          metadata: {
            endpointType: vpce.vpcEndpointType,
            serviceName: vpce.serviceName,
            privateDnsEnabled: vpce.privateDnsEnabled,
            discoverySource: "network-manager",
          },
          costMonthly: vpce.vpcEndpointType === "Interface" ? 7.30 : 0, // Gateway endpoints are free
          owner: vpce.tags?.["Owner"] ?? null,
          createdAt: vpce.creationTimestamp ?? null,
        });

        // Link endpoint → VPC
        if (vpce.vpcId) {
          const vpcNode = nodes.find(
            (n) => n.resourceType === "vpc" && n.nativeId === vpce.vpcId,
          );
          if (vpcNode) {
            const edgeId = `${vpceNodeId}--deployed-at--${vpcNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: vpceNodeId,
                targetNodeId: vpcNode.id,
                relationshipType: "deployed-at",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  } catch {
    // VPC endpoint discovery is best-effort
  }

  // --- NAT Gateways (deeper enrichment) ---
  try {
    const result = await m.listNATGateways();
    if (result.success && result.data) {
      for (const natgw of result.data) {
        if (!natgw.natGatewayId) continue;

        const existing = nodes.find(
          (n) =>
            n.resourceType === "nat-gateway" && n.nativeId === natgw.natGatewayId,
        );

        if (existing) {
          existing.metadata["connectivityType"] = natgw.connectivityType;
          existing.metadata["publicIp"] = natgw.natGatewayAddresses?.[0]?.publicIp;
          existing.metadata["discoverySource"] = "network-manager";
          continue;
        }

        const natNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "nat-gateway",
          natgw.natGatewayId,
        );

        nodes.push({
          id: natNodeId,
          name: natgw.tags?.["Name"] ?? natgw.natGatewayId,
          resourceType: "nat-gateway",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: natgw.natGatewayId,
          status: natgw.state === "available" ? "running" : "stopped",
          tags: natgw.tags ?? {},
          metadata: {
            connectivityType: natgw.connectivityType,
            publicIp: natgw.natGatewayAddresses?.[0]?.publicIp,
            discoverySource: "network-manager",
          },
          costMonthly: 32.40,
          owner: natgw.tags?.["Owner"] ?? null,
          createdAt: natgw.createTime ?? null,
        });

        // Link NAT GW → subnet
        if (natgw.subnetId) {
          const subnetNode = nodes.find(
            (n) => n.resourceType === "subnet" && n.nativeId === natgw.subnetId,
          );
          if (subnetNode) {
            const edgeId = `${natNodeId}--deployed-at--${subnetNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: natNodeId,
                targetNodeId: subnetNode.id,
                relationshipType: "deployed-at",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }

        // Link NAT GW → VPC
        if (natgw.vpcId) {
          const vpcNode = nodes.find(
            (n) => n.resourceType === "vpc" && n.nativeId === natgw.vpcId,
          );
          if (vpcNode) {
            const edgeId = `${natNodeId}--deployed-at--${vpcNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: natNodeId,
                targetNodeId: vpcNode.id,
                relationshipType: "deployed-at",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  } catch {
    // NAT GW enrichment is best-effort
  }

  // --- Flow Logs ---
  try {
    const result = await m.listFlowLogs();
    if (result.success && result.data) {
      for (const fl of result.data) {
        if (!fl.flowLogId) continue;

        const flNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `flow-log-${fl.flowLogId}`,
        );

        nodes.push({
          id: flNodeId,
          name: fl.tags?.["Name"] ?? fl.flowLogId,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: fl.flowLogId,
          status: fl.flowLogStatus === "ACTIVE" ? "running" : "stopped",
          tags: fl.tags ?? {},
          metadata: {
            resourceSubtype: "flow-log",
            trafficType: fl.trafficType,
            logDestinationType: fl.logDestinationType,
            logDestination: fl.logDestination,
            deliverLogsStatus: fl.deliverLogsStatus,
            discoverySource: "network-manager",
          },
          costMonthly: 0.50, // ~$0.50/GB ingested to CloudWatch
          owner: fl.tags?.["Owner"] ?? null,
          createdAt: fl.creationTime ?? null,
        });

        // Link flow log → resource (VPC/subnet/ENI)
        if (fl.resourceId) {
          const targetNode = nodes.find(
            (n) => n.nativeId === fl.resourceId,
          );
          if (targetNode) {
            const edgeId = `${flNodeId}--monitors--${targetNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: flNodeId,
                targetNodeId: targetNode.id,
                relationshipType: "monitors",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  } catch {
    // Flow log discovery is best-effort
  }
}
