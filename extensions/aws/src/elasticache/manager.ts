/**
 * ElastiCache Manager - Redis & Memcached Operations
 *
 * Comprehensive ElastiCache cluster management with:
 * - Replication group lifecycle (create, modify, delete)
 * - Serverless cache management
 * - Node type and scaling operations
 * - Snapshot creation and restoration
 * - Failover and replica promotion
 * - Parameter and subnet group management
 * - Cluster metrics and events
 */

import {
  type AWSRetryOptions,
  createAWSRetryRunner,
} from "../retry.js";

import {
  ElastiCacheClient,
  DescribeReplicationGroupsCommand,
  DescribeCacheClustersCommand,
  CreateReplicationGroupCommand,
  ModifyReplicationGroupCommand,
  DeleteReplicationGroupCommand,
  CreateCacheClusterCommand,
  DeleteCacheClusterCommand,
  DescribeCacheParameterGroupsCommand,
  DescribeCacheSubnetGroupsCommand,
  CreateSnapshotCommand,
  DeleteSnapshotCommand,
  DescribeSnapshotsCommand,
  TestFailoverCommand,
  IncreaseReplicaCountCommand,
  DecreaseReplicaCountCommand,
  ModifyReplicationGroupShardConfigurationCommand,
  DescribeEventsCommand,
  DescribeCacheEngineVersionsCommand,
  DescribeReservedCacheNodesCommand,
  ListTagsForResourceCommand,
  AddTagsToResourceCommand,
  RemoveTagsFromResourceCommand,
  type ReplicationGroup,
  type CacheCluster,
  type Snapshot,
  type CacheParameterGroup,
  type CacheSubnetGroup,
  type Event,
  type CacheEngineVersion,
  type NodeGroupMember,
} from "@aws-sdk/client-elasticache";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ElastiCacheManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export interface ElastiCacheOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ReplicationGroupInfo {
  id: string;
  description: string;
  status: string;
  engine: string;
  engineVersion: string;
  nodeType: string;
  numNodeGroups: number;
  numReplicas: number;
  clusterEnabled: boolean;
  atRestEncryptionEnabled: boolean;
  transitEncryptionEnabled: boolean;
  automaticFailover: string;
  multiAZ: string;
  snapshotRetentionLimit: number;
  snapshotWindow: string;
  maintenanceWindow: string;
  arn: string;
  primaryEndpoint?: string;
  readerEndpoint?: string;
  configEndpoint?: string;
  memberClusters: string[];
  nodeGroups: NodeGroupInfo[];
  tags: Record<string, string>;
}

export interface NodeGroupInfo {
  nodeGroupId: string;
  status: string;
  primaryEndpoint?: string;
  readerEndpoint?: string;
  slots?: string;
  members: NodeMemberInfo[];
}

export interface NodeMemberInfo {
  cacheClusterId: string;
  cacheNodeId: string;
  currentRole: string;
  preferredAvailabilityZone?: string;
  readEndpoint?: string;
}

export interface CacheClusterInfo {
  id: string;
  status: string;
  engine: string;
  engineVersion: string;
  nodeType: string;
  numNodes: number;
  preferredAvailabilityZone?: string;
  replicationGroupId?: string;
  snapshotRetentionLimit: number;
  arn: string;
  createdAt?: Date;
}

export interface SnapshotInfo {
  snapshotName: string;
  snapshotStatus: string;
  snapshotSource: string;
  replicationGroupId?: string;
  cacheClusterId?: string;
  engine: string;
  engineVersion: string;
  nodeType: string;
  numNodeGroups: number;
  numCacheClusters: number;
  snapshotRetentionLimit: number;
  snapshotWindow: string;
  arn?: string;
  createdAt?: Date;
}

export interface CreateReplicationGroupOptions {
  replicationGroupId: string;
  description: string;
  engine?: "redis" | "valkey";
  engineVersion?: string;
  nodeType: string;
  numNodeGroups?: number;
  replicasPerNodeGroup?: number;
  automaticFailoverEnabled?: boolean;
  multiAZEnabled?: boolean;
  atRestEncryptionEnabled?: boolean;
  transitEncryptionEnabled?: boolean;
  authToken?: string;
  port?: number;
  subnetGroupName?: string;
  securityGroupIds?: string[];
  parameterGroupName?: string;
  snapshotRetentionLimit?: number;
  snapshotWindow?: string;
  maintenanceWindow?: string;
  tags?: Record<string, string>;
}

export interface ModifyReplicationGroupOptions {
  description?: string;
  nodeType?: string;
  engineVersion?: string;
  automaticFailoverEnabled?: boolean;
  multiAZEnabled?: boolean;
  snapshotRetentionLimit?: number;
  snapshotWindow?: string;
  maintenanceWindow?: string;
  securityGroupIds?: string[];
  parameterGroupName?: string;
  applyImmediately?: boolean;
}

export interface ScaleReplicationGroupOptions {
  action: "add_replicas" | "remove_replicas" | "add_shards" | "remove_shards";
  newReplicaCount?: number;
  newNumNodeGroups?: number;
  applyImmediately?: boolean;
}

export interface CreateSnapshotOptions {
  snapshotName: string;
  replicationGroupId?: string;
  cacheClusterId?: string;
  tags?: Record<string, string>;
}

export interface EventInfo {
  sourceIdentifier: string;
  sourceType: string;
  message: string;
  date?: Date;
}

export interface EngineVersionInfo {
  engine: string;
  engineVersion: string;
  cacheParameterGroupFamily: string;
  description: string;
}

export interface ParameterGroupInfo {
  name: string;
  family: string;
  description: string;
  isGlobal: boolean;
}

export interface SubnetGroupInfo {
  name: string;
  description: string;
  vpcId: string;
  subnets: Array<{
    subnetId: string;
    availabilityZone: string;
  }>;
}

export interface ListReplicationGroupsOptions {
  maxResults?: number;
}

export interface ListSnapshotsOptions {
  replicationGroupId?: string;
  cacheClusterId?: string;
  snapshotName?: string;
  maxResults?: number;
}

export interface ListEventsOptions {
  sourceIdentifier?: string;
  sourceType?: "cache-cluster" | "cache-parameter-group" | "cache-subnet-group" | "cache-security-group" | "replication-group" | "serverless-cache" | "serverless-cache-snapshot" | "user" | "user-group";
  duration?: number;
  maxResults?: number;
}

// ============================================================================
// ElastiCache Manager
// ============================================================================

export class ElastiCacheManager {
  private client: ElastiCacheClient;
  private config: ElastiCacheManagerConfig;
  private retry: <T>(fn: () => Promise<T>, label?: string) => Promise<T>;

  constructor(
    config: ElastiCacheManagerConfig = {},
    retryOptions: AWSRetryOptions = {},
  ) {
    this.config = config;

    this.client = new ElastiCacheClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });

    this.retry = createAWSRetryRunner(retryOptions);
  }

  // ==========================================================================
  // Replication Groups
  // ==========================================================================

  async listReplicationGroups(
    options: ListReplicationGroupsOptions = {},
  ): Promise<ElastiCacheOperationResult<ReplicationGroupInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeReplicationGroupsCommand({
          MaxRecords: options.maxResults ?? 100,
        })),
        "DescribeReplicationGroups",
      );

      const groups = (response.ReplicationGroups ?? []).map(
        (g) => this.mapReplicationGroup(g),
      );

      return { success: true, data: groups };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getReplicationGroup(
    replicationGroupId: string,
  ): Promise<ElastiCacheOperationResult<ReplicationGroupInfo>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeReplicationGroupsCommand({
          ReplicationGroupId: replicationGroupId,
        })),
        "DescribeReplicationGroup",
      );

      const group = response.ReplicationGroups?.[0];
      if (!group) {
        return { success: false, error: `Replication group '${replicationGroupId}' not found` };
      }

      // Fetch tags
      const tags = await this.getResourceTags(group.ARN!);

      const info = this.mapReplicationGroup(group);
      info.tags = tags;

      return { success: true, data: info };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createReplicationGroup(
    options: CreateReplicationGroupOptions,
  ): Promise<ElastiCacheOperationResult<ReplicationGroupInfo>> {
    try {
      const tags = {
        ...this.config.defaultTags,
        ...options.tags,
      };

      const tagList = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

      const response = await this.retry(
        () => this.client.send(new CreateReplicationGroupCommand({
          ReplicationGroupId: options.replicationGroupId,
          ReplicationGroupDescription: options.description,
          Engine: options.engine ?? "redis",
          EngineVersion: options.engineVersion,
          CacheNodeType: options.nodeType,
          NumNodeGroups: options.numNodeGroups ?? 1,
          ReplicasPerNodeGroup: options.replicasPerNodeGroup ?? 1,
          AutomaticFailoverEnabled: options.automaticFailoverEnabled ?? true,
          MultiAZEnabled: options.multiAZEnabled ?? true,
          AtRestEncryptionEnabled: options.atRestEncryptionEnabled ?? true,
          TransitEncryptionEnabled: options.transitEncryptionEnabled ?? true,
          AuthToken: options.authToken,
          Port: options.port ?? 6379,
          CacheSubnetGroupName: options.subnetGroupName,
          SecurityGroupIds: options.securityGroupIds,
          CacheParameterGroupName: options.parameterGroupName,
          SnapshotRetentionLimit: options.snapshotRetentionLimit ?? 7,
          SnapshotWindow: options.snapshotWindow,
          PreferredMaintenanceWindow: options.maintenanceWindow,
          Tags: tagList.length > 0 ? tagList : undefined,
        })),
        "CreateReplicationGroup",
      );

      const group = response.ReplicationGroup;
      if (!group) {
        return { success: false, error: "Failed to create replication group" };
      }

      return { success: true, data: this.mapReplicationGroup(group) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async modifyReplicationGroup(
    replicationGroupId: string,
    options: ModifyReplicationGroupOptions,
  ): Promise<ElastiCacheOperationResult<ReplicationGroupInfo>> {
    try {
      const response = await this.retry(
        () => this.client.send(new ModifyReplicationGroupCommand({
          ReplicationGroupId: replicationGroupId,
          ReplicationGroupDescription: options.description,
          CacheNodeType: options.nodeType,
          EngineVersion: options.engineVersion,
          AutomaticFailoverEnabled: options.automaticFailoverEnabled,
          MultiAZEnabled: options.multiAZEnabled,
          SnapshotRetentionLimit: options.snapshotRetentionLimit,
          SnapshotWindow: options.snapshotWindow,
          PreferredMaintenanceWindow: options.maintenanceWindow,
          SecurityGroupIds: options.securityGroupIds,
          CacheParameterGroupName: options.parameterGroupName,
          ApplyImmediately: options.applyImmediately ?? true,
        })),
        "ModifyReplicationGroup",
      );

      const group = response.ReplicationGroup;
      if (!group) {
        return { success: false, error: "Failed to modify replication group" };
      }

      return { success: true, data: this.mapReplicationGroup(group) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteReplicationGroup(
    replicationGroupId: string,
    options: { finalSnapshotName?: string; retainPrimaryCluster?: boolean } = {},
  ): Promise<ElastiCacheOperationResult<void>> {
    try {
      await this.retry(
        () => this.client.send(new DeleteReplicationGroupCommand({
          ReplicationGroupId: replicationGroupId,
          FinalSnapshotIdentifier: options.finalSnapshotName,
          RetainPrimaryCluster: options.retainPrimaryCluster ?? false,
        })),
        "DeleteReplicationGroup",
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Scaling
  // ==========================================================================

  async scaleReplicationGroup(
    replicationGroupId: string,
    options: ScaleReplicationGroupOptions,
  ): Promise<ElastiCacheOperationResult<ReplicationGroupInfo>> {
    try {
      let group: ReplicationGroup | undefined;

      switch (options.action) {
        case "add_replicas": {
          if (options.newReplicaCount == null) {
            return { success: false, error: "newReplicaCount is required for add_replicas" };
          }
          const resp = await this.retry(
            () => this.client.send(new IncreaseReplicaCountCommand({
              ReplicationGroupId: replicationGroupId,
              NewReplicaCount: options.newReplicaCount!,
              ApplyImmediately: options.applyImmediately ?? true,
            })),
            "IncreaseReplicaCount",
          );
          group = resp.ReplicationGroup;
          break;
        }

        case "remove_replicas": {
          if (options.newReplicaCount == null) {
            return { success: false, error: "newReplicaCount is required for remove_replicas" };
          }
          const resp = await this.retry(
            () => this.client.send(new DecreaseReplicaCountCommand({
              ReplicationGroupId: replicationGroupId,
              NewReplicaCount: options.newReplicaCount!,
              ApplyImmediately: options.applyImmediately ?? true,
            })),
            "DecreaseReplicaCount",
          );
          group = resp.ReplicationGroup;
          break;
        }

        case "add_shards":
        case "remove_shards": {
          if (options.newNumNodeGroups == null) {
            return { success: false, error: "newNumNodeGroups is required for shard scaling" };
          }
          const resp = await this.retry(
            () => this.client.send(
              new ModifyReplicationGroupShardConfigurationCommand({
                ReplicationGroupId: replicationGroupId,
                NodeGroupCount: options.newNumNodeGroups!,
                ApplyImmediately: options.applyImmediately ?? true,
              }),
            ),
            "ModifyShardConfiguration",
          );
          group = resp.ReplicationGroup;
          break;
        }

        default:
          return { success: false, error: `Unknown scale action: ${options.action}` };
      }

      if (!group) {
        return { success: false, error: "Scale operation returned no data" };
      }

      return { success: true, data: this.mapReplicationGroup(group) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Failover
  // ==========================================================================

  async testFailover(
    replicationGroupId: string,
    nodeGroupId: string,
  ): Promise<ElastiCacheOperationResult<ReplicationGroupInfo>> {
    try {
      const response = await this.retry(
        () => this.client.send(new TestFailoverCommand({
          ReplicationGroupId: replicationGroupId,
          NodeGroupId: nodeGroupId,
        })),
        "TestFailover",
      );

      const group = response.ReplicationGroup;
      if (!group) {
        return { success: false, error: "Failover returned no data" };
      }

      return { success: true, data: this.mapReplicationGroup(group) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Snapshots
  // ==========================================================================

  async listSnapshots(
    options: ListSnapshotsOptions = {},
  ): Promise<ElastiCacheOperationResult<SnapshotInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeSnapshotsCommand({
          ReplicationGroupId: options.replicationGroupId,
          CacheClusterId: options.cacheClusterId,
          SnapshotName: options.snapshotName,
          MaxRecords: options.maxResults ?? 50,
        })),
        "DescribeSnapshots",
      );

      const snapshots = (response.Snapshots ?? []).map(
        (s) => this.mapSnapshot(s),
      );

      return { success: true, data: snapshots };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createSnapshot(
    options: CreateSnapshotOptions,
  ): Promise<ElastiCacheOperationResult<SnapshotInfo>> {
    try {
      const tags = {
        ...this.config.defaultTags,
        ...options.tags,
      };
      const tagList = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

      const response = await this.retry(
        () => this.client.send(new CreateSnapshotCommand({
          SnapshotName: options.snapshotName,
          ReplicationGroupId: options.replicationGroupId,
          CacheClusterId: options.cacheClusterId,
          Tags: tagList.length > 0 ? tagList : undefined,
        })),
        "CreateSnapshot",
      );

      const snapshot = response.Snapshot;
      if (!snapshot) {
        return { success: false, error: "Failed to create snapshot" };
      }

      return { success: true, data: this.mapSnapshot(snapshot) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteSnapshot(
    snapshotName: string,
  ): Promise<ElastiCacheOperationResult<void>> {
    try {
      await this.retry(
        () => this.client.send(new DeleteSnapshotCommand({
          SnapshotName: snapshotName,
        })),
        "DeleteSnapshot",
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Cache Clusters (standalone Memcached or read-only info)
  // ==========================================================================

  async listCacheClusters(
    options: { showNodeInfo?: boolean; maxResults?: number } = {},
  ): Promise<ElastiCacheOperationResult<CacheClusterInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeCacheClustersCommand({
          ShowCacheNodeInfo: options.showNodeInfo ?? true,
          MaxRecords: options.maxResults ?? 100,
        })),
        "DescribeCacheClusters",
      );

      const clusters = (response.CacheClusters ?? []).map(
        (c) => this.mapCacheCluster(c),
      );

      return { success: true, data: clusters };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createCacheCluster(
    options: {
      cacheClusterId: string;
      engine: "memcached";
      nodeType: string;
      numNodes: number;
      engineVersion?: string;
      subnetGroupName?: string;
      securityGroupIds?: string[];
      parameterGroupName?: string;
      port?: number;
      tags?: Record<string, string>;
    },
  ): Promise<ElastiCacheOperationResult<CacheClusterInfo>> {
    try {
      const tags = { ...this.config.defaultTags, ...options.tags };
      const tagList = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

      const response = await this.retry(
        () => this.client.send(new CreateCacheClusterCommand({
          CacheClusterId: options.cacheClusterId,
          Engine: options.engine,
          CacheNodeType: options.nodeType,
          NumCacheNodes: options.numNodes,
          EngineVersion: options.engineVersion,
          CacheSubnetGroupName: options.subnetGroupName,
          SecurityGroupIds: options.securityGroupIds,
          CacheParameterGroupName: options.parameterGroupName,
          Port: options.port ?? 11211,
          Tags: tagList.length > 0 ? tagList : undefined,
        })),
        "CreateCacheCluster",
      );

      const cluster = response.CacheCluster;
      if (!cluster) {
        return { success: false, error: "Failed to create cache cluster" };
      }

      return { success: true, data: this.mapCacheCluster(cluster) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteCacheCluster(
    cacheClusterId: string,
    finalSnapshotName?: string,
  ): Promise<ElastiCacheOperationResult<void>> {
    try {
      await this.retry(
        () => this.client.send(new DeleteCacheClusterCommand({
          CacheClusterId: cacheClusterId,
          FinalSnapshotIdentifier: finalSnapshotName,
        })),
        "DeleteCacheCluster",
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Parameter Groups & Subnet Groups
  // ==========================================================================

  async listParameterGroups(
    maxResults?: number,
  ): Promise<ElastiCacheOperationResult<ParameterGroupInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeCacheParameterGroupsCommand({
          MaxRecords: maxResults ?? 100,
        })),
        "DescribeCacheParameterGroups",
      );

      const groups: ParameterGroupInfo[] = (response.CacheParameterGroups ?? []).map(
        (g: CacheParameterGroup) => ({
          name: g.CacheParameterGroupName ?? "",
          family: g.CacheParameterGroupFamily ?? "",
          description: g.Description ?? "",
          isGlobal: g.IsGlobal ?? false,
        }),
      );

      return { success: true, data: groups };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listSubnetGroups(
    maxResults?: number,
  ): Promise<ElastiCacheOperationResult<SubnetGroupInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeCacheSubnetGroupsCommand({
          MaxRecords: maxResults ?? 100,
        })),
        "DescribeCacheSubnetGroups",
      );

      const groups: SubnetGroupInfo[] = (response.CacheSubnetGroups ?? []).map(
        (g: CacheSubnetGroup) => ({
          name: g.CacheSubnetGroupName ?? "",
          description: g.CacheSubnetGroupDescription ?? "",
          vpcId: g.VpcId ?? "",
          subnets: (g.Subnets ?? []).map((s) => ({
            subnetId: s.SubnetIdentifier ?? "",
            availabilityZone: s.SubnetAvailabilityZone?.Name ?? "",
          })),
        }),
      );

      return { success: true, data: groups };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Engine Versions
  // ==========================================================================

  async listEngineVersions(
    engine?: string,
  ): Promise<ElastiCacheOperationResult<EngineVersionInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeCacheEngineVersionsCommand({
          Engine: engine,
        })),
        "DescribeCacheEngineVersions",
      );

      const versions: EngineVersionInfo[] = (response.CacheEngineVersions ?? []).map(
        (v: CacheEngineVersion) => ({
          engine: v.Engine ?? "",
          engineVersion: v.EngineVersion ?? "",
          cacheParameterGroupFamily: v.CacheParameterGroupFamily ?? "",
          description: v.CacheEngineVersionDescription ?? "",
        }),
      );

      return { success: true, data: versions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  async listEvents(
    options: ListEventsOptions = {},
  ): Promise<ElastiCacheOperationResult<EventInfo[]>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeEventsCommand({
          SourceIdentifier: options.sourceIdentifier,
          SourceType: options.sourceType,
          Duration: options.duration ?? 1440, // default 24 hours
          MaxRecords: options.maxResults ?? 50,
        })),
        "DescribeEvents",
      );

      const events: EventInfo[] = (response.Events ?? []).map(
        (e: Event) => ({
          sourceIdentifier: e.SourceIdentifier ?? "",
          sourceType: e.SourceType ?? "",
          message: e.Message ?? "",
          date: e.Date,
        }),
      );

      return { success: true, data: events };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Tags
  // ==========================================================================

  async addTags(
    resourceArn: string,
    tags: Record<string, string>,
  ): Promise<ElastiCacheOperationResult<void>> {
    try {
      const tagList = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

      await this.retry(
        () => this.client.send(new AddTagsToResourceCommand({
          ResourceName: resourceArn,
          Tags: tagList,
        })),
        "AddTags",
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async removeTags(
    resourceArn: string,
    tagKeys: string[],
  ): Promise<ElastiCacheOperationResult<void>> {
    try {
      await this.retry(
        () => this.client.send(new RemoveTagsFromResourceCommand({
          ResourceName: resourceArn,
          TagKeys: tagKeys,
        })),
        "RemoveTags",
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Reserved Nodes
  // ==========================================================================

  async listReservedNodes(
    maxResults?: number,
  ): Promise<ElastiCacheOperationResult<Array<{
    reservedId: string;
    nodeType: string;
    duration: number;
    offeringType: string;
    state: string;
    count: number;
    startTime?: Date;
  }>>> {
    try {
      const response = await this.retry(
        () => this.client.send(new DescribeReservedCacheNodesCommand({
          MaxRecords: maxResults ?? 100,
        })),
        "DescribeReservedCacheNodes",
      );

      const nodes = (response.ReservedCacheNodes ?? []).map((n) => ({
        reservedId: n.ReservedCacheNodeId ?? "",
        nodeType: n.CacheNodeType ?? "",
        duration: n.Duration ?? 0,
        offeringType: n.OfferingType ?? "",
        state: n.State ?? "",
        count: n.CacheNodeCount ?? 0,
        startTime: n.StartTime,
      }));

      return { success: true, data: nodes };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private mapReplicationGroup(g: ReplicationGroup): ReplicationGroupInfo {
    const nodeGroups: NodeGroupInfo[] = (g.NodeGroups ?? []).map((ng) => ({
      nodeGroupId: ng.NodeGroupId ?? "",
      status: ng.Status ?? "",
      primaryEndpoint: ng.PrimaryEndpoint
        ? `${ng.PrimaryEndpoint.Address}:${ng.PrimaryEndpoint.Port}`
        : undefined,
      readerEndpoint: ng.ReaderEndpoint
        ? `${ng.ReaderEndpoint.Address}:${ng.ReaderEndpoint.Port}`
        : undefined,
      slots: ng.Slots ?? undefined,
      members: (ng.NodeGroupMembers ?? []).map((m: NodeGroupMember) => ({
        cacheClusterId: m.CacheClusterId ?? "",
        cacheNodeId: m.CacheNodeId ?? "",
        currentRole: m.CurrentRole ?? "",
        preferredAvailabilityZone: m.PreferredAvailabilityZone,
        readEndpoint: m.ReadEndpoint
          ? `${m.ReadEndpoint.Address}:${m.ReadEndpoint.Port}`
          : undefined,
      })),
    }));

    return {
      id: g.ReplicationGroupId ?? "",
      description: g.Description ?? "",
      status: g.Status ?? "",
      engine: "redis",
      engineVersion: g.NodeGroups?.[0]?.NodeGroupMembers?.[0]?.CacheNodeId
        ? "" // engine version not directly on ReplicationGroup
        : "",
      nodeType: g.CacheNodeType ?? "",
      numNodeGroups: g.NodeGroups?.length ?? 0,
      numReplicas: (g.MemberClusters?.length ?? 1) - 1,
      clusterEnabled: g.ClusterEnabled ?? false,
      atRestEncryptionEnabled: g.AtRestEncryptionEnabled ?? false,
      transitEncryptionEnabled: g.TransitEncryptionEnabled ?? false,
      automaticFailover: g.AutomaticFailover ?? "disabled",
      multiAZ: g.MultiAZ ?? "disabled",
      snapshotRetentionLimit: g.SnapshotRetentionLimit ?? 0,
      snapshotWindow: g.SnapshotWindow ?? "",
      maintenanceWindow: (g as Record<string, unknown>).PreferredMaintenanceWindow as string ?? "",
      arn: g.ARN ?? "",
      primaryEndpoint: nodeGroups[0]?.primaryEndpoint,
      readerEndpoint: nodeGroups[0]?.readerEndpoint,
      configEndpoint: g.ConfigurationEndpoint
        ? `${g.ConfigurationEndpoint.Address}:${g.ConfigurationEndpoint.Port}`
        : undefined,
      memberClusters: g.MemberClusters ?? [],
      nodeGroups,
      tags: {},
    };
  }

  private mapSnapshot(s: Snapshot): SnapshotInfo {
    return {
      snapshotName: s.SnapshotName ?? "",
      snapshotStatus: s.SnapshotStatus ?? "",
      snapshotSource: s.SnapshotSource ?? "",
      replicationGroupId: s.ReplicationGroupId,
      cacheClusterId: s.CacheClusterId,
      engine: s.Engine ?? "",
      engineVersion: s.EngineVersion ?? "",
      nodeType: s.CacheNodeType ?? "",
      numNodeGroups: s.NumNodeGroups ?? 0,
      numCacheClusters: s.NodeSnapshots?.length ?? 0,
      snapshotRetentionLimit: s.SnapshotRetentionLimit ?? 0,
      snapshotWindow: s.SnapshotWindow ?? "",
      arn: s.ARN,
      createdAt: undefined, // not directly exposed
    };
  }

  private mapCacheCluster(c: CacheCluster): CacheClusterInfo {
    return {
      id: c.CacheClusterId ?? "",
      status: c.CacheClusterStatus ?? "",
      engine: c.Engine ?? "",
      engineVersion: c.EngineVersion ?? "",
      nodeType: c.CacheNodeType ?? "",
      numNodes: c.NumCacheNodes ?? 0,
      preferredAvailabilityZone: c.PreferredAvailabilityZone,
      replicationGroupId: c.ReplicationGroupId,
      snapshotRetentionLimit: c.SnapshotRetentionLimit ?? 0,
      arn: c.ARN ?? "",
      createdAt: c.CacheClusterCreateTime,
    };
  }

  private async getResourceTags(arn: string): Promise<Record<string, string>> {
    try {
      const response = await this.retry(
        () => this.client.send(new ListTagsForResourceCommand({
          ResourceName: arn,
        })),
        "ListTags",
      );

      const tags: Record<string, string> = {};
      for (const tag of response.TagList ?? []) {
        if (tag.Key) {
          tags[tag.Key] = tag.Value ?? "";
        }
      }
      return tags;
    } catch {
      return {};
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createElastiCacheManager(
  config: ElastiCacheManagerConfig = {},
  retryOptions: AWSRetryOptions = {},
): ElastiCacheManager {
  return new ElastiCacheManager(config, retryOptions);
}
