/**
 * AWS Adapter — Messaging Domain Module (SQS + SNS)
 *
 * Discovers and enriches SQS queues and SNS topics with deeper metadata:
 * queue attributes, DLQ relationships, topic subscriptions, and fanout
 * edges via the SQSManager and SNSManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Enrich SQS queues with deeper attributes via SQSManager.
 *
 * Fetches queue metrics (message count, DLQ settings, retention),
 * and creates DLQ → source queue edges.
 */
export async function enrichSQS(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSQSManager();
  if (!mgr) return;

  const m = mgr as {
    listQueues: (prefix?: string, maxResults?: number) => Promise<{
      success: boolean;
      data?: string[];
    }>;
    getQueueMetrics: (queueUrl: string) => Promise<{
      success: boolean;
      data?: {
        approximateNumberOfMessages?: number;
        approximateNumberOfMessagesDelayed?: number;
        approximateNumberOfMessagesNotVisible?: number;
        visibilityTimeout?: number;
        messageRetentionPeriod?: number;
        maximumMessageSize?: number;
        delaySeconds?: number;
        receiveMessageWaitTimeSeconds?: number;
        redrivePolicy?: { deadLetterTargetArn?: string; maxReceiveCount?: number };
        fifoQueue?: boolean;
        contentBasedDeduplication?: boolean;
        kmsMasterKeyId?: string;
        queueArn?: string;
        createdTimestamp?: string;
      };
    }>;
    listQueueTags: (queueUrl: string) => Promise<{
      success: boolean;
      data?: Record<string, string>;
    }>;
  };

  try {
    const listResult = await m.listQueues(undefined, 100);
    if (!listResult.success || !listResult.data) return;

    for (const queueUrl of listResult.data) {
      const queueName = queueUrl.split("/").pop() ?? queueUrl;

      // Check if already discovered
      const existing = nodes.find(
        (n) =>
          n.resourceType === "queue" &&
          (n.name === queueName || n.nativeId === queueUrl || n.nativeId.includes(queueName)),
      );

      try {
        const metricsResult = await m.getQueueMetrics(queueUrl);
        if (!metricsResult.success || !metricsResult.data) continue;
        const metrics = metricsResult.data;

        if (existing) {
          // Enrich existing node
          existing.metadata["messageCount"] = metrics.approximateNumberOfMessages;
          existing.metadata["messagesDelayed"] = metrics.approximateNumberOfMessagesDelayed;
          existing.metadata["messagesInFlight"] = metrics.approximateNumberOfMessagesNotVisible;
          existing.metadata["retentionPeriod"] = metrics.messageRetentionPeriod;
          existing.metadata["visibilityTimeout"] = metrics.visibilityTimeout;
          existing.metadata["fifoQueue"] = metrics.fifoQueue;
          existing.metadata["maxMessageSize"] = metrics.maximumMessageSize;
          existing.metadata["discoverySource"] = "sqs-manager";
        } else {
          const queueNodeId = buildAwsNodeId(
            ctx.accountId,
            "us-east-1",
            "queue",
            queueName,
          );

          let tags: Record<string, string> = {};
          try {
            const tagResult = await m.listQueueTags(queueUrl);
            if (tagResult.success && tagResult.data) {
              tags = tagResult.data;
            }
          } catch {
            // Tag fetch is best-effort
          }

          nodes.push({
            id: queueNodeId,
            name: queueName,
            resourceType: "queue",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: metrics.queueArn ?? queueUrl,
            status: "running",
            tags,
            metadata: {
              queueUrl,
              messageCount: metrics.approximateNumberOfMessages,
              messagesDelayed: metrics.approximateNumberOfMessagesDelayed,
              messagesInFlight: metrics.approximateNumberOfMessagesNotVisible,
              retentionPeriod: metrics.messageRetentionPeriod,
              visibilityTimeout: metrics.visibilityTimeout,
              maxMessageSize: metrics.maximumMessageSize,
              fifoQueue: metrics.fifoQueue,
              contentBasedDeduplication: metrics.contentBasedDeduplication,
              discoverySource: "sqs-manager",
            },
            costMonthly: metrics.fifoQueue ? 0.50 : 0.40, // SQS pricing per 1M requests
            owner: tags["Owner"] ?? tags["owner"] ?? null,
            createdAt: metrics.createdTimestamp ?? null,
          });
        }

        // Create DLQ edge if redrivePolicy exists
        if (metrics.redrivePolicy?.deadLetterTargetArn) {
          const dlqArn = metrics.redrivePolicy.deadLetterTargetArn;
          const sourceNode = existing ?? nodes.find(
            (n) => n.resourceType === "queue" && n.name === queueName,
          );
          if (sourceNode) {
            const dlqNode = findNodeByArnOrId(
              nodes,
              dlqArn,
              extractResourceId(dlqArn),
            );
            if (dlqNode) {
              const edgeId = `${sourceNode.id}--routes-to--${dlqNode.id}`;
              if (!edges.some((e) => e.id === edgeId)) {
                edges.push({
                  id: edgeId,
                  sourceNodeId: sourceNode.id,
                  targetNodeId: dlqNode.id,
                  relationshipType: "routes-to",
                  confidence: 0.95,
                  discoveredVia: "api-field",
                  metadata: { maxReceiveCount: metrics.redrivePolicy.maxReceiveCount },
                });
              }
            }
          }
        }

        // Link to KMS key
        if (metrics.kmsMasterKeyId) {
          const sourceNode = existing ?? nodes.find(
            (n) => n.resourceType === "queue" && n.name === queueName,
          );
          if (sourceNode) {
            const kmsNode = nodes.find(
              (n) => n.nativeId.includes(metrics.kmsMasterKeyId!),
            );
            if (kmsNode) {
              const edgeId = `${sourceNode.id}--encrypts-with--${kmsNode.id}`;
              if (!edges.some((e) => e.id === edgeId)) {
                edges.push({
                  id: edgeId,
                  sourceNodeId: sourceNode.id,
                  targetNodeId: kmsNode.id,
                  relationshipType: "encrypts-with",
                  confidence: 0.9,
                  discoveredVia: "api-field",
                  metadata: {},
                });
              }
            }
          }
        }
      } catch {
        // Per-queue metrics is best-effort
      }
    }
  } catch {
    // SQS discovery is best-effort
  }
}

/**
 * Enrich SNS topics with subscriptions and fanout edges via SNSManager.
 *
 * Fetches topic metadata, subscription details, and creates edges
 * linking topics to SQS queues, Lambda functions, and HTTP endpoints.
 */
export async function enrichSNS(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSNSManager();
  if (!mgr) return;

  const m = mgr as {
    listTopics: () => Promise<{
      success: boolean;
      data?: Array<{
        topicArn?: string;
      }>;
    }>;
    getTopic: (topicArn: string) => Promise<{
      success: boolean;
      data?: {
        topicArn?: string;
        displayName?: string;
        subscriptionsConfirmed?: number;
        subscriptionsPending?: number;
        subscriptionsDeleted?: number;
        fifoTopic?: boolean;
        contentBasedDeduplication?: boolean;
        kmsMasterKeyId?: string;
        policy?: string;
        effectiveDeliveryPolicy?: string;
      };
    }>;
    listSubscriptionsByTopic: (topicArn: string) => Promise<{
      success: boolean;
      data?: Array<{
        subscriptionArn?: string;
        protocol?: string;
        endpoint?: string;
        owner?: string;
      }>;
    }>;
  };

  try {
    const topicsResult = await m.listTopics();
    if (!topicsResult.success || !topicsResult.data) return;

    for (const topicEntry of topicsResult.data) {
      if (!topicEntry.topicArn) continue;

      const topicName = topicEntry.topicArn.split(":").pop() ?? topicEntry.topicArn;

      const existing = nodes.find(
        (n) =>
          n.resourceType === "topic" &&
          (n.nativeId === topicEntry.topicArn || n.name === topicName),
      );

      try {
        const topicResult = await m.getTopic(topicEntry.topicArn);
        const topicData = topicResult.success ? topicResult.data : null;

        const topicNodeId = existing?.id ?? buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "topic",
          topicName,
        );

        if (existing) {
          if (topicData) {
            existing.metadata["subscriptionsConfirmed"] = topicData.subscriptionsConfirmed;
            existing.metadata["fifoTopic"] = topicData.fifoTopic;
            existing.metadata["displayName"] = topicData.displayName;
            existing.metadata["discoverySource"] = "sns-manager";
          }
        } else {
          nodes.push({
            id: topicNodeId,
            name: topicData?.displayName || topicName,
            resourceType: "topic",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: topicEntry.topicArn,
            status: "running",
            tags: {},
            metadata: {
              subscriptionsConfirmed: topicData?.subscriptionsConfirmed,
              subscriptionsPending: topicData?.subscriptionsPending,
              fifoTopic: topicData?.fifoTopic,
              contentBasedDeduplication: topicData?.contentBasedDeduplication,
              discoverySource: "sns-manager",
            },
            costMonthly: 0.50, // ~$0.50/1M publishes
            owner: null,
            createdAt: null,
          });
        }

        // Discover subscriptions → create fanout edges
        try {
          const subsResult = await m.listSubscriptionsByTopic(topicEntry.topicArn);
          if (subsResult.success && subsResult.data) {
            for (const sub of subsResult.data) {
              if (!sub.endpoint || sub.subscriptionArn === "PendingConfirmation") continue;

              // Link to SQS queue target
              if (sub.protocol === "sqs" && sub.endpoint) {
                const sqsNode = findNodeByArnOrId(
                  nodes,
                  sub.endpoint,
                  extractResourceId(sub.endpoint),
                );
                if (sqsNode) {
                  const edgeId = `${topicNodeId}--publishes-to--${sqsNode.id}`;
                  if (!edges.some((e) => e.id === edgeId)) {
                    edges.push({
                      id: edgeId,
                      sourceNodeId: topicNodeId,
                      targetNodeId: sqsNode.id,
                      relationshipType: "publishes-to",
                      confidence: 0.95,
                      discoveredVia: "api-field",
                      metadata: { protocol: "sqs" },
                    });
                  }
                }
              }

              // Link to Lambda function target
              if (sub.protocol === "lambda" && sub.endpoint) {
                const lambdaNode = findNodeByArnOrId(
                  nodes,
                  sub.endpoint,
                  extractResourceId(sub.endpoint),
                );
                if (lambdaNode) {
                  const edgeId = `${topicNodeId}--triggers--${lambdaNode.id}`;
                  if (!edges.some((e) => e.id === edgeId)) {
                    edges.push({
                      id: edgeId,
                      sourceNodeId: topicNodeId,
                      targetNodeId: lambdaNode.id,
                      relationshipType: "triggers",
                      confidence: 0.95,
                      discoveredVia: "api-field",
                      metadata: { protocol: "lambda" },
                    });
                  }
                }
              }

              // Link to HTTP/HTTPS endpoint (e.g., API Gateway)
              if ((sub.protocol === "https" || sub.protocol === "http") && sub.endpoint) {
                // Try to match API Gateway endpoint
                const apiNode = nodes.find(
                  (n) =>
                    n.resourceType === "api-gateway" &&
                    n.metadata["apiEndpoint"] &&
                    sub.endpoint!.includes(String(n.metadata["apiEndpoint"])),
                );
                if (apiNode) {
                  const edgeId = `${topicNodeId}--publishes-to--${apiNode.id}`;
                  if (!edges.some((e) => e.id === edgeId)) {
                    edges.push({
                      id: edgeId,
                      sourceNodeId: topicNodeId,
                      targetNodeId: apiNode.id,
                      relationshipType: "publishes-to",
                      confidence: 0.7,
                      discoveredVia: "api-field",
                      metadata: { protocol: sub.protocol, endpoint: sub.endpoint },
                    });
                  }
                }
              }
            }
          }
        } catch {
          // Subscription discovery is best-effort
        }
      } catch {
        // Per-topic detail is best-effort
      }
    }
  } catch {
    // SNS discovery is best-effort
  }
}
