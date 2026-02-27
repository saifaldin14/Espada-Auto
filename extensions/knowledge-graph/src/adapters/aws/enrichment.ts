/**
 * AWS Adapter — Enrichment Domain Module
 *
 * Post-discovery enrichment methods that augment discovered nodes
 * with tags, event sources, observability, deeper metadata, and compliance data.
 */

import type { GraphNodeInput, GraphEdgeInput, GraphResourceType } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Enrich discovered nodes with tags from TaggingManager.
 *
 * For each node with an ARN, queries the TaggingManager for resource tags.
 * Fills in missing tags, sets owner from tag values, and adds tag metadata.
 */
export async function enrichWithTags(ctx: AwsAdapterContext, nodes: GraphNodeInput[]): Promise<void> {
  const tm = await ctx.getTaggingManager();
  if (!tm) return;

  // Process nodes in parallel batches of 10
  const batchSize = 10;
  for (let i = 0; i < nodes.length; i += batchSize) {
    const batch = nodes.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (node) => {
        try {
          const arn = node.nativeId;
          if (!arn) return;

          const tags = await (tm as {
            getResourceTags: (arn: string, opts?: { region?: string }) => Promise<Array<{ key: string; value: string }>>;
          }).getResourceTags(arn, { region: node.region });

          if (!tags || tags.length === 0) return;

          // Merge tags (existing tags take precedence)
          for (const tag of tags) {
            if (!node.tags[tag.key]) {
              node.tags[tag.key] = tag.value;
            }
          }

          // Fill owner from tags if not set
          if (!node.owner) {
            node.owner = node.tags["Owner"] ?? node.tags["owner"] ??
              node.tags["Team"] ?? node.tags["team"] ?? null;
          }

          node.metadata["tagSource"] = "tagging-manager";
          node.metadata["tagCount"] = Object.keys(node.tags).length;
        } catch {
          // Individual tag lookup failure is non-fatal
        }
      }),
    );
  }
}

/**
 * Enrich with event-driven edges from Lambda, SNS, and SQS.
 *
 * - Lambda event source mappings → triggers edges (SQS/DynamoDB/Kinesis → Lambda)
 * - SNS topic subscriptions → publishes-to edges (SNS → Lambda/SQS)
 * - SQS dead-letter queue configs → publishes-to edges (Queue → DLQ)
 */
export async function enrichWithEventSources(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const lambdaMgr = await ctx.getLambdaManager();

  // Index nodes by ARN/native-id for fast edge construction
  const nodesByArn = new Map<string, GraphNodeInput>();
  const nodesByNativeId = new Map<string, GraphNodeInput>();
  for (const node of nodes) {
    nodesByNativeId.set(node.nativeId, node);
    // Many AWS IDs contain the ARN
    if (node.nativeId.startsWith("arn:")) {
      nodesByArn.set(node.nativeId, node);
    }
  }

  // Lambda event source mappings
  if (lambdaMgr) {
    try {
      const mappings = await (lambdaMgr as {
        listEventSourceMappings: (opts?: { functionName?: string; eventSourceArn?: string }) => Promise<Array<{
          uuid: string;
          eventSourceArn?: string;
          functionArn?: string;
          state?: string;
          batchSize?: number;
        }>>;
      }).listEventSourceMappings({});

      for (const mapping of mappings) {
        if (!mapping.eventSourceArn || !mapping.functionArn) continue;

        const sourceId = extractResourceId(mapping.eventSourceArn);
        const targetId = extractResourceId(mapping.functionArn);

        // Determine source resource type from ARN
        let sourceType: GraphResourceType = "custom";
        if (mapping.eventSourceArn.includes(":sqs:")) sourceType = "queue";
        else if (mapping.eventSourceArn.includes(":dynamodb:")) sourceType = "database";
        else if (mapping.eventSourceArn.includes(":kinesis:")) sourceType = "stream";

        // Find matching source and target nodes
        const sourceNode = findNodeByArnOrId(nodes, mapping.eventSourceArn, sourceId);
        const targetNode = findNodeByArnOrId(nodes, mapping.functionArn, targetId);
        if (!sourceNode || !targetNode) continue;

        const edgeId = `${sourceNode.id}--triggers--${targetNode.id}`;
        // Avoid duplicate edges
        if (edges.some((e) => e.id === edgeId)) continue;

        edges.push({
          id: edgeId,
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          relationshipType: "triggers",
          confidence: 0.95,
          discoveredVia: "event-stream",
          metadata: {
            eventSourceType: sourceType,
            batchSize: mapping.batchSize,
            state: mapping.state,
            mappingId: mapping.uuid,
          },
        });
      }
    } catch {
      // Lambda event source enrichment is best-effort
    }
  }

  // SNS subscription edges
  const topicNodes = nodes.filter((n) => n.resourceType === "topic");
  if (topicNodes.length > 0) {
    for (const topicNode of topicNodes) {
      try {
        // Try to get subscriptions via SNS SDK
        const client = await ctx.createClient("SNS", topicNode.region);
        if (!client) continue;

        try {
          const command = await ctx.buildCommand("SNS", "listSubscriptionsByTopic");
          if (!command) continue;

          // Inject TopicArn into the command
          (command as Record<string, unknown>)["input"] = { TopicArn: topicNode.nativeId };
          const response = await client.send(command) as Record<string, unknown>;
          const subscriptions = (response["Subscriptions"] ?? []) as Array<{
            SubscriptionArn?: string;
            Endpoint?: string;
            Protocol?: string;
          }>;

          for (const sub of subscriptions) {
            if (!sub.Endpoint || sub.Endpoint === "PendingConfirmation") continue;

            const targetNode = findNodeByArnOrId(nodes, sub.Endpoint, extractResourceId(sub.Endpoint));
            if (!targetNode) continue;

            const edgeId = `${topicNode.id}--publishes-to--${targetNode.id}`;
            if (edges.some((e) => e.id === edgeId)) continue;

            edges.push({
              id: edgeId,
              sourceNodeId: topicNode.id,
              targetNodeId: targetNode.id,
              relationshipType: "publishes-to",
              confidence: 0.95,
              discoveredVia: "event-stream",
              metadata: {
                protocol: sub.Protocol,
                subscriptionArn: sub.SubscriptionArn,
              },
            });
          }
        } finally {
          client.destroy?.();
        }
      } catch {
        // SNS subscription enrichment is best-effort per topic
      }
    }
  }
}

/**
 * Enrich with observability data from X-Ray service map and CloudWatch alarms.
 *
 * - X-Ray service map → routes-to edges between services
 * - CloudWatch alarms → alarm state metadata on monitored nodes
 */
export async function enrichWithObservability(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const obsMgr = await ctx.getObservabilityManager();
  if (!obsMgr) return;

  // X-Ray service map: creates routes-to edges between communicating services
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 3600000); // Last hour

    const result = await (obsMgr as {
      getServiceMap: (startTime: Date, endTime: Date, groupName?: string) => Promise<{
        success: boolean;
        data?: {
          services?: Array<{
            name: string;
            type?: string;
            edges?: Array<{ referenceId?: number; targetName?: string }>;
            responseTimeHistogram?: Array<{ value?: number }>;
          }>;
        };
      }>;
    }).getServiceMap(startTime, endTime);

    if (result.success && result.data?.services) {
      for (const service of result.data.services) {
        if (!service.edges) continue;

        // Find the source node matching this service
        const sourceNode = nodes.find((n) =>
          n.name === service.name ||
          n.nativeId.includes(service.name) ||
          n.name.toLowerCase().includes(service.name.toLowerCase()),
        );
        if (!sourceNode) continue;

        // Add response time metadata from X-Ray
        if (service.responseTimeHistogram?.[0]?.value) {
          sourceNode.metadata["avgResponseTimeMs"] = Math.round(service.responseTimeHistogram[0].value * 1000);
          sourceNode.metadata["observabilitySource"] = "xray";
        }

        for (const edge of service.edges) {
          if (!edge.targetName) continue;

          const targetNode = nodes.find((n) =>
            n.name === edge.targetName ||
            n.nativeId.includes(edge.targetName!) ||
            n.name.toLowerCase().includes(edge.targetName!.toLowerCase()),
          );
          if (!targetNode) continue;

          const edgeId = `${sourceNode.id}--routes-to--${targetNode.id}`;
          if (edges.some((e) => e.id === edgeId)) continue;

          edges.push({
            id: edgeId,
            sourceNodeId: sourceNode.id,
            targetNodeId: targetNode.id,
            relationshipType: "routes-to",
            confidence: 0.85,
            discoveredVia: "runtime-trace",
            metadata: { source: "xray-service-map" },
          });
        }
      }
    }
  } catch {
    // X-Ray service map is best-effort
  }

  // CloudWatch alarms: attach alarm state to matching nodes
  try {
    const alarmsResult = await (obsMgr as {
      listAlarms: (opts?: { stateValue?: string; maxRecords?: number }) => Promise<{
        success: boolean;
        data?: Array<{
          alarmName: string;
          stateValue?: string;
          metricName?: string;
          namespace?: string;
          dimensions?: Array<{ name: string; value: string }>;
        }>;
      }>;
    }).listAlarms({ maxRecords: 100 });

    if (alarmsResult.success && alarmsResult.data) {
      for (const alarm of alarmsResult.data) {
        if (!alarm.dimensions) continue;

        // Match alarm dimensions to nodes
        for (const dim of alarm.dimensions) {
          const matchingNode = nodes.find((n) =>
            n.nativeId === dim.value ||
            n.nativeId.includes(dim.value) ||
            n.name === dim.value,
          );
          if (!matchingNode) continue;

          const existing = (matchingNode.metadata["alarms"] as string[] | undefined) ?? [];
          existing.push(`${alarm.alarmName}: ${alarm.stateValue ?? "UNKNOWN"}`);
          matchingNode.metadata["alarms"] = existing;

          if (alarm.stateValue === "ALARM") {
            matchingNode.metadata["hasActiveAlarm"] = true;
          }
          matchingNode.metadata["monitoredByCloudWatch"] = true;
        }
      }
    }
  } catch {
    // CloudWatch alarm enrichment is best-effort
  }
}

/**
 * Enrich with deeper service-specific metadata.
 *
 * - S3: encryption, versioning, public access block status
 * - ECS containers: cluster→service→task chains
 * - Route53: DNS record → target resource edges
 * - API Gateway: integration → Lambda/HTTP edges
 */
export async function enrichWithDeeperDiscovery(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  // S3 bucket details
  const s3Mgr = await ctx.getS3Manager();
  if (s3Mgr) {
    const bucketNodes = nodes.filter((n) => n.resourceType === "storage");
    for (const bucket of bucketNodes) {
      try {
        const details = await (s3Mgr as {
          getBucketDetails: (bucketName: string, region?: string) => Promise<{
            success: boolean;
            data?: {
              versioning?: string;
              encryption?: { type?: string; algorithm?: string };
              lifecycle?: { rules?: unknown[] };
            };
          }>;
        }).getBucketDetails(bucket.nativeId, bucket.region);

        if (details.success && details.data) {
          bucket.metadata["versioning"] = details.data.versioning ?? "Disabled";
          if (details.data.encryption) {
            bucket.metadata["encryptionType"] = details.data.encryption.type ?? details.data.encryption.algorithm ?? "unknown";
          }
          if (details.data.lifecycle?.rules) {
            bucket.metadata["lifecycleRules"] = (details.data.lifecycle.rules as unknown[]).length;
          }
        }

        // Public access block
        const publicAccess = await (s3Mgr as {
          getPublicAccessBlock: (bucketName: string, region?: string) => Promise<{
            success: boolean;
            data?: { blockPublicAcls?: boolean; blockPublicPolicy?: boolean; ignorePublicAcls?: boolean; restrictPublicBuckets?: boolean };
          }>;
        }).getPublicAccessBlock(bucket.nativeId, bucket.region);

        if (publicAccess.success && publicAccess.data) {
          const isFullyBlocked = publicAccess.data.blockPublicAcls &&
            publicAccess.data.blockPublicPolicy &&
            publicAccess.data.ignorePublicAcls &&
            publicAccess.data.restrictPublicBuckets;
          bucket.metadata["publicAccessBlocked"] = isFullyBlocked;
          if (!isFullyBlocked) {
            bucket.metadata["hasSecurityIssues"] = true;
          }
        }
      } catch {
        // Individual bucket detail failure is non-fatal
      }
    }
  }

  // Route53: DNS record → target resource edges
  const dnsNodes = nodes.filter((n) => n.resourceType === "dns");
  for (const zone of dnsNodes) {
    try {
      const client = await ctx.createClient("Route53", "us-east-1");
      if (!client) continue;

      try {
        const command = await ctx.buildCommand("Route53", "listResourceRecordSets");
        if (!command) continue;

        (command as Record<string, unknown>)["input"] = { HostedZoneId: zone.nativeId };
        const response = await client.send(command) as Record<string, unknown>;
        const records = (response["ResourceRecordSets"] ?? []) as Array<{
          Name?: string;
          Type?: string;
          AliasTarget?: { DNSName?: string };
        }>;

        for (const record of records) {
          if (!record.AliasTarget?.DNSName) continue;

          // Find target node (load balancer, CloudFront, S3, etc.)
          const dnsName = record.AliasTarget.DNSName.replace(/\.$/, "");
          const targetNode = nodes.find((n) =>
            n.metadata["dnsName"] === dnsName ||
            n.nativeId.includes(dnsName) ||
            n.name === dnsName,
          );
          if (!targetNode) continue;

          const edgeId = `${zone.id}--resolves-to--${targetNode.id}`;
          if (edges.some((e) => e.id === edgeId)) continue;

          edges.push({
            id: edgeId,
            sourceNodeId: zone.id,
            targetNodeId: targetNode.id,
            relationshipType: "resolves-to",
            confidence: 0.95,
            discoveredVia: "api-field",
            metadata: {
              recordName: record.Name,
              recordType: record.Type,
            },
          });
        }
      } finally {
        client.destroy?.();
      }
    } catch {
      // DNS record enrichment is best-effort
    }
  }

  // API Gateway: integration → Lambda/HTTP edges
  const apiNodes = nodes.filter((n) => n.resourceType === "api-gateway");
  for (const api of apiNodes) {
    try {
      const client = await ctx.createClient("APIGateway", api.region);
      if (!client) continue;

      try {
        const command = await ctx.buildCommand("APIGateway", "getResources");
        if (!command) continue;

        (command as Record<string, unknown>)["input"] = { restApiId: api.nativeId };
        const response = await client.send(command) as Record<string, unknown>;
        const resources = (response["items"] ?? []) as Array<{
          id?: string;
          path?: string;
          resourceMethods?: Record<string, { methodIntegration?: { uri?: string; type?: string } }>;
        }>;

        for (const resource of resources) {
          if (!resource.resourceMethods) continue;
          for (const method of Object.values(resource.resourceMethods)) {
            const uri = method.methodIntegration?.uri;
            if (!uri) continue;

            const targetNode = findNodeByArnOrId(nodes, uri, extractResourceId(uri));
            if (!targetNode) continue;

            const edgeId = `${api.id}--routes-to--${targetNode.id}`;
            if (edges.some((e) => e.id === edgeId)) continue;

            edges.push({
              id: edgeId,
              sourceNodeId: api.id,
              targetNodeId: targetNode.id,
              relationshipType: "routes-to",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {
                path: resource.path,
                integrationType: method.methodIntegration?.type,
              },
            });
          }
        }
      } finally {
        client.destroy?.();
      }
    } catch {
      // API Gateway integration enrichment is best-effort
    }
  }
}

/**
 * Enrich discovered nodes with compliance posture from ComplianceManager.
 *
 * Queries AWS Config rules and conformance packs, then stamps
 * `metadata.compliance` on each discovered node with violation count,
 * rule evaluations, and overall compliance status.
 */
export async function enrichWithCompliance(ctx: AwsAdapterContext, nodes: GraphNodeInput[]): Promise<void> {
  const mgr = await ctx.getComplianceManager();
  if (!mgr) return;

  // Get Config rule compliance summaries
  const rulesResult = await (mgr as {
    listConfigRules: (opts?: unknown) => Promise<{
      success: boolean;
      data?: Array<{
        ConfigRuleName?: string;
        ConfigRuleId?: string;
        ConfigRuleArn?: string;
        Description?: string;
        Source?: { Owner?: string; SourceIdentifier?: string };
        Scope?: { ComplianceResourceTypes?: string[] };
      }>;
    }>;
  }).listConfigRules();

  if (!rulesResult.success || !rulesResult.data) return;

  // For each rule, get compliance details
  for (const rule of rulesResult.data) {
    if (!rule.ConfigRuleName) continue;

    try {
      const evalResult = await (mgr as {
        getConfigRuleCompliance: (ruleName: string) => Promise<{
          success: boolean;
          data?: {
            compliant?: number;
            nonCompliant?: number;
            notApplicable?: number;
            evaluations?: Array<{
              resourceId?: string;
              resourceType?: string;
              complianceType?: string;
              annotation?: string;
            }>;
          };
        }>;
      }).getConfigRuleCompliance(rule.ConfigRuleName);

      if (!evalResult.success || !evalResult.data?.evaluations) continue;

      for (const evaluation of evalResult.data.evaluations) {
        if (!evaluation.resourceId) continue;

        // Find the matching node
        const node = nodes.find((n) =>
          n.nativeId === evaluation.resourceId ||
          n.nativeId.includes(evaluation.resourceId!) ||
          n.name === evaluation.resourceId,
        );
        if (!node) continue;

        // Initialize or update compliance metadata
        const existing = (node.metadata["compliance"] as Record<string, unknown>) ?? {};
        const violations = ((existing["violations"] as unknown[]) ?? []) as Array<{
          rule: string; status: string; annotation?: string;
        }>;

        violations.push({
          rule: rule.ConfigRuleName,
          status: evaluation.complianceType ?? "UNKNOWN",
          annotation: evaluation.annotation,
        });

        node.metadata["compliance"] = {
          ...existing,
          violations,
          violationCount: violations.filter((v) => v.status === "NON_COMPLIANT").length,
          compliantRules: violations.filter((v) => v.status === "COMPLIANT").length,
          lastEvaluated: new Date().toISOString(),
        };
      }
    } catch {
      // Individual rule evaluation is best-effort
    }
  }
}
