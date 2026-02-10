import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ElastiCacheClient
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-elasticache", () => {
  return {
    ElastiCacheClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
    DescribeReplicationGroupsCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeReplicationGroups" })),
    DescribeCacheClustersCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeCacheClusters" })),
    CreateReplicationGroupCommand: vi.fn().mockImplementation((input) => ({ input, _type: "CreateReplicationGroup" })),
    ModifyReplicationGroupCommand: vi.fn().mockImplementation((input) => ({ input, _type: "ModifyReplicationGroup" })),
    DeleteReplicationGroupCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DeleteReplicationGroup" })),
    CreateCacheClusterCommand: vi.fn().mockImplementation((input) => ({ input, _type: "CreateCacheCluster" })),
    DeleteCacheClusterCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DeleteCacheCluster" })),
    DescribeCacheParameterGroupsCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeCacheParameterGroups" })),
    DescribeCacheSubnetGroupsCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeCacheSubnetGroups" })),
    CreateSnapshotCommand: vi.fn().mockImplementation((input) => ({ input, _type: "CreateSnapshot" })),
    DeleteSnapshotCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DeleteSnapshot" })),
    DescribeSnapshotsCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeSnapshots" })),
    TestFailoverCommand: vi.fn().mockImplementation((input) => ({ input, _type: "TestFailover" })),
    IncreaseReplicaCountCommand: vi.fn().mockImplementation((input) => ({ input, _type: "IncreaseReplicaCount" })),
    DecreaseReplicaCountCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DecreaseReplicaCount" })),
    ModifyReplicationGroupShardConfigurationCommand: vi.fn().mockImplementation((input) => ({ input, _type: "ModifyShardConfig" })),
    DescribeEventsCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeEvents" })),
    DescribeCacheEngineVersionsCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeCacheEngineVersions" })),
    DescribeReservedCacheNodesCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DescribeReservedCacheNodes" })),
    ListTagsForResourceCommand: vi.fn().mockImplementation((input) => ({ input, _type: "ListTags" })),
    AddTagsToResourceCommand: vi.fn().mockImplementation((input) => ({ input, _type: "AddTags" })),
    RemoveTagsFromResourceCommand: vi.fn().mockImplementation((input) => ({ input, _type: "RemoveTags" })),
  };
});

vi.mock("../retry.js", () => ({
  createAWSRetryRunner: () => <T>(fn: () => Promise<T>) => fn(),
}));

import { ElastiCacheManager, createElastiCacheManager } from "./manager.js";

// ============================================================================
// Fixtures
// ============================================================================

const sampleReplicationGroup = {
  ReplicationGroupId: "my-redis",
  Description: "Test cluster",
  Status: "available",
  CacheNodeType: "cache.t3.micro",
  ClusterEnabled: true,
  AtRestEncryptionEnabled: true,
  TransitEncryptionEnabled: true,
  AutomaticFailover: "enabled",
  MultiAZ: "enabled",
  SnapshotRetentionLimit: 7,
  SnapshotWindow: "05:00-06:00",
  PreferredMaintenanceWindow: "sun:23:00-mon:01:30",
  ARN: "arn:aws:elasticache:us-east-1:123:replicationgroup:my-redis",
  MemberClusters: ["my-redis-001", "my-redis-002"],
  NodeGroups: [
    {
      NodeGroupId: "0001",
      Status: "available",
      Slots: "0-16383",
      PrimaryEndpoint: { Address: "my-redis.abc.ng.0001.use1.cache.amazonaws.com", Port: 6379 },
      ReaderEndpoint: { Address: "my-redis-ro.abc.ng.0001.use1.cache.amazonaws.com", Port: 6379 },
      NodeGroupMembers: [
        {
          CacheClusterId: "my-redis-001",
          CacheNodeId: "0001",
          CurrentRole: "primary",
          PreferredAvailabilityZone: "us-east-1a",
          ReadEndpoint: { Address: "my-redis-001.abc.0001.use1.cache.amazonaws.com", Port: 6379 },
        },
        {
          CacheClusterId: "my-redis-002",
          CacheNodeId: "0001",
          CurrentRole: "replica",
          PreferredAvailabilityZone: "us-east-1b",
          ReadEndpoint: { Address: "my-redis-002.abc.0001.use1.cache.amazonaws.com", Port: 6379 },
        },
      ],
    },
  ],
};

const sampleSnapshot = {
  SnapshotName: "my-snap",
  SnapshotStatus: "available",
  SnapshotSource: "manual",
  ReplicationGroupId: "my-redis",
  Engine: "redis",
  EngineVersion: "7.1",
  CacheNodeType: "cache.t3.micro",
  NumNodeGroups: 1,
  NumCacheClusters: 2,
  SnapshotRetentionLimit: 7,
  SnapshotWindow: "05:00-06:00",
  ARN: "arn:aws:elasticache:us-east-1:123:snapshot:my-snap",
};

const sampleCacheCluster = {
  CacheClusterId: "my-memcached",
  CacheClusterStatus: "available",
  Engine: "memcached",
  EngineVersion: "1.6.22",
  CacheNodeType: "cache.t3.micro",
  NumCacheNodes: 3,
  PreferredAvailabilityZone: "us-east-1a",
  SnapshotRetentionLimit: 0,
  ARN: "arn:aws:elasticache:us-east-1:123:cluster:my-memcached",
  CacheClusterCreateTime: new Date("2024-01-01"),
};

// ============================================================================
// Tests
// ============================================================================

describe("ElastiCacheManager", () => {
  let manager: ElastiCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ElastiCacheManager({ region: "us-east-1" });
  });

  describe("factory", () => {
    it("creates a manager via factory function", () => {
      const m = createElastiCacheManager({ region: "us-west-2" });
      expect(m).toBeInstanceOf(ElastiCacheManager);
    });
  });

  // ==========================================================================
  // Replication Groups
  // ==========================================================================

  describe("listReplicationGroups", () => {
    it("returns replication groups", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroups: [sampleReplicationGroup] });
      const result = await manager.listReplicationGroups();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("my-redis");
      expect(result.data![0].clusterEnabled).toBe(true);
    });

    it("handles empty result", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroups: [] });
      const result = await manager.listReplicationGroups();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("handles error", async () => {
      mockSend.mockRejectedValueOnce(new Error("API error"));
      const result = await manager.listReplicationGroups();

      expect(result.success).toBe(false);
      expect(result.error).toBe("API error");
    });
  });

  describe("getReplicationGroup", () => {
    it("returns a specific replication group with tags", async () => {
      mockSend
        .mockResolvedValueOnce({ ReplicationGroups: [sampleReplicationGroup] })
        .mockResolvedValueOnce({ TagList: [{ Key: "env", Value: "prod" }] });

      const result = await manager.getReplicationGroup("my-redis");

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("my-redis");
      expect(result.data!.tags).toEqual({ env: "prod" });
    });

    it("returns error when group not found", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroups: [] });
      const result = await manager.getReplicationGroup("nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("createReplicationGroup", () => {
    it("creates a replication group with defaults", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });

      const result = await manager.createReplicationGroup({
        replicationGroupId: "my-redis",
        description: "Test cluster",
        nodeType: "cache.t3.micro",
      });

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("my-redis");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("handles creation failure", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: null });
      const result = await manager.createReplicationGroup({
        replicationGroupId: "fail",
        description: "Will fail",
        nodeType: "cache.t3.micro",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed");
    });

    it("applies default tags from config", async () => {
      const taggedManager = new ElastiCacheManager({
        region: "us-east-1",
        defaultTags: { team: "platform" },
      });
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });

      await taggedManager.createReplicationGroup({
        replicationGroupId: "my-redis",
        description: "Test",
        nodeType: "cache.t3.micro",
        tags: { env: "prod" },
      });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Tags).toEqual(
        expect.arrayContaining([
          { Key: "team", Value: "platform" },
          { Key: "env", Value: "prod" },
        ]),
      );
    });
  });

  describe("modifyReplicationGroup", () => {
    it("modifies a replication group", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });

      const result = await manager.modifyReplicationGroup("my-redis", {
        nodeType: "cache.m6g.large",
        applyImmediately: true,
      });

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("handles modification error", async () => {
      mockSend.mockRejectedValueOnce(new Error("Cannot modify"));
      const result = await manager.modifyReplicationGroup("my-redis", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot modify");
    });
  });

  describe("deleteReplicationGroup", () => {
    it("deletes a replication group", async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await manager.deleteReplicationGroup("my-redis");

      expect(result.success).toBe(true);
    });

    it("supports final snapshot on delete", async () => {
      mockSend.mockResolvedValueOnce({});
      await manager.deleteReplicationGroup("my-redis", { finalSnapshotName: "final-snap" });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.FinalSnapshotIdentifier).toBe("final-snap");
    });

    it("handles delete error", async () => {
      mockSend.mockRejectedValueOnce(new Error("In use"));
      const result = await manager.deleteReplicationGroup("my-redis");

      expect(result.success).toBe(false);
      expect(result.error).toBe("In use");
    });
  });

  // ==========================================================================
  // Scaling
  // ==========================================================================

  describe("scaleReplicationGroup", () => {
    it("increases replica count", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "add_replicas",
        newReplicaCount: 3,
      });

      expect(result.success).toBe(true);
    });

    it("decreases replica count", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "remove_replicas",
        newReplicaCount: 1,
      });

      expect(result.success).toBe(true);
    });

    it("adds shards", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "add_shards",
        newNumNodeGroups: 3,
      });

      expect(result.success).toBe(true);
    });

    it("removes shards", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "remove_shards",
        newNumNodeGroups: 1,
      });

      expect(result.success).toBe(true);
    });

    it("requires newReplicaCount for add_replicas", async () => {
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "add_replicas",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("newReplicaCount");
    });

    it("requires newReplicaCount for remove_replicas", async () => {
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "remove_replicas",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("newReplicaCount");
    });

    it("requires newNumNodeGroups for shard scaling", async () => {
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "add_shards",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("newNumNodeGroups");
    });

    it("handles SDK errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("Scaling failed"));
      const result = await manager.scaleReplicationGroup("my-redis", {
        action: "add_replicas",
        newReplicaCount: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Scaling failed");
    });
  });

  // ==========================================================================
  // Failover
  // ==========================================================================

  describe("testFailover", () => {
    it("triggers failover for a node group", async () => {
      mockSend.mockResolvedValueOnce({ ReplicationGroup: sampleReplicationGroup });
      const result = await manager.testFailover("my-redis", "0001");

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("my-redis");
    });

    it("handles failover error", async () => {
      mockSend.mockRejectedValueOnce(new Error("Cannot failover"));
      const result = await manager.testFailover("my-redis", "0001");

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // Snapshots
  // ==========================================================================

  describe("listSnapshots", () => {
    it("lists snapshots", async () => {
      mockSend.mockResolvedValueOnce({ Snapshots: [sampleSnapshot] });
      const result = await manager.listSnapshots();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].snapshotName).toBe("my-snap");
    });

    it("filters by replication group", async () => {
      mockSend.mockResolvedValueOnce({ Snapshots: [] });
      await manager.listSnapshots({ replicationGroupId: "my-redis" });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ReplicationGroupId).toBe("my-redis");
    });
  });

  describe("createSnapshot", () => {
    it("creates a snapshot", async () => {
      mockSend.mockResolvedValueOnce({ Snapshot: sampleSnapshot });
      const result = await manager.createSnapshot({
        snapshotName: "my-snap",
        replicationGroupId: "my-redis",
      });

      expect(result.success).toBe(true);
      expect(result.data!.snapshotName).toBe("my-snap");
    });

    it("handles snapshot creation failure", async () => {
      mockSend.mockResolvedValueOnce({ Snapshot: null });
      const result = await manager.createSnapshot({ snapshotName: "fail" });

      expect(result.success).toBe(false);
    });
  });

  describe("deleteSnapshot", () => {
    it("deletes a snapshot", async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await manager.deleteSnapshot("my-snap");

      expect(result.success).toBe(true);
    });

    it("handles delete error", async () => {
      mockSend.mockRejectedValueOnce(new Error("Not found"));
      const result = await manager.deleteSnapshot("nope");

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // Cache Clusters
  // ==========================================================================

  describe("listCacheClusters", () => {
    it("lists cache clusters", async () => {
      mockSend.mockResolvedValueOnce({ CacheClusters: [sampleCacheCluster] });
      const result = await manager.listCacheClusters();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("my-memcached");
      expect(result.data![0].engine).toBe("memcached");
    });
  });

  describe("createCacheCluster", () => {
    it("creates a Memcached cluster", async () => {
      mockSend.mockResolvedValueOnce({ CacheCluster: sampleCacheCluster });
      const result = await manager.createCacheCluster({
        cacheClusterId: "my-memcached",
        engine: "memcached",
        nodeType: "cache.t3.micro",
        numNodes: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data!.numNodes).toBe(3);
    });

    it("handles creation failure", async () => {
      mockSend.mockRejectedValueOnce(new Error("Quota exceeded"));
      const result = await manager.createCacheCluster({
        cacheClusterId: "fail",
        engine: "memcached",
        nodeType: "cache.t3.micro",
        numNodes: 1,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("deleteCacheCluster", () => {
    it("deletes a cache cluster", async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await manager.deleteCacheCluster("my-memcached");

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Parameter & Subnet Groups
  // ==========================================================================

  describe("listParameterGroups", () => {
    it("lists parameter groups", async () => {
      mockSend.mockResolvedValueOnce({
        CacheParameterGroups: [
          {
            CacheParameterGroupName: "default.redis7",
            CacheParameterGroupFamily: "redis7",
            Description: "Default parameter group for redis7",
            IsGlobal: false,
          },
        ],
      });

      const result = await manager.listParameterGroups();

      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe("default.redis7");
      expect(result.data![0].family).toBe("redis7");
    });
  });

  describe("listSubnetGroups", () => {
    it("lists subnet groups", async () => {
      mockSend.mockResolvedValueOnce({
        CacheSubnetGroups: [
          {
            CacheSubnetGroupName: "my-subnet-group",
            CacheSubnetGroupDescription: "Test subnet group",
            VpcId: "vpc-123",
            Subnets: [
              { SubnetIdentifier: "subnet-a", SubnetAvailabilityZone: { Name: "us-east-1a" } },
              { SubnetIdentifier: "subnet-b", SubnetAvailabilityZone: { Name: "us-east-1b" } },
            ],
          },
        ],
      });

      const result = await manager.listSubnetGroups();

      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe("my-subnet-group");
      expect(result.data![0].vpcId).toBe("vpc-123");
      expect(result.data![0].subnets).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Engine Versions
  // ==========================================================================

  describe("listEngineVersions", () => {
    it("lists engine versions", async () => {
      mockSend.mockResolvedValueOnce({
        CacheEngineVersions: [
          {
            Engine: "redis",
            EngineVersion: "7.1",
            CacheParameterGroupFamily: "redis7",
            CacheEngineVersionDescription: "Redis 7.1",
          },
        ],
      });

      const result = await manager.listEngineVersions("redis");

      expect(result.success).toBe(true);
      expect(result.data![0].engine).toBe("redis");
      expect(result.data![0].engineVersion).toBe("7.1");
    });
  });

  // ==========================================================================
  // Events
  // ==========================================================================

  describe("listEvents", () => {
    it("lists events with defaults", async () => {
      mockSend.mockResolvedValueOnce({
        Events: [
          {
            SourceIdentifier: "my-redis",
            SourceType: "replication-group",
            Message: "Cluster available",
            Date: new Date("2024-01-01"),
          },
        ],
      });

      const result = await manager.listEvents();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].sourceIdentifier).toBe("my-redis");
    });

    it("filters events by source", async () => {
      mockSend.mockResolvedValueOnce({ Events: [] });
      await manager.listEvents({
        sourceIdentifier: "my-redis",
        sourceType: "replication-group",
      });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.SourceIdentifier).toBe("my-redis");
      expect(cmd.input.SourceType).toBe("replication-group");
    });
  });

  // ==========================================================================
  // Tags
  // ==========================================================================

  describe("addTags", () => {
    it("adds tags to a resource", async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await manager.addTags(
        "arn:aws:elasticache:us-east-1:123:replicationgroup:my-redis",
        { env: "prod", team: "platform" },
      );

      expect(result.success).toBe(true);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Tags).toEqual(
        expect.arrayContaining([
          { Key: "env", Value: "prod" },
          { Key: "team", Value: "platform" },
        ]),
      );
    });
  });

  describe("removeTags", () => {
    it("removes tags from a resource", async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await manager.removeTags(
        "arn:aws:elasticache:us-east-1:123:replicationgroup:my-redis",
        ["env"],
      );

      expect(result.success).toBe(true);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.TagKeys).toEqual(["env"]);
    });
  });

  // ==========================================================================
  // Reserved Nodes
  // ==========================================================================

  describe("listReservedNodes", () => {
    it("lists reserved nodes", async () => {
      mockSend.mockResolvedValueOnce({
        ReservedCacheNodes: [
          {
            ReservedCacheNodeId: "ri-123",
            CacheNodeType: "cache.r6g.large",
            Duration: 31536000,
            OfferingType: "No Upfront",
            State: "active",
            CacheNodeCount: 2,
            StartTime: new Date("2024-01-01"),
          },
        ],
      });

      const result = await manager.listReservedNodes();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].reservedId).toBe("ri-123");
      expect(result.data![0].count).toBe(2);
    });
  });
});
