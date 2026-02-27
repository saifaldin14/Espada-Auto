/**
 * AWS Adapter — Route 53 DNS Domain Module
 *
 * Discovers Route 53 hosted zones, DNS records, and health checks
 * via the Route53Manager from @espada/aws. Creates nodes for zones
 * and edges linking alias records to their target resources (CloudFront,
 * ALB, S3, API Gateway).
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId } from "./utils.js";

/**
 * Discover Route 53 DNS resources via Route53Manager.
 *
 * Lists hosted zones, fetches record sets to link alias targets,
 * and discovers health checks attached to DNS records.
 */
export async function discoverRoute53Deeper(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getRoute53Manager();
  if (!mgr) return;

  const m = mgr as {
    listHostedZones: (maxItems?: number) => Promise<{
      success: boolean;
      data?: Array<{
        id?: string;
        name?: string;
        callerReference?: string;
        config?: { comment?: string; privateZone?: boolean };
        resourceRecordSetCount?: number;
        linkedService?: { servicePrincipal?: string };
      }>;
    }>;
    listRecords: (hostedZoneId: string, opts?: { maxItems?: number }) => Promise<{
      success: boolean;
      data?: Array<{
        name?: string;
        type?: string;
        ttl?: number;
        aliasTarget?: {
          hostedZoneId?: string;
          dnsName?: string;
          evaluateTargetHealth?: boolean;
        };
        resourceRecords?: Array<{ value?: string }>;
        healthCheckId?: string;
        setIdentifier?: string;
        weight?: number;
        failover?: string;
        region?: string;
      }>;
    }>;
    listHealthChecks: (maxItems?: number) => Promise<{
      success: boolean;
      data?: Array<{
        id?: string;
        callerReference?: string;
        healthCheckConfig?: {
          ipAddress?: string;
          port?: number;
          type?: string;
          fullyQualifiedDomainName?: string;
          resourcePath?: string;
          requestInterval?: number;
          failureThreshold?: number;
          enableSNI?: boolean;
          regions?: string[];
        };
        healthCheckVersion?: number;
      }>;
    }>;
    getHealthCheckStatus: (healthCheckId: string) => Promise<{
      success: boolean;
      data?: {
        healthCheckObservations?: Array<{
          region?: string;
          statusReport?: { status?: string; checkedTime?: string };
        }>;
      };
    }>;
  };

  // --- Hosted Zones ---
  try {
    const zonesResult = await m.listHostedZones(100);
    if (!zonesResult.success || !zonesResult.data) return;

    for (const zone of zonesResult.data) {
      if (!zone.id || !zone.name) continue;

      // Normalize zone ID (remove /hostedzone/ prefix if present)
      const zoneId = zone.id.replace("/hostedzone/", "");

      const existing = nodes.find(
        (n) =>
          n.resourceType === "dns" &&
          (n.nativeId === zoneId || n.nativeId === zone.id || n.name === zone.name),
      );

      const zoneNodeId = existing?.id ?? buildAwsNodeId(
        ctx.accountId,
        "global",
        "dns",
        `zone-${zoneId}`,
      );

      if (existing) {
        existing.metadata["recordSetCount"] = zone.resourceRecordSetCount;
        existing.metadata["privateZone"] = zone.config?.privateZone;
        existing.metadata["comment"] = zone.config?.comment;
        existing.metadata["discoverySource"] = "route53-manager";
      } else {
        nodes.push({
          id: zoneNodeId,
          name: zone.name,
          resourceType: "dns",
          provider: "aws",
          region: "global",
          account: ctx.accountId,
          nativeId: zoneId,
          status: "running",
          tags: {},
          metadata: {
            resourceSubtype: "hosted-zone",
            recordSetCount: zone.resourceRecordSetCount,
            privateZone: zone.config?.privateZone,
            comment: zone.config?.comment,
            discoverySource: "route53-manager",
          },
          costMonthly: 0.50, // $0.50/hosted zone/month
          owner: null,
          createdAt: null,
        });
      }

      // Discover DNS records (for alias target linking)
      try {
        const recordsResult = await m.listRecords(zoneId, { maxItems: 200 });
        if (!recordsResult.success || !recordsResult.data) continue;

        for (const record of recordsResult.data) {
          if (!record.aliasTarget?.dnsName) continue;

          // Try to match alias target to a discovered resource
          const aliasDns = record.aliasTarget.dnsName.replace(/\.$/, "");
          const matchedNode = findAliasDnsTarget(nodes, aliasDns);
          if (!matchedNode) continue;

          const edgeId = `${zoneNodeId}--resolves-to--${matchedNode.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: zoneNodeId,
              targetNodeId: matchedNode.id,
              relationshipType: "resolves-to",
              confidence: 0.9,
              discoveredVia: "api-field",
              metadata: {
                recordName: record.name,
                recordType: record.type,
                aliasTarget: aliasDns,
              },
            });
          }
        }
      } catch {
        // Record discovery is best-effort
      }
    }
  } catch {
    // Hosted zone discovery is best-effort
  }

  // --- Health Checks ---
  try {
    const hcResult = await m.listHealthChecks(100);
    if (hcResult.success && hcResult.data) {
      for (const hc of hcResult.data) {
        if (!hc.id) continue;

        const hcNodeId = buildAwsNodeId(
          ctx.accountId,
          "global",
          "custom",
          `health-check-${hc.id}`,
        );

        // Get health check status
        let status: "running" | "error" | "stopped" = "running";
        try {
          const statusResult = await m.getHealthCheckStatus(hc.id);
          if (statusResult.success && statusResult.data?.healthCheckObservations) {
            const unhealthy = statusResult.data.healthCheckObservations.some(
              (obs) => obs.statusReport?.status && !obs.statusReport.status.includes("Success"),
            );
            if (unhealthy) status = "error";
          }
        } catch {
          // Status check is best-effort
        }

        nodes.push({
          id: hcNodeId,
          name: `health-check-${hc.id.slice(0, 8)}`,
          resourceType: "custom",
          provider: "aws",
          region: "global",
          account: ctx.accountId,
          nativeId: hc.id,
          status,
          tags: {},
          metadata: {
            resourceSubtype: "route53-health-check",
            checkType: hc.healthCheckConfig?.type,
            fqdn: hc.healthCheckConfig?.fullyQualifiedDomainName,
            ipAddress: hc.healthCheckConfig?.ipAddress,
            port: hc.healthCheckConfig?.port,
            resourcePath: hc.healthCheckConfig?.resourcePath,
            requestInterval: hc.healthCheckConfig?.requestInterval,
            failureThreshold: hc.healthCheckConfig?.failureThreshold,
            monitoringRegions: hc.healthCheckConfig?.regions,
            discoverySource: "route53-manager",
          },
          costMonthly: 0.75, // $0.50-$0.75/health check/month
          owner: null,
          createdAt: null,
        });

        // Try to link health check to its monitored target by IP/FQDN
        if (hc.healthCheckConfig?.fullyQualifiedDomainName) {
          const targetNode = nodes.find(
            (n) =>
              n.metadata["dnsName"] === hc.healthCheckConfig!.fullyQualifiedDomainName ||
              n.metadata["endpoint"]?.toString().includes(hc.healthCheckConfig!.fullyQualifiedDomainName!),
          );
          if (targetNode) {
            const edgeId = `${hcNodeId}--monitors--${targetNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: hcNodeId,
                targetNodeId: targetNode.id,
                relationshipType: "monitors",
                confidence: 0.8,
                discoveredVia: "config-scan",
                metadata: { fqdn: hc.healthCheckConfig.fullyQualifiedDomainName },
              });
            }
          }
        }
      }
    }
  } catch {
    // Health check discovery is best-effort
  }
}

/**
 * Try to match a Route 53 alias DNS name to a discovered node.
 *
 * Checks against known patterns:
 * - CloudFront: *.cloudfront.net
 * - ALB/NLB: *.elb.amazonaws.com
 * - S3 website: *.s3-website-*.amazonaws.com
 * - API Gateway: *.execute-api.*.amazonaws.com
 */
function findAliasDnsTarget(
  nodes: GraphNodeInput[],
  aliasDns: string,
): GraphNodeInput | undefined {
  // Direct dnsName match
  const directMatch = nodes.find(
    (n) => n.metadata["dnsName"] === aliasDns,
  );
  if (directMatch) return directMatch;

  // CloudFront distribution DNS
  if (aliasDns.endsWith(".cloudfront.net")) {
    return nodes.find(
      (n) =>
        n.resourceType === "cdn" &&
        n.metadata["domainName"] === aliasDns,
    );
  }

  // ELB DNS
  if (aliasDns.includes(".elb.amazonaws.com")) {
    return nodes.find(
      (n) =>
        n.resourceType === "load-balancer" &&
        (n.metadata["dnsName"] === aliasDns ||
          n.metadata["dnsName"]?.toString().replace(/\.$/, "") === aliasDns),
    );
  }

  // S3 website hosting DNS
  if (aliasDns.includes(".s3-website")) {
    const bucketName = aliasDns.split(".s3-website")[0];
    return nodes.find(
      (n) =>
        n.resourceType === "storage" &&
        (n.name === bucketName || n.nativeId === bucketName),
    );
  }

  // API Gateway DNS
  if (aliasDns.includes(".execute-api.")) {
    return nodes.find(
      (n) =>
        n.resourceType === "api-gateway" &&
        n.metadata["apiEndpoint"]?.toString().includes(aliasDns.split(".execute-api.")[0] ?? ""),
    );
  }

  return undefined;
}
