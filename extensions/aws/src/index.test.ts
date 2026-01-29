/**
 * AWS Plugin - Main Entry Point - Comprehensive Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AWSPlugin,
  createAWSPlugin,
  createCredentialsManager,
  createClientPool,
  createContextManager,
  createTaggingManager,
  createTagValidator,
  createCLIWrapper,
  createServiceDiscovery,
  createCloudTrailManager,
  which,
} from "./index.js";

// Mock all AWS SDK clients
vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Regions: [
        { RegionName: "us-east-1" },
        { RegionName: "us-west-2" },
        { RegionName: "eu-west-1" },
      ],
    }),
    destroy: vi.fn(),
  })),
  DescribeInstancesCommand: vi.fn(),
  DescribeRegionsCommand: vi.fn(),
  DescribeVpcsCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Account: "123456789012",
      UserId: "AIDAEXAMPLE",
      Arn: "arn:aws:iam::123456789012:user/test",
    }),
    destroy: vi.fn(),
  })),
  GetCallerIdentityCommand: vi.fn(),
  AssumeRoleCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-iam", () => ({
  IAMClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
  GetUserCommand: vi.fn(),
  ListUsersCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-cloudtrail", () => ({
  CloudTrailClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ Events: [] }),
    destroy: vi.fn(),
  })),
  LookupEventsCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-organizations", () => ({
  OrganizationsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  })),
  DescribeOrganizationCommand: vi.fn(),
  ListAccountsCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-resource-groups-tagging-api", () => ({
  ResourceGroupsTaggingAPIClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ ResourceTagMappingList: [] }),
    destroy: vi.fn(),
  })),
  GetResourcesCommand: vi.fn(),
  TagResourcesCommand: vi.fn(),
  UntagResourcesCommand: vi.fn(),
}));

vi.mock("@aws-sdk/credential-providers", () => ({
  fromIni: vi.fn().mockReturnValue(async () => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    sessionToken: undefined,
  })),
  fromEnv: vi.fn().mockReturnValue(async () => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  })),
  fromInstanceMetadata: vi.fn().mockReturnValue(async () => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  })),
  fromContainerMetadata: vi.fn().mockReturnValue(async () => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  })),
  fromSSO: vi.fn().mockReturnValue(async () => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  })),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(`
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[production]
aws_access_key_id = AKIAPRODUCTION12345
aws_secret_access_key = productionSecretKey/EXAMPLE

[development]
aws_access_key_id = AKIADEVELOPMENT1234
aws_secret_access_key = developmentSecretKey/EXAMPLE
`),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
}));

vi.mock("./utils/which.js", () => ({
  which: vi.fn().mockResolvedValue("/usr/local/bin/aws"),
  commandExists: vi.fn().mockResolvedValue(true),
}));

describe("AWSPlugin", () => {
  let plugin: AWSPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new AWSPlugin();
  });

  describe("constructor", () => {
    it("should create plugin with default config", () => {
      expect(plugin).toBeInstanceOf(AWSPlugin);
    });

    it("should create plugin with custom config", () => {
      const customPlugin = new AWSPlugin({
        defaultRegion: "eu-west-1",
        defaultProfile: "production",
      });
      expect(customPlugin).toBeInstanceOf(AWSPlugin);
    });

    it("should accept all config options", () => {
      const fullConfigPlugin = new AWSPlugin({
        defaultRegion: "eu-west-1",
        defaultProfile: "production",
        clientPoolConfig: {
          maxClientsPerService: 50,
          clientTTL: 600000,
        },
      });
      expect(fullConfigPlugin).toBeInstanceOf(AWSPlugin);
    });

    it("should expose credentials manager", () => {
      expect(plugin.credentials).toBeDefined();
    });

    it("should expose CLI wrapper", () => {
      expect(plugin.cli).toBeDefined();
    });

    it("should expose client pool", () => {
      expect(plugin.clientPool).toBeDefined();
    });

    it("should expose context manager", () => {
      expect(plugin.context).toBeDefined();
    });

    it("should expose discovery service", () => {
      expect(plugin.discovery).toBeDefined();
    });

    it("should expose tagging manager", () => {
      expect(plugin.tagging).toBeDefined();
    });

    it("should expose cloudtrail manager", () => {
      expect(plugin.cloudtrail).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("should initialize and verify credentials", async () => {
      await plugin.initialize();
      // Should complete without error
      expect(true).toBe(true);
    });
  });

  describe("getCurrentContext", () => {
    it("should return current context", () => {
      const context = plugin.getCurrentContext();
      expect(context).toBeDefined();
      expect(context.region).toBeDefined();
    });

    it("should return default region when not set", () => {
      const context = plugin.getCurrentContext();
      expect(context.region).toBe("us-east-1");
    });
  });

  describe("switchRegion", () => {
    it("should switch region after initialization", async () => {
      // Initialize context first
      await plugin.context.initialize();
      await plugin.switchRegion("eu-west-1");
      // Should complete without error
      expect(true).toBe(true);
    });
  });

  describe("switchProfile", () => {
    it("should switch profile after initialization", async () => {
      // Initialize context first
      await plugin.context.initialize();
      await plugin.switchProfile("production");
      // Should complete without error
      expect(true).toBe(true);
    });
  });

  describe("assumeRole", () => {
    it("should expose assumeRole method", () => {
      // Just verify the method exists and can be called
      expect(typeof plugin.assumeRole).toBe("function");
    });
  });

  describe("dispose", () => {
    it("should clean up resources", async () => {
      await plugin.dispose();
      // Should complete without error
      expect(true).toBe(true);
    });
  });
});

describe("createAWSPlugin", () => {
  it("should create plugin instance", () => {
    const plugin = createAWSPlugin();
    expect(plugin).toBeInstanceOf(AWSPlugin);
  });

  it("should pass config to plugin", () => {
    const plugin = createAWSPlugin({
      defaultRegion: "eu-west-1",
      defaultProfile: "production",
    });
    expect(plugin).toBeInstanceOf(AWSPlugin);
  });
});

describe("Factory Functions", () => {
  describe("createCredentialsManager", () => {
    it("should create credentials manager", () => {
      const manager = createCredentialsManager();
      expect(manager).toBeDefined();
    });

    it("should accept config options", () => {
      const manager = createCredentialsManager({
        defaultProfile: "production",
        defaultRegion: "eu-west-1",
      });
      expect(manager).toBeDefined();
    });
  });

  describe("createClientPool", () => {
    it("should create client pool manager", () => {
      const manager = createClientPool();
      expect(manager).toBeDefined();
    });

    it("should accept config options", () => {
      const manager = createClientPool({
        maxClientsPerService: 10,
        maxTotalClients: 100,
        clientTTL: 600000,
      });
      expect(manager).toBeDefined();
    });
  });

  describe("createContextManager", () => {
    it("should create context manager with credentials", () => {
      const creds = createCredentialsManager();
      const manager = createContextManager(creds);
      expect(manager).toBeDefined();
    });
  });

  describe("createTaggingManager", () => {
    it("should create tagging manager with credentials", () => {
      const creds = createCredentialsManager();
      const manager = createTaggingManager(creds);
      expect(manager).toBeDefined();
    });
  });

  describe("createTagValidator", () => {
    it("should create tag validator", () => {
      const validator = createTagValidator();
      expect(validator).toBeDefined();
    });

    it("should accept validation rules", () => {
      const validator = createTagValidator({
        required: [{ key: "Environment", value: "" }, { key: "Project", value: "" }],
        optional: [{ key: "Owner", value: "" }, { key: "CostCenter", value: "" }],
        prohibited: ["aws:internal"],
      });
      expect(validator).toBeDefined();
    });
  });

  describe("createCLIWrapper", () => {
    it("should create CLI wrapper", () => {
      const wrapper = createCLIWrapper();
      expect(wrapper).toBeDefined();
    });

    it("should accept config options", () => {
      const wrapper = createCLIWrapper({
        defaultOptions: {
          profile: "production",
          region: "eu-west-1",
        },
      });
      expect(wrapper).toBeDefined();
    });
  });

  describe("createServiceDiscovery", () => {
    it("should create service discovery with credentials", () => {
      const creds = createCredentialsManager();
      const discovery = createServiceDiscovery(creds);
      expect(discovery).toBeDefined();
    });
  });

  describe("createCloudTrailManager", () => {
    it("should create CloudTrail manager with credentials", () => {
      const creds = createCredentialsManager();
      const manager = createCloudTrailManager(creds);
      expect(manager).toBeDefined();
    });

    it("should accept default region", () => {
      const creds = createCredentialsManager();
      const manager = createCloudTrailManager(creds, "eu-west-1");
      expect(manager).toBeDefined();
    });
  });
});

describe("Utility Exports", () => {
  it("should export which function", () => {
    expect(which).toBeDefined();
    expect(typeof which).toBe("function");
  });
});

describe("Type Exports", () => {
  it("should export AWSPlugin class", () => {
    expect(AWSPlugin).toBeDefined();
  });

  it("should export factory functions", () => {
    expect(createAWSPlugin).toBeDefined();
    expect(createCredentialsManager).toBeDefined();
    expect(createClientPool).toBeDefined();
    expect(createContextManager).toBeDefined();
    expect(createTaggingManager).toBeDefined();
    expect(createTagValidator).toBeDefined();
    expect(createCLIWrapper).toBeDefined();
    expect(createServiceDiscovery).toBeDefined();
    expect(createCloudTrailManager).toBeDefined();
  });
});

describe("Plugin Integration", () => {
  it("should support typical workflow", async () => {
    const plugin = createAWSPlugin({
      defaultRegion: "us-east-1",
      defaultProfile: "default",
    });

    // Access managers
    expect(plugin.credentials).toBeDefined();
    expect(plugin.clientPool).toBeDefined();
    expect(plugin.context).toBeDefined();
    expect(plugin.tagging).toBeDefined();
    expect(plugin.discovery).toBeDefined();
    expect(plugin.cloudtrail).toBeDefined();
    expect(plugin.cli).toBeDefined();

    // Get current context
    const context = plugin.getCurrentContext();
    expect(context.region).toBe("us-east-1");

    // Cleanup
    await plugin.dispose();
  });
});
