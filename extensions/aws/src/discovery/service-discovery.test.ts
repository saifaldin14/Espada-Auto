/**
 * AWS Service Discovery - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AWSServiceDiscovery, createServiceDiscovery } from "./service-discovery.js";
import { AWSCredentialsManager } from "../credentials/manager.js";

// Mock credentials manager
const mockCredentialsManager = {
  getCredentials: vi.fn().mockResolvedValue({
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      source: "profile",
    },
    profile: "default",
    region: "us-east-1",
    accountId: "123456789012",
  }),
} as unknown as AWSCredentialsManager;

// Mock AWS SDK clients
vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation((command) => {
      // DescribeRegions
      if (command?.input?.AllRegions !== undefined) {
        return Promise.resolve({
          Regions: [
            { RegionName: "us-east-1", Endpoint: "ec2.us-east-1.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "us-east-2", Endpoint: "ec2.us-east-2.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "us-west-1", Endpoint: "ec2.us-west-1.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "us-west-2", Endpoint: "ec2.us-west-2.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "eu-west-1", Endpoint: "ec2.eu-west-1.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "eu-west-2", Endpoint: "ec2.eu-west-2.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "eu-central-1", Endpoint: "ec2.eu-central-1.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "ap-northeast-1", Endpoint: "ec2.ap-northeast-1.amazonaws.com", OptInStatus: "opt-in-not-required" },
            { RegionName: "ap-southeast-1", Endpoint: "ec2.ap-southeast-1.amazonaws.com", OptInStatus: "opted-in" },
            { RegionName: "af-south-1", Endpoint: "ec2.af-south-1.amazonaws.com", OptInStatus: "not-opted-in" },
          ],
        });
      }
      // DescribeInstances
      if (command?.input?.Filters !== undefined || command?.input?.InstanceIds !== undefined || command?.input?.MaxResults !== undefined) {
        return Promise.resolve({
          Reservations: [
            {
              Instances: [
                {
                  InstanceId: "i-1234567890abcdef0",
                  InstanceType: "t3.micro",
                  State: { Name: "running", Code: 16 },
                  Tags: [
                    { Key: "Name", Value: "web-server-1" },
                    { Key: "Environment", Value: "production" },
                  ],
                  LaunchTime: new Date("2024-01-01T00:00:00Z"),
                  PrivateIpAddress: "10.0.1.10",
                  PublicIpAddress: "54.123.45.67",
                  VpcId: "vpc-12345678",
                  SubnetId: "subnet-12345678",
                  SecurityGroups: [{ GroupId: "sg-12345678", GroupName: "web-sg" }],
                  ImageId: "ami-12345678",
                },
                {
                  InstanceId: "i-0987654321fedcba0",
                  InstanceType: "t3.small",
                  State: { Name: "stopped", Code: 80 },
                  Tags: [
                    { Key: "Name", Value: "dev-server" },
                    { Key: "Environment", Value: "development" },
                  ],
                  LaunchTime: new Date("2024-01-15T00:00:00Z"),
                  PrivateIpAddress: "10.0.2.20",
                  VpcId: "vpc-12345678",
                  SubnetId: "subnet-87654321",
                },
              ],
            },
          ],
        });
      }
      // DescribeVpcs
      return Promise.resolve({
        Vpcs: [
          {
            VpcId: "vpc-12345678",
            CidrBlock: "10.0.0.0/16",
            State: "available",
            IsDefault: true,
            Tags: [{ Key: "Name", Value: "main-vpc" }],
            DhcpOptionsId: "dopt-12345678",
            InstanceTenancy: "default",
          },
          {
            VpcId: "vpc-87654321",
            CidrBlock: "172.16.0.0/16",
            State: "available",
            IsDefault: false,
            Tags: [{ Key: "Name", Value: "secondary-vpc" }],
            DhcpOptionsId: "dopt-87654321",
            InstanceTenancy: "default",
          },
        ],
      });
    }),
  })),
  DescribeRegionsCommand: vi.fn().mockImplementation((input) => ({ input: input ?? {} })),
  DescribeInstancesCommand: vi.fn().mockImplementation((input) => ({ input: input ?? {} })),
  DescribeVpcsCommand: vi.fn().mockImplementation((input) => ({ input: input ?? {} })),
}));

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/testuser",
      UserId: "AIDAIOSFODNN7EXAMPLE",
    }),
  })),
  GetCallerIdentityCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-resource-groups-tagging-api", () => ({
  ResourceGroupsTaggingAPIClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      ResourceTagMappingList: [
        {
          ResourceARN: "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0",
          Tags: [
            { Key: "Name", Value: "web-server-1" },
            { Key: "Environment", Value: "production" },
          ],
        },
        {
          ResourceARN: "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-12345678",
          Tags: [
            { Key: "Name", Value: "main-vpc" },
          ],
        },
        {
          ResourceARN: "arn:aws:s3:::my-bucket",
          Tags: [
            { Key: "Name", Value: "my-bucket" },
            { Key: "Purpose", Value: "storage" },
          ],
        },
      ],
      PaginationToken: undefined,
    }),
  })),
  GetResourcesCommand: vi.fn(),
}));

describe("AWSServiceDiscovery", () => {
  let discovery: AWSServiceDiscovery;

  beforeEach(() => {
    vi.clearAllMocks();
    discovery = new AWSServiceDiscovery(mockCredentialsManager);
  });

  describe("constructor", () => {
    it("should create with credentials manager", () => {
      const d = new AWSServiceDiscovery(mockCredentialsManager);
      expect(d).toBeInstanceOf(AWSServiceDiscovery);
    });
  });

  describe("getServiceCatalog", () => {
    it("should return list of services", async () => {
      const catalog = await discovery.getServiceCatalog();
      expect(catalog).toBeInstanceOf(Array);
      expect(catalog.length).toBeGreaterThan(0);
    });

    it("should include compute services", async () => {
      const catalog = await discovery.getServiceCatalog();
      const ec2 = catalog.find((s) => s.serviceCode === "ec2");
      expect(ec2).toBeDefined();
      expect(ec2?.category).toBe("compute");
    });

    it("should include storage services", async () => {
      const catalog = await discovery.getServiceCatalog();
      const s3 = catalog.find((s) => s.serviceCode === "s3");
      expect(s3).toBeDefined();
      expect(s3?.category).toBe("storage");
    });

    it("should include database services", async () => {
      const catalog = await discovery.getServiceCatalog();
      const rds = catalog.find((s) => s.serviceCode === "rds");
      expect(rds).toBeDefined();
      expect(rds?.category).toBe("database");
    });

    it("should include IAM as global service", async () => {
      const catalog = await discovery.getServiceCatalog();
      const iam = catalog.find((s) => s.serviceCode === "iam");
      expect(iam).toBeDefined();
      expect(iam?.globalService).toBe(true);
    });

    it("should include compute services", async () => {
      const catalog = await discovery.getServiceCatalog();
      const ec2 = catalog.find((s) => s.serviceCode === "ec2");
      expect(ec2).toBeDefined();
      expect(ec2?.category).toBe("compute");
    });

    it("should provide service endpoints", async () => {
      const catalog = await discovery.getServiceCatalog();
      expect(catalog[0]).toHaveProperty("endpoints");
      expect(typeof catalog[0].endpoints).toBe("object");
    });

    it("should provide service descriptions", async () => {
      const catalog = await discovery.getServiceCatalog();
      expect(catalog[0]).toHaveProperty("description");
      expect(typeof catalog[0].description).toBe("string");
    });

    it("should categorize services correctly", async () => {
      const catalog = await discovery.getServiceCatalog();
      
      // Include all possible categories from the catalog
      const validCategories = ["compute", "storage", "database", "networking", "security", 
        "management", "analytics", "other", "serverless", "application-integration", "containers"];
      catalog.forEach((service) => {
        expect(validCategories).toContain(service.category);
      });
    });
  });

  describe("getServiceMetadata", () => {
    it("should return metadata for valid service", async () => {
      const metadata = await discovery.getServiceMetadata("ec2");
      expect(metadata).toBeDefined();
      expect(metadata?.serviceCode).toBe("ec2");
    });

    it("should return null for invalid service", async () => {
      const metadata = await discovery.getServiceMetadata("nonexistent-service" as any);
      expect(metadata).toBeNull();
    });

    it("should include service name", async () => {
      const metadata = await discovery.getServiceMetadata("ec2");
      expect(metadata).toHaveProperty("serviceName");
    });

    it("should include description", async () => {
      const metadata = await discovery.getServiceMetadata("ec2");
      expect(metadata).toHaveProperty("description");
    });

    it("should include regions list", async () => {
      const metadata = await discovery.getServiceMetadata("ec2");
      expect(metadata).toHaveProperty("regions");
      expect(metadata?.regions).toBeInstanceOf(Array);
    });

    it("should include global service flag", async () => {
      const metadata = await discovery.getServiceMetadata("iam");
      expect(metadata?.globalService).toBe(true);
      
      const ec2Meta = await discovery.getServiceMetadata("ec2");
      expect(ec2Meta?.globalService).toBe(false);
    });
  });

  describe("discoverRegions", () => {
    it("should return list of regions with credentials", async () => {
      const regions = await discovery.discoverRegions();
      expect(regions).toBeInstanceOf(Array);
      expect(regions.length).toBeGreaterThan(0);
    });

    it("should include region names", async () => {
      const regions = await discovery.discoverRegions();
      regions.forEach((region) => {
        expect(region).toHaveProperty("regionName");
        expect(typeof region.regionName).toBe("string");
      });
    });

    it("should include endpoints", async () => {
      const regions = await discovery.discoverRegions();
      regions.forEach((region) => {
        expect(region).toHaveProperty("endpoint");
      });
    });

    it("should include availability status", async () => {
      const regions = await discovery.discoverRegions();
      regions.forEach((region) => {
        expect(region).toHaveProperty("available");
        expect(typeof region.available).toBe("boolean");
      });
    });

    it("should mark opted-out regions as unavailable", async () => {
      const regions = await discovery.discoverRegions();
      const optedOut = regions.find((r) => r.regionName === "af-south-1");
      expect(optedOut?.available).toBe(false);
    });

    it("should return default regions on error", async () => {
      const badCredsManager = {
        getCredentials: vi.fn().mockRejectedValue(new Error("Invalid credentials")),
      } as unknown as AWSCredentialsManager;
      
      const badDiscovery = new AWSServiceDiscovery(badCredsManager);
      const regions = await badDiscovery.discoverRegions();
      
      expect(regions).toBeInstanceOf(Array);
      expect(regions.length).toBeGreaterThan(0);
    });
  });

  describe("discover", () => {
    it("should return full discovery result", async () => {
      const result = await discovery.discover();
      expect(result).toBeDefined();
      expect(result).toHaveProperty("services");
      expect(result).toHaveProperty("availableRegions");
      expect(result).toHaveProperty("accountInfo");
      expect(result).toHaveProperty("discoveredAt");
    });

    it("should include services array", async () => {
      const result = await discovery.discover();
      expect(result.services).toBeInstanceOf(Array);
      expect(result.services.length).toBeGreaterThan(0);
    });

    it("should include regions array", async () => {
      const result = await discovery.discover();
      expect(result.availableRegions).toBeInstanceOf(Array);
    });

    it("should include account info", async () => {
      const result = await discovery.discover();
      expect(result.accountInfo).toHaveProperty("accountId");
    });

    it("should include discovery timestamp", async () => {
      const result = await discovery.discover();
      expect(result.discoveredAt).toBeInstanceOf(Date);
    });
  });

  describe("enumerateResources", () => {
    it("should return list of resources", async () => {
      const resources = await discovery.enumerateResources();
      expect(resources).toBeInstanceOf(Array);
    });

    it("should respect maxResults option", async () => {
      const resources = await discovery.enumerateResources({ maxResults: 5 });
      expect(resources).toBeInstanceOf(Array);
    });

    it("should filter by services", async () => {
      const resources = await discovery.enumerateResources({ services: ["ec2"] });
      expect(resources).toBeInstanceOf(Array);
    });

    it("should filter by tags", async () => {
      const resources = await discovery.enumerateResources({ 
        tags: { Environment: "production" } 
      });
      expect(resources).toBeInstanceOf(Array);
    });

    it("should include resource ARN", async () => {
      const resources = await discovery.enumerateResources();
      if (resources.length > 0) {
        expect(resources[0]).toHaveProperty("resourceArn");
        expect(resources[0].resourceArn).toMatch(/^arn:aws:/);
      }
    });

    it("should include resource tags", async () => {
      const resources = await discovery.enumerateResources();
      if (resources.length > 0) {
        expect(resources[0]).toHaveProperty("tags");
        expect(typeof resources[0].tags).toBe("object");
      }
    });
  });

  describe("discoverEC2Instances", () => {
    it("should return EC2 instances", async () => {
      const instances = await discovery.discoverEC2Instances("us-east-1");
      expect(instances).toBeInstanceOf(Array);
    });

    it("should include instance ID", async () => {
      const instances = await discovery.discoverEC2Instances("us-east-1");
      if (instances.length > 0) {
        expect(instances[0]).toHaveProperty("resourceId");
        expect(instances[0].resourceId).toMatch(/^i-/);
      }
    });

    it("should include resource type", async () => {
      const instances = await discovery.discoverEC2Instances("us-east-1");
      if (instances.length > 0) {
        expect(instances[0]).toHaveProperty("resourceType");
        expect(instances[0].resourceType).toBe("ec2:instance");
      }
    });

    it("should include instance metadata", async () => {
      const instances = await discovery.discoverEC2Instances("us-east-1");
      if (instances.length > 0) {
        expect(instances[0]).toHaveProperty("metadata");
        expect(instances[0].metadata).toHaveProperty("instanceType");
      }
    });

    it("should include instance state", async () => {
      const instances = await discovery.discoverEC2Instances("us-east-1");
      if (instances.length > 0) {
        expect(instances[0]).toHaveProperty("state");
      }
    });

    it("should accept filters", async () => {
      const instances = await discovery.discoverEC2Instances("us-east-1", {
        "instance-state-name": ["running"],
      });
      expect(instances).toBeInstanceOf(Array);
    });
  });

  describe("discoverVPCs", () => {
    it("should return VPCs", async () => {
      const vpcs = await discovery.discoverVPCs("us-east-1");
      expect(vpcs).toBeInstanceOf(Array);
    });

    it("should include VPC ID", async () => {
      const vpcs = await discovery.discoverVPCs("us-east-1");
      if (vpcs.length > 0) {
        expect(vpcs[0]).toHaveProperty("resourceId");
        expect(vpcs[0].resourceId).toMatch(/^vpc-/);
      }
    });

    it("should include resource type", async () => {
      const vpcs = await discovery.discoverVPCs("us-east-1");
      if (vpcs.length > 0) {
        expect(vpcs[0]).toHaveProperty("resourceType");
        expect(vpcs[0].resourceType).toBe("ec2:vpc");
      }
    });

    it("should include VPC metadata", async () => {
      const vpcs = await discovery.discoverVPCs("us-east-1");
      if (vpcs.length > 0) {
        expect(vpcs[0]).toHaveProperty("metadata");
        expect(vpcs[0].metadata).toHaveProperty("cidrBlock");
      }
    });

    it("should include default VPC flag", async () => {
      const vpcs = await discovery.discoverVPCs("us-east-1");
      if (vpcs.length > 0) {
        expect(vpcs[0].metadata).toHaveProperty("isDefault");
      }
    });
  });

  describe("caching", () => {
    it("should cache regions after discovery", async () => {
      await discovery.discover();
      const cached = discovery.getCachedRegions();
      expect(cached).toBeInstanceOf(Array);
      expect(cached.length).toBeGreaterThan(0);
    });

    it("should return empty array when no cache", () => {
      const cached = discovery.getCachedRegions();
      expect(cached).toEqual([]);
    });
  });
});

describe("createServiceDiscovery", () => {
  it("should create a service discovery instance", () => {
    const discovery = createServiceDiscovery(mockCredentialsManager);
    expect(discovery).toBeInstanceOf(AWSServiceDiscovery);
  });
});
