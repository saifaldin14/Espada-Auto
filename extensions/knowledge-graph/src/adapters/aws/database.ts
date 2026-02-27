/**
 * AWS Adapter — Database Domain Module
 *
 * Discovers deeper database resources: ElastiCache replication groups
 * and clusters, RDS read replicas, snapshots, and subnet groups.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, extractResourceId } from "./utils.js";

/**
 * Discover ElastiCache replication groups and standalone clusters via
 * the ElastiCacheManager from @espada/aws.
 *
 * Creates `cache` nodes with engine, version, node type, encryption,
 * and replica metadata. Links to VPCs/subnets/SGs via relationship rules.
 */
export async function discoverElastiCache(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getElastiCacheManager();
  if (!mgr) return;

  // Discover replication groups (Redis/Valkey)
  const rgResult = await (mgr as {
    listReplicationGroups: (opts?: { maxResults?: number }) => Promise<{
      success: boolean;
      data?: Array<{
        ReplicationGroupId?: string;
        Description?: string;
        Status?: string;
        NodeGroups?: Array<{
          NodeGroupId?: string;
          Status?: string;
          NodeGroupMembers?: Array<{ CacheClusterId?: string; PreferredAvailabilityZone?: string }>;
        }>;
        CacheNodeType?: string;
        AtRestEncryptionEnabled?: boolean;
        TransitEncryptionEnabled?: boolean;
        ARN?: string;
        AuthTokenEnabled?: boolean;
        AutomaticFailover?: string;
        MultiAZ?: string;
        SnapshotRetentionLimit?: number;
      }>;
    }>;
  }).listReplicationGroups();

  if (rgResult.success && rgResult.data) {
    for (const rg of rgResult.data) {
      if (!rg.ReplicationGroupId) continue;

      const nodeId = buildAwsNodeId(
        ctx.accountId,
        "global",
        "cache",
        rg.ReplicationGroupId,
      );

      const replicaCount = rg.NodeGroups?.reduce(
        (sum, ng) => sum + (ng.NodeGroupMembers?.length ?? 0),
        0,
      ) ?? 0;

      nodes.push({
        id: nodeId,
        name: rg.ReplicationGroupId,
        resourceType: "cache",
        provider: "aws",
        region: "global",
        account: ctx.accountId,
        nativeId: rg.ARN ?? rg.ReplicationGroupId,
        status: rg.Status === "available" ? "running" : (rg.Status as GraphNodeInput["status"]) ?? "unknown",
        tags: {},
        metadata: {
          engine: "redis",
          description: rg.Description,
          nodeType: rg.CacheNodeType,
          replicaCount,
          atRestEncryption: rg.AtRestEncryptionEnabled ?? false,
          transitEncryption: rg.TransitEncryptionEnabled ?? false,
          automaticFailover: rg.AutomaticFailover,
          multiAZ: rg.MultiAZ,
          snapshotRetention: rg.SnapshotRetentionLimit,
          discoverySource: "elasticache-manager",
        },
        costMonthly: 15,
        owner: null,
        createdAt: null,
      });
    }
  }

  // Discover standalone Memcached clusters
  const ccResult = await (mgr as {
    listCacheClusters: (opts?: { showNodeInfo?: boolean; maxResults?: number }) => Promise<{
      success: boolean;
      data?: Array<{
        CacheClusterId?: string;
        CacheClusterStatus?: string;
        Engine?: string;
        EngineVersion?: string;
        CacheNodeType?: string;
        NumCacheNodes?: number;
        ARN?: string;
        PreferredAvailabilityZone?: string;
        CacheSubnetGroupName?: string;
        SecurityGroups?: Array<{ SecurityGroupId?: string; Status?: string }>;
        ReplicationGroupId?: string;
      }>;
    }>;
  }).listCacheClusters({ showNodeInfo: true });

  if (ccResult.success && ccResult.data) {
    for (const cc of ccResult.data) {
      // Skip clusters that belong to a replication group (already discovered above)
      if (cc.ReplicationGroupId || !cc.CacheClusterId) continue;

      const nodeId = buildAwsNodeId(
        ctx.accountId,
        cc.PreferredAvailabilityZone ?? "us-east-1",
        "cache",
        cc.CacheClusterId,
      );

      nodes.push({
        id: nodeId,
        name: cc.CacheClusterId,
        resourceType: "cache",
        provider: "aws",
        region: cc.PreferredAvailabilityZone ?? "us-east-1",
        account: ctx.accountId,
        nativeId: cc.ARN ?? cc.CacheClusterId,
        status: cc.CacheClusterStatus === "available" ? "running" : (cc.CacheClusterStatus as GraphNodeInput["status"]) ?? "unknown",
        tags: {},
        metadata: {
          engine: cc.Engine,
          engineVersion: cc.EngineVersion,
          nodeType: cc.CacheNodeType,
          numNodes: cc.NumCacheNodes,
          subnetGroup: cc.CacheSubnetGroupName,
          discoverySource: "elasticache-manager",
        },
        costMonthly: 15,
        owner: null,
        createdAt: null,
      });

      // Create security group edges
      if (cc.SecurityGroups) {
        for (const sg of cc.SecurityGroups) {
          if (!sg.SecurityGroupId) continue;
          const sgNode = nodes.find((n) => n.nativeId === sg.SecurityGroupId || n.nativeId.includes(sg.SecurityGroupId!));
          if (!sgNode) continue;

          const edgeId = `${nodeId}--secured-by--${sgNode.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: nodeId,
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
}

/**
 * Enrich existing RDS database nodes with replica info, multi-AZ status,
 * and discover snapshots and subnet groups via the RDSManager.
 *
 * - Enriches existing database nodes with replica info (listReadReplicas),
 *   multi-AZ status.
 * - Creates replica nodes + replicates edges.
 * - Discovers snapshots → storage nodes with resourceSubtype "rds-snapshot",
 *   backs-up edges.
 * - Discovers subnet groups → custom nodes with resourceSubtype
 *   "rds-subnet-group", contains edges to subnets.
 */
export async function discoverRDSDeeper(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getRDSManager();
  if (!mgr) return;

  // Find existing RDS database nodes to enrich
  const rdsNodes = nodes.filter((n) =>
    n.resourceType === "database" && n.provider === "aws" &&
    n.metadata["discoverySource"] !== "dynamodb",
  );

  for (const rdsNode of rdsNodes) {
    const dbId = rdsNode.name ?? extractResourceId(rdsNode.nativeId);

    // Discover read replicas
    try {
      const replicas = await (mgr as {
        listReadReplicas: (dbInstanceIdentifier: string, region?: string) => Promise<Array<{
          DBInstanceIdentifier?: string;
          DBInstanceArn?: string;
          DBInstanceStatus?: string;
          DBInstanceClass?: string;
          Engine?: string;
          AvailabilityZone?: string;
          ReadReplicaSourceDBInstanceIdentifier?: string;
        }>>;
      }).listReadReplicas(dbId);

      if (replicas && replicas.length > 0) {
        rdsNode.metadata["replicaCount"] = replicas.length;

        for (const replica of replicas) {
          if (!replica.DBInstanceIdentifier) continue;

          // Check if replica already exists as a node
          const existingReplica = nodes.find((n) =>
            n.nativeId === replica.DBInstanceArn ||
            n.name === replica.DBInstanceIdentifier,
          );

          if (!existingReplica) {
            const replicaNodeId = buildAwsNodeId(
              ctx.accountId,
              replica.AvailabilityZone ?? "us-east-1",
              "database",
              replica.DBInstanceIdentifier,
            );

            nodes.push({
              id: replicaNodeId,
              name: replica.DBInstanceIdentifier,
              resourceType: "database",
              provider: "aws",
              region: replica.AvailabilityZone ?? "us-east-1",
              account: ctx.accountId,
              nativeId: replica.DBInstanceArn ?? replica.DBInstanceIdentifier,
              status: replica.DBInstanceStatus === "available" ? "running" : (replica.DBInstanceStatus as GraphNodeInput["status"]) ?? "unknown",
              tags: {},
              metadata: {
                engine: replica.Engine,
                instanceClass: replica.DBInstanceClass,
                isReadReplica: true,
                sourceInstance: dbId,
                discoverySource: "rds-manager",
              },
              costMonthly: ctx.estimateCostStatic("database", { instanceType: replica.DBInstanceClass }),
              owner: null,
              createdAt: null,
            });

            // Create replicates edge
            const replicatesEdgeId = `${replicaNodeId}--replicates--${rdsNode.id}`;
            edges.push({
              id: replicatesEdgeId,
              sourceNodeId: replicaNodeId,
              targetNodeId: rdsNode.id,
              relationshipType: "replicates",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }
    } catch {
      // Replica discovery is best-effort
    }

    // Get Multi-AZ status
    try {
      const multiAZStatus = await (mgr as {
        getMultiAZStatus: (dbInstanceIdentifier: string, region?: string) => Promise<{
          multiAZ: boolean;
          secondaryAZ?: string;
        }>;
      }).getMultiAZStatus(dbId);

      if (multiAZStatus) {
        rdsNode.metadata["multiAZ"] = multiAZStatus.multiAZ;
        rdsNode.metadata["secondaryAZ"] = multiAZStatus.secondaryAZ;
      }
    } catch {
      // Multi-AZ status is best-effort
    }
  }

  // Discover RDS snapshots
  try {
    const snapshotResult = await (mgr as {
      listSnapshots: (opts?: { maxResults?: number }) => Promise<{
        snapshots: Array<{
          DBSnapshotIdentifier?: string;
          DBSnapshotArn?: string;
          DBInstanceIdentifier?: string;
          SnapshotCreateTime?: string;
          Status?: string;
          Engine?: string;
          AllocatedStorage?: number;
          SnapshotType?: string;
          Encrypted?: boolean;
        }>;
      }>;
    }).listSnapshots({ maxResults: 50 });

    if (snapshotResult.snapshots) {
      for (const snap of snapshotResult.snapshots) {
        if (!snap.DBSnapshotIdentifier) continue;

        const snapNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "storage",
          `rds-snap-${snap.DBSnapshotIdentifier}`,
        );

        nodes.push({
          id: snapNodeId,
          name: snap.DBSnapshotIdentifier,
          resourceType: "storage",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: snap.DBSnapshotArn ?? snap.DBSnapshotIdentifier,
          status: snap.Status === "available" ? "running" : (snap.Status as GraphNodeInput["status"]) ?? "unknown",
          tags: {},
          metadata: {
            resourceSubtype: "rds-snapshot",
            engine: snap.Engine,
            allocatedStorageGB: snap.AllocatedStorage,
            snapshotType: snap.SnapshotType,
            encrypted: snap.Encrypted ?? false,
            sourceInstance: snap.DBInstanceIdentifier,
            discoverySource: "rds-manager",
          },
          costMonthly: Math.round((snap.AllocatedStorage ?? 20) * 0.095 * 100) / 100,
          owner: null,
          createdAt: snap.SnapshotCreateTime ?? null,
        });

        // Link snapshot → source RDS instance (backs-up)
        if (snap.DBInstanceIdentifier) {
          const sourceNode = nodes.find((n) =>
            n.resourceType === "database" && n.name === snap.DBInstanceIdentifier,
          );
          if (sourceNode) {
            const backsUpEdgeId = `${snapNodeId}--backs-up--${sourceNode.id}`;
            if (!edges.some((e) => e.id === backsUpEdgeId)) {
              edges.push({
                id: backsUpEdgeId,
                sourceNodeId: snapNodeId,
                targetNodeId: sourceNode.id,
                relationshipType: "backs-up",
                confidence: 0.95,
                discoveredVia: "api-field",
                metadata: { snapshotType: snap.SnapshotType },
              });
            }
          }
        }
      }
    }
  } catch {
    // Snapshot discovery is best-effort
  }

  // Discover subnet groups
  try {
    const subnetGroupResult = await (mgr as {
      listSubnetGroups: (opts?: { maxResults?: number }) => Promise<{
        groups: Array<{
          DBSubnetGroupName?: string;
          DBSubnetGroupArn?: string;
          DBSubnetGroupDescription?: string;
          VpcId?: string;
          SubnetGroupStatus?: string;
          Subnets?: Array<{ SubnetIdentifier?: string; SubnetAvailabilityZone?: { Name?: string } }>;
        }>;
      }>;
    }).listSubnetGroups();

    if (subnetGroupResult.groups) {
      for (const sg of subnetGroupResult.groups) {
        if (!sg.DBSubnetGroupName) continue;

        const sgNodeId = buildAwsNodeId(
          ctx.accountId,
          "us-east-1",
          "custom",
          `rds-subnet-group-${sg.DBSubnetGroupName}`,
        );

        nodes.push({
          id: sgNodeId,
          name: sg.DBSubnetGroupName,
          resourceType: "custom",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: sg.DBSubnetGroupArn ?? sg.DBSubnetGroupName,
          status: sg.SubnetGroupStatus === "Complete" ? "running" : "unknown",
          tags: {},
          metadata: {
            resourceSubtype: "rds-subnet-group",
            description: sg.DBSubnetGroupDescription,
            vpcId: sg.VpcId,
            subnetCount: sg.Subnets?.length ?? 0,
            discoverySource: "rds-manager",
          },
          costMonthly: 0,
          owner: null,
          createdAt: null,
        });

        // Link subnet group → subnets
        if (sg.Subnets) {
          for (const subnet of sg.Subnets) {
            if (!subnet.SubnetIdentifier) continue;
            const subnetNode = nodes.find((n) =>
              n.nativeId === subnet.SubnetIdentifier || n.nativeId.includes(subnet.SubnetIdentifier!),
            );
            if (!subnetNode) continue;

            const containsEdgeId = `${sgNodeId}--contains--${subnetNode.id}`;
            if (!edges.some((e) => e.id === containsEdgeId)) {
              edges.push({
                id: containsEdgeId,
                sourceNodeId: sgNodeId,
                targetNodeId: subnetNode.id,
                relationshipType: "contains",
                confidence: 0.9,
                discoveredVia: "api-field",
                metadata: {},
              });
            }
          }
        }
      }
    }
  } catch {
    // Subnet group discovery is best-effort
  }
}
