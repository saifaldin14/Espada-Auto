/**
 * AWS Adapter — Compute Domain Module
 *
 * Discovers deeper EC2 resources: Auto Scaling Groups, Load Balancers,
 * and Target Groups via the AWSEC2Manager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover deeper EC2 resources: Auto Scaling Groups, Load Balancers,
 * and Target Groups via the AWSEC2Manager from @espada/aws.
 *
 * Enriches existing compute nodes with ASG membership and creates new
 * nodes for ALBs/NLBs and target groups with appropriate edges.
 */
export async function discoverEC2Deeper(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getEC2Manager();
  if (!mgr) return;

  // Discover Auto Scaling Groups
  const asgResult = await (mgr as {
    listAutoScalingGroups: (opts?: { maxResults?: number }) => Promise<{
      groups: Array<{
        autoScalingGroupName?: string;
        autoScalingGroupARN?: string;
        launchTemplate?: { launchTemplateName?: string; launchTemplateId?: string };
        minSize?: number;
        maxSize?: number;
        desiredCapacity?: number;
        instances?: Array<{ instanceId?: string; healthStatus?: string; lifecycleState?: string }>;
        targetGroupARNs?: string[];
        healthCheckType?: string;
        createdTime?: string;
        status?: string;
      }>;
    }>;
  }).listAutoScalingGroups();

  if (asgResult.groups) {
    for (const asg of asgResult.groups) {
      if (!asg.autoScalingGroupName) continue;

      const asgNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        `asg-${asg.autoScalingGroupName}`,
      );

      nodes.push({
        id: asgNodeId,
        name: asg.autoScalingGroupName,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: asg.autoScalingGroupARN ?? asg.autoScalingGroupName,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "auto-scaling-group",
          minSize: asg.minSize,
          maxSize: asg.maxSize,
          desiredCapacity: asg.desiredCapacity,
          healthCheckType: asg.healthCheckType,
          launchTemplate: asg.launchTemplate?.launchTemplateName,
          instanceCount: asg.instances?.length ?? 0,
          discoverySource: "ec2-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: asg.createdTime ?? null,
      });

      // Link ASG → instances (contains edges)
      if (asg.instances) {
        for (const inst of asg.instances) {
          if (!inst.instanceId) continue;
          const instNode = nodes.find((n) =>
            n.nativeId === inst.instanceId || n.nativeId.includes(inst.instanceId!),
          );
          if (!instNode) continue;

          const containsEdgeId = `${asgNodeId}--contains--${instNode.id}`;
          if (!edges.some((e) => e.id === containsEdgeId)) {
            edges.push({
              id: containsEdgeId,
              sourceNodeId: asgNodeId,
              targetNodeId: instNode.id,
              relationshipType: "contains",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: { healthStatus: inst.healthStatus, lifecycleState: inst.lifecycleState },
            });
          }
        }
      }

      // Link ASG → target groups
      if (asg.targetGroupARNs) {
        for (const tgArn of asg.targetGroupARNs) {
          const tgNode = findNodeByArnOrId(nodes, tgArn, extractResourceId(tgArn));
          if (!tgNode) continue;
          const attachedEdgeId = `${asgNodeId}--attached-to--${tgNode.id}`;
          if (!edges.some((e) => e.id === attachedEdgeId)) {
            edges.push({
              id: attachedEdgeId,
              sourceNodeId: asgNodeId,
              targetNodeId: tgNode.id,
              relationshipType: "attached-to",
              confidence: 0.9,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }
    }
  }

  // Discover Load Balancers
  const lbResult = await (mgr as {
    listLoadBalancers: (opts?: { maxResults?: number }) => Promise<{
      loadBalancers: Array<{
        loadBalancerArn?: string;
        loadBalancerName?: string;
        dnsName?: string;
        type?: string;
        scheme?: string;
        state?: { code?: string };
        vpcId?: string;
        availabilityZones?: Array<{ zoneName?: string; subnetId?: string }>;
        securityGroups?: string[];
        createdTime?: string;
      }>;
    }>;
  }).listLoadBalancers();

  if (lbResult.loadBalancers) {
    for (const lb of lbResult.loadBalancers) {
      if (!lb.loadBalancerName) continue;

      // Check if this LB was already discovered via the base adapter
      const existingLb = nodes.find((n) =>
        n.resourceType === "load-balancer" &&
        (n.nativeId === lb.loadBalancerArn || n.name === lb.loadBalancerName),
      );

      if (existingLb) {
        // Enrich existing LB node with deeper metadata
        existingLb.metadata["dnsName"] = lb.dnsName;
        existingLb.metadata["lbType"] = lb.type;
        existingLb.metadata["scheme"] = lb.scheme;
        existingLb.metadata["discoverySource"] = "ec2-manager";
        continue;
      }

      const lbNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "load-balancer",
        lb.loadBalancerName,
      );

      nodes.push({
        id: lbNodeId,
        name: lb.loadBalancerName,
        resourceType: "load-balancer",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: lb.loadBalancerArn ?? lb.loadBalancerName,
        status: lb.state?.code === "active" ? "running" : (lb.state?.code as GraphNodeInput["status"]) ?? "unknown",
        tags: {},
        metadata: {
          dnsName: lb.dnsName,
          lbType: lb.type,
          scheme: lb.scheme,
          discoverySource: "ec2-manager",
        },
        costMonthly: 20,
        owner: null,
        createdAt: lb.createdTime ?? null,
      });

      // SG edges for LBs
      if (lb.securityGroups) {
        for (const sgId of lb.securityGroups) {
          const sgNode = nodes.find((n) => n.nativeId === sgId || n.nativeId.includes(sgId));
          if (!sgNode) continue;
          const edgeId = `${lbNodeId}--secured-by--${sgNode.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: lbNodeId,
              targetNodeId: sgNode.id,
              relationshipType: "secured-by",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }
    }
  }

  // Discover Target Groups
  const tgResult = await (mgr as {
    listTargetGroups: (opts?: { maxResults?: number }) => Promise<{
      targetGroups: Array<{
        targetGroupArn?: string;
        targetGroupName?: string;
        protocol?: string;
        port?: number;
        targetType?: string;
        healthCheckEnabled?: boolean;
        healthCheckProtocol?: string;
        healthCheckPath?: string;
        vpcId?: string;
        loadBalancerArns?: string[];
      }>;
    }>;
  }).listTargetGroups();

  if (tgResult.targetGroups) {
    for (const tg of tgResult.targetGroups) {
      if (!tg.targetGroupName) continue;

      const tgNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        `tg-${tg.targetGroupName}`,
      );

      nodes.push({
        id: tgNodeId,
        name: tg.targetGroupName,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: tg.targetGroupArn ?? tg.targetGroupName,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "target-group",
          protocol: tg.protocol,
          port: tg.port,
          targetType: tg.targetType,
          healthCheckEnabled: tg.healthCheckEnabled,
          healthCheckPath: tg.healthCheckPath,
          discoverySource: "ec2-manager",
        },
        costMonthly: 0,
        owner: null,
        createdAt: null,
      });

      // Link LBs → target group (routes-to)
      if (tg.loadBalancerArns) {
        for (const lbArn of tg.loadBalancerArns) {
          const lbNode = findNodeByArnOrId(nodes, lbArn, extractResourceId(lbArn));
          if (!lbNode) continue;
          const routeEdgeId = `${lbNode.id}--routes-to--${tgNodeId}`;
          if (!edges.some((e) => e.id === routeEdgeId)) {
            edges.push({
              id: routeEdgeId,
              sourceNodeId: lbNode.id,
              targetNodeId: tgNodeId,
              relationshipType: "routes-to",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }
    }
  }
}
