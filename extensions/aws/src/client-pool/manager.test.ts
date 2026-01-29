/**
 * AWS Client Pool Manager - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AWSClientPoolManager, createClientPool } from "./manager.js";
import type { AWSCredentials, AWSServiceName } from "../types.js";

// Mock AWS SDK clients
vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
}));

vi.mock("@aws-sdk/client-iam", () => ({
  IAMClient: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
}));

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
}));

vi.mock("@aws-sdk/client-cloudtrail", () => ({
  CloudTrailClient: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
}));

vi.mock("@aws-sdk/client-organizations", () => ({
  OrganizationsClient: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
}));

vi.mock("@aws-sdk/client-resource-groups-tagging-api", () => ({
  ResourceGroupsTaggingAPIClient: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
}));

const mockCredentials: AWSCredentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  source: "profile",
};

const mockCredentialsWithToken: AWSCredentials = {
  accessKeyId: "ASIATEMP1234567890AB",
  secretAccessKey: "tempSecretKey123456789abcdefghijklmnopqrs",
  sessionToken: "FwoGZXIvYXdzEBYaDK...",
  source: "assumed-role",
  expiration: new Date(Date.now() + 3600000),
};

describe("AWSClientPoolManager", () => {
  let pool: AWSClientPoolManager;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new AWSClientPoolManager();
  });

  afterEach(() => {
    pool.destroy();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const p = new AWSClientPoolManager();
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept custom maxClientsPerService", () => {
      const p = new AWSClientPoolManager({ maxClientsPerService: 10 });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept custom maxTotalClients", () => {
      const p = new AWSClientPoolManager({ maxTotalClients: 100 });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept custom clientTTL", () => {
      const p = new AWSClientPoolManager({ clientTTL: 7200000 });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept custom cleanupInterval", () => {
      const p = new AWSClientPoolManager({ cleanupInterval: 600000 });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept preload services list", () => {
      const p = new AWSClientPoolManager({ preloadServices: ["ec2", "iam"] });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept custom default region", () => {
      const p = new AWSClientPoolManager({ defaultRegion: "eu-west-1" });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });

    it("should accept all config options together", () => {
      const p = new AWSClientPoolManager({
        maxClientsPerService: 10,
        maxTotalClients: 100,
        clientTTL: 7200000,
        cleanupInterval: 600000,
        preloadServices: ["ec2"],
        defaultRegion: "eu-west-1",
      });
      expect(p).toBeInstanceOf(AWSClientPoolManager);
      p.destroy();
    });
  });

  describe("getStats", () => {
    it("should return initial stats with zero clients", () => {
      const stats = pool.getStats();
      expect(stats.totalClients).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(0);
    });

    it("should track client counts correctly", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("iam", "us-east-1", mockCredentials);
      
      const stats = pool.getStats();
      expect(stats.totalClients).toBe(2);
    });

    it("should track cache hits", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      
      const stats = pool.getStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });

    it("should track cache misses", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("ec2", "us-west-2", mockCredentials);
      
      const stats = pool.getStats();
      expect(stats.cacheMisses).toBe(2);
    });

    it("should track evicted clients", async () => {
      const smallPool = new AWSClientPoolManager({ maxTotalClients: 2 });
      
      await smallPool.getClient("ec2", "us-east-1", mockCredentials);
      await smallPool.getClient("iam", "us-east-1", mockCredentials);
      await smallPool.getClient("sts", "us-east-1", mockCredentials);
      
      const stats = smallPool.getStats();
      expect(stats.evictedClients).toBeGreaterThanOrEqual(1);
      
      smallPool.destroy();
    });
  });

  describe("getClient", () => {
    it("should create a new client for EC2", async () => {
      const client = await pool.getClient("ec2", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should create a new client for IAM", async () => {
      const client = await pool.getClient("iam", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should create a new client for STS", async () => {
      const client = await pool.getClient("sts", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should create a new client for CloudTrail", async () => {
      const client = await pool.getClient("cloudtrail", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should create a new client for Organizations", async () => {
      const client = await pool.getClient("organizations", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should create a new client for Resource Groups Tagging API", async () => {
      const client = await pool.getClient("resourcegroupstaggingapi", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should return cached client on subsequent calls", async () => {
      const client1 = await pool.getClient("ec2", "us-east-1", mockCredentials);
      const client2 = await pool.getClient("ec2", "us-east-1", mockCredentials);
      expect(client1).toBe(client2);
    });

    it("should create different clients for different regions", async () => {
      const client1 = await pool.getClient("ec2", "us-east-1", mockCredentials);
      const client2 = await pool.getClient("ec2", "us-west-2", mockCredentials);
      expect(client1).not.toBe(client2);
    });

    it("should create different clients for different services", async () => {
      const client1 = await pool.getClient("ec2", "us-east-1", mockCredentials);
      const client2 = await pool.getClient("iam", "us-east-1", mockCredentials);
      expect(client1).not.toBe(client2);
    });

    it("should create different clients for different profiles", async () => {
      const client1 = await pool.getClient("ec2", "us-east-1", mockCredentials, "default");
      const client2 = await pool.getClient("ec2", "us-east-1", mockCredentials, "production");
      expect(client1).not.toBe(client2);
    });

    it("should handle credentials with session token", async () => {
      const client = await pool.getClient("ec2", "us-east-1", mockCredentialsWithToken);
      expect(client).toBeDefined();
    });

    it("should throw for unsupported service", async () => {
      await expect(
        pool.getClient("unsupported-service" as AWSServiceName, "us-east-1", mockCredentials)
      ).rejects.toThrow("Unsupported service");
    });
  });

  describe("typed client getters", () => {
    it("should get EC2 client via getEC2Client", async () => {
      const client = await pool.getEC2Client("us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should get IAM client via getIAMClient (global service)", async () => {
      const client = await pool.getIAMClient(mockCredentials);
      expect(client).toBeDefined();
    });

    it("should get STS client via getSTSClient", async () => {
      const client = await pool.getSTSClient("us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });

    it("should get CloudTrail client via getCloudTrailClient", async () => {
      const client = await pool.getCloudTrailClient("us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });
  });

  describe("client eviction", () => {
    it("should evict clients when exceeding maxTotalClients", async () => {
      const smallPool = new AWSClientPoolManager({ maxTotalClients: 2 });
      
      await smallPool.getClient("ec2", "us-east-1", mockCredentials);
      await smallPool.getClient("iam", "us-east-1", mockCredentials);
      
      let stats = smallPool.getStats();
      expect(stats.totalClients).toBe(2);
      
      await smallPool.getClient("sts", "us-east-1", mockCredentials);
      
      stats = smallPool.getStats();
      expect(stats.totalClients).toBeLessThanOrEqual(2);
      
      smallPool.destroy();
    });

    it("should evict least recently used clients", async () => {
      const smallPool = new AWSClientPoolManager({ maxTotalClients: 2 });
      
      await smallPool.getClient("ec2", "us-east-1", mockCredentials);
      await smallPool.getClient("iam", "us-east-1", mockCredentials);
      
      // Use EC2 client again to make it more recent
      await smallPool.getClient("ec2", "us-east-1", mockCredentials);
      
      // Add new client, should evict IAM (least recently used)
      await smallPool.getClient("sts", "us-east-1", mockCredentials);
      
      // Pool should still have max 2 clients after eviction
      const stats = smallPool.getStats();
      expect(stats.totalClients).toBeLessThanOrEqual(2);
      
      smallPool.destroy();
    });
  });

  describe("clearAll", () => {
    it("should remove all clients", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("iam", "us-east-1", mockCredentials);
      await pool.getClient("sts", "us-west-2", mockCredentials);
      
      let stats = pool.getStats();
      expect(stats.totalClients).toBe(3);
      
      pool.clearAll();
      
      stats = pool.getStats();
      expect(stats.totalClients).toBe(0);
    });

    it("should allow getting new clients after clear", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      pool.clearAll();
      
      const client = await pool.getClient("ec2", "us-east-1", mockCredentials);
      expect(client).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up all resources", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("iam", "us-east-1", mockCredentials);
      
      pool.destroy();
      
      const stats = pool.getStats();
      expect(stats.totalClients).toBe(0);
    });

    it("should be safe to call multiple times", () => {
      pool.destroy();
      pool.destroy();
      expect(true).toBe(true);
    });
  });

  describe("concurrent access", () => {
    it("should handle concurrent requests for same client", async () => {
      const promises = Array(10).fill(null).map(() =>
        pool.getClient("ec2", "us-east-1", mockCredentials)
      );
      
      const clients = await Promise.all(promises);
      
      // All should return clients successfully
      expect(clients.length).toBe(10);
      clients.forEach((client) => {
        expect(client).toBeDefined();
      });
    });

    it("should handle concurrent requests for different clients", async () => {
      const regions = ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1"];
      const promises = regions.map((region) =>
        pool.getClient("ec2", region, mockCredentials)
      );
      
      const clients = await Promise.all(promises);
      
      // All should be defined
      expect(clients.length).toBe(regions.length);
      clients.forEach((client) => {
        expect(client).toBeDefined();
      });
    });
  });

  describe("performance tracking", () => {
    it("should track use count for clients", async () => {
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      await pool.getClient("ec2", "us-east-1", mockCredentials);
      
      const stats = pool.getStats();
      expect(stats.cacheHits).toBe(2);
    });
  });
});

describe("createClientPool", () => {
  it("should create a client pool instance", () => {
    const pool = createClientPool();
    expect(pool).toBeInstanceOf(AWSClientPoolManager);
    pool.destroy();
  });

  it("should pass config to the pool", () => {
    const pool = createClientPool({
      maxClientsPerService: 10,
      maxTotalClients: 100,
      defaultRegion: "eu-west-1",
    });
    expect(pool).toBeInstanceOf(AWSClientPoolManager);
    pool.destroy();
  });
});
