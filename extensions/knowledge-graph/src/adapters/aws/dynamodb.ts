/**
 * AWS Adapter — DynamoDB Domain Module
 *
 * Discovers DynamoDB tables with detailed metadata: GSIs, capacity mode,
 * item counts, global tables, and backup configurations via the
 * DynamoDBManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId } from "./utils.js";

/**
 * Discover DynamoDB tables and enrichment via DynamoDBManager.
 *
 * Lists all tables, fetches detailed metrics (item count, size, GSIs,
 * capacity mode), and discovers global table replicas and backup status.
 */
export async function discoverDynamoDB(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getDynamoDBManager();
  if (!mgr) return;

  const m = mgr as {
    listTables: (limit?: number) => Promise<{
      success: boolean;
      data?: string[];
    }>;
    describeTable: (tableName: string) => Promise<{
      success: boolean;
      data?: {
        tableName?: string;
        tableArn?: string;
        tableStatus?: string;
        itemCount?: number;
        tableSizeBytes?: number;
        billingModeSummary?: { billingMode?: string };
        provisionedThroughput?: { readCapacityUnits?: number; writeCapacityUnits?: number };
        globalSecondaryIndexes?: Array<{
          indexName?: string;
          indexStatus?: string;
          itemCount?: number;
          indexSizeBytes?: number;
          provisionedThroughput?: { readCapacityUnits?: number; writeCapacityUnits?: number };
        }>;
        localSecondaryIndexes?: Array<{ indexName?: string }>;
        streamSpecification?: { streamEnabled?: boolean; streamViewType?: string };
        sseDescription?: { status?: string; sseType?: string; kmsMasterKeyArn?: string };
        tableClassSummary?: { tableClass?: string };
        deletionProtectionEnabled?: boolean;
        replicas?: Array<{ regionName?: string; replicaStatus?: string }>;
        creationDateTime?: string;
      };
    }>;
    listGlobalTables: () => Promise<{
      success: boolean;
      data?: Array<{
        globalTableName?: string;
        replicationGroup?: Array<{ regionName?: string }>;
      }>;
    }>;
    listBackups: (tableName?: string) => Promise<{
      success: boolean;
      data?: Array<{
        tableName?: string;
        backupArn?: string;
        backupName?: string;
        backupStatus?: string;
        backupType?: string;
        backupSizeBytes?: number;
        backupCreationDateTime?: string;
      }>;
    }>;
  };

  // --- List and describe tables ---
  try {
    const listResult = await m.listTables(100);
    if (!listResult.success || !listResult.data) return;

    for (const tableName of listResult.data) {
      // Check if table already discovered by base adapter
      const existing = nodes.find(
        (n) =>
          n.resourceType === "database" &&
          (n.name === tableName || n.nativeId.includes(tableName)),
      );

      try {
        const descResult = await m.describeTable(tableName);
        if (!descResult.success || !descResult.data) continue;

        const table = descResult.data;

        if (existing) {
          // Enrich existing node
          existing.metadata["itemCount"] = table.itemCount;
          existing.metadata["tableSizeBytes"] = table.tableSizeBytes;
          existing.metadata["billingMode"] = table.billingModeSummary?.billingMode;
          existing.metadata["gsiCount"] = table.globalSecondaryIndexes?.length ?? 0;
          existing.metadata["lsiCount"] = table.localSecondaryIndexes?.length ?? 0;
          existing.metadata["streamEnabled"] = table.streamSpecification?.streamEnabled;
          existing.metadata["sseEnabled"] = table.sseDescription?.status === "ENABLED";
          existing.metadata["tableClass"] = table.tableClassSummary?.tableClass;
          existing.metadata["deletionProtection"] = table.deletionProtectionEnabled;
          existing.metadata["replicaCount"] = table.replicas?.length ?? 0;
          existing.metadata["discoverySource"] = "dynamodb-manager";
          continue;
        }

        const tableNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "database",
          `dynamodb-${tableName}`,
        );

        // Estimate cost based on billing mode and capacity
        let costEstimate = 0.25; // Minimum for on-demand
        if (table.billingModeSummary?.billingMode === "PROVISIONED") {
          const rcu = table.provisionedThroughput?.readCapacityUnits ?? 0;
          const wcu = table.provisionedThroughput?.writeCapacityUnits ?? 0;
          // $0.00065/RCU-hour, $0.00065/WCU-hour
          costEstimate = (rcu * 0.00065 + wcu * 0.00065) * 730;
        } else {
          // On-demand: estimate based on item count
          const items = table.itemCount ?? 0;
          costEstimate = items > 1_000_000 ? 25 : items > 100_000 ? 5 : 1.25;
        }

        // Add GSI costs
        if (table.globalSecondaryIndexes) {
          for (const gsi of table.globalSecondaryIndexes) {
            if (gsi.provisionedThroughput) {
              const gsiRcu = gsi.provisionedThroughput.readCapacityUnits ?? 0;
              const gsiWcu = gsi.provisionedThroughput.writeCapacityUnits ?? 0;
              costEstimate += (gsiRcu * 0.00065 + gsiWcu * 0.00065) * 730;
            }
          }
        }

        // Storage cost: $0.25/GB/month
        if (table.tableSizeBytes) {
          costEstimate += (table.tableSizeBytes / (1024 * 1024 * 1024)) * 0.25;
        }

        nodes.push({
          id: tableNodeId,
          name: tableName,
          resourceType: "database",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: table.tableArn ?? tableName,
          status: table.tableStatus === "ACTIVE" ? "running" : "stopped",
          tags: {},
          metadata: {
            resourceSubtype: "dynamodb-table",
            itemCount: table.itemCount,
            tableSizeBytes: table.tableSizeBytes,
            billingMode: table.billingModeSummary?.billingMode,
            gsiCount: table.globalSecondaryIndexes?.length ?? 0,
            lsiCount: table.localSecondaryIndexes?.length ?? 0,
            streamEnabled: table.streamSpecification?.streamEnabled,
            streamViewType: table.streamSpecification?.streamViewType,
            sseEnabled: table.sseDescription?.status === "ENABLED",
            sseType: table.sseDescription?.sseType,
            tableClass: table.tableClassSummary?.tableClass,
            deletionProtection: table.deletionProtectionEnabled,
            replicaCount: table.replicas?.length ?? 0,
            discoverySource: "dynamodb-manager",
          },
          costMonthly: Math.round(costEstimate * 100) / 100,
          owner: null,
          createdAt: table.creationDateTime ?? null,
        });

        // Link KMS key if SSE is enabled
        if (table.sseDescription?.kmsMasterKeyArn) {
          const kmsNode = nodes.find(
            (n) => n.nativeId === table.sseDescription!.kmsMasterKeyArn,
          );
          if (kmsNode) {
            const edgeId = `${tableNodeId}--encrypts-with--${kmsNode.id}`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                sourceNodeId: tableNodeId,
                targetNodeId: kmsNode.id,
                relationshipType: "encrypts-with",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }

        // Create edges for global table replicas
        if (table.replicas) {
          for (const replica of table.replicas) {
            if (!replica.regionName) continue;
            const replicaNodeId = buildAwsNodeId(
              ctx.accountId,
              replica.regionName,
              "database",
              `dynamodb-${tableName}`,
            );

            // Only link if it's a different region (cross-region replica)
            if (replica.regionName !== "us-east-1") {
              const edgeId = `${tableNodeId}--replicates-to--${replicaNodeId}`;
              if (!edges.some((e) => e.id === edgeId)) {
                edges.push({
                  id: edgeId,
                  sourceNodeId: tableNodeId,
                  targetNodeId: replicaNodeId,
                  relationshipType: "replicates-to",
                  confidence: 0.9,
                  discoveredVia: "api-field",
                  metadata: { replicaStatus: replica.replicaStatus },
                });
              }
            }
          }
        }
      } catch {
        // Per-table describe is best-effort
      }
    }
  } catch {
    // DynamoDB discovery is best-effort
  }

  // --- DynamoDB Backups ---
  try {
    const backupResult = await m.listBackups();
    if (backupResult.success && backupResult.data) {
      for (const backup of backupResult.data) {
        if (!backup.backupArn || !backup.tableName) continue;

        const backupNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `dynamodb-backup-${backup.backupName ?? extractBackupId(backup.backupArn)}`,
        );

        nodes.push({
          id: backupNodeId,
          name: backup.backupName ?? `backup-${backup.tableName}`,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: backup.backupArn,
          status: backup.backupStatus === "AVAILABLE" ? "running" : "stopped",
          tags: {},
          metadata: {
            resourceSubtype: "dynamodb-backup",
            backupType: backup.backupType,
            backupSizeBytes: backup.backupSizeBytes,
            tableName: backup.tableName,
            discoverySource: "dynamodb-manager",
          },
          costMonthly: backup.backupSizeBytes
            ? Math.round((backup.backupSizeBytes / (1024 * 1024 * 1024)) * 0.10 * 100) / 100
            : 0,
          owner: null,
          createdAt: backup.backupCreationDateTime ?? null,
        });

        // Link backup → table
        const tableNode = nodes.find(
          (n) =>
            n.resourceType === "database" &&
            (n.name === backup.tableName || n.nativeId.includes(backup.tableName!)),
        );
        if (tableNode) {
          const edgeId = `${backupNodeId}--backs-up--${tableNode.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: backupNodeId,
              targetNodeId: tableNode.id,
              relationshipType: "backs-up",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }
    }
  } catch {
    // Backup discovery is best-effort
  }
}

/** Extract a short backup ID from a DynamoDB backup ARN. */
function extractBackupId(arn: string): string {
  const parts = arn.split("/");
  return parts[parts.length - 1] ?? arn;
}
