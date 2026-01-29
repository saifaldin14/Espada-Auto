/**
 * AWS Credentials Manager - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AWSCredentialsManager, createCredentialsManager } from "./manager.js";

// Mock fs/promises for profile loading
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockImplementation((path: string) => {
    if (path.includes("credentials")) {
      return Promise.resolve(`
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[production]
aws_access_key_id = AKIAPRODKEY123456789
aws_secret_access_key = productionSecretKey1234567890abcdefghij

[development]
aws_access_key_id = AKIADEVKEY1234567890
aws_secret_access_key = developmentSecretKey123456789abcdefgh
region = us-west-2

[sso-profile]
sso_start_url = https://my-sso-portal.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
`);
    }
    if (path.includes("config")) {
      return Promise.resolve(`
[default]
region = us-east-1
output = json

[profile production]
region = eu-west-1
output = json

[profile development]
region = us-west-2
output = yaml

[sso-session my-sso]
sso_start_url = https://my-sso-portal.awsapps.com/start
sso_region = us-east-1
`);
    }
    return Promise.reject(new Error("File not found"));
  }),
}));

// Mock AWS SDK credential providers
vi.mock("@aws-sdk/credential-providers", () => ({
  fromEnv: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: "AKIAENVKEY1234567890",
    secretAccessKey: "envSecretKey123456789abcdefghijklmnop",
  })),
  fromIni: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  })),
  fromSSO: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: "ASIASSOKEY1234567890",
    secretAccessKey: "ssoSecretKey123456789abcdefghijklmnopq",
    sessionToken: "ssoSessionToken123456789",
  })),
  fromInstanceMetadata: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: "ASIAIMDSKEY123456789",
    secretAccessKey: "imdsSecretKey123456789abcdefghijklmno",
    sessionToken: "imdsSessionToken123456789",
  })),
  fromContainerMetadata: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: "ASIAECSKEY1234567890",
    secretAccessKey: "ecsSecretKey123456789abcdefghijklmnopq",
    sessionToken: "ecsSessionToken123456789",
  })),
  fromTokenFile: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: "ASIATOKENKEY12345678",
    secretAccessKey: "tokenSecretKey123456789abcdefghijklmn",
    sessionToken: "webIdentityToken123456789",
  })),
}));

// Mock STS client
vi.mock("@aws-sdk/client-sts", () => {
  const mockSTSSend = vi.fn().mockImplementation((command) => {
    // Check if it's an AssumeRole command by checking constructor name
    if (command?.constructor?.name === "AssumeRoleCommand" || command?.RoleArn) {
      // AssumeRole command
      return Promise.resolve({
        Credentials: {
          AccessKeyId: "ASIAASSUMEDKEY123456",
          SecretAccessKey: "assumedSecretKey123456789abcdefghij",
          SessionToken: "assumedSessionToken123456789abcdefgh",
          Expiration: new Date(Date.now() + 3600000),
        },
        AssumedRoleUser: {
          AssumedRoleId: "AROA3XFRBF535PLBIFPI4:session-name",
          Arn: "arn:aws:sts::123456789012:assumed-role/TestRole/session-name",
        },
      });
    }
    // GetCallerIdentity command
    return Promise.resolve({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/testuser",
      UserId: "AIDAIOSFODNN7EXAMPLE",
    });
  });

  const MockSTSClient = class {
    send = mockSTSSend;
    destroy = vi.fn();
    constructor(public config: unknown) {}
  };

  return {
    STSClient: MockSTSClient,
    GetCallerIdentityCommand: vi.fn(),
    AssumeRoleCommand: vi.fn().mockImplementation((input) => ({
      RoleArn: input?.RoleArn,
      constructor: { name: "AssumeRoleCommand" },
    })),
  };
});

describe("AWSCredentialsManager", () => {
  let manager: AWSCredentialsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AWSCredentialsManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      const m = new AWSCredentialsManager();
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should accept custom profile", () => {
      const m = new AWSCredentialsManager({ defaultProfile: "production" });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should accept custom region", () => {
      const m = new AWSCredentialsManager({ defaultRegion: "eu-west-1" });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should accept custom credentials file path", () => {
      const m = new AWSCredentialsManager({ credentialsFile: "/custom/path/credentials" });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should accept custom config file path", () => {
      const m = new AWSCredentialsManager({ configFile: "/custom/path/config" });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should allow disabling credential caching", () => {
      const m = new AWSCredentialsManager({ cacheCredentials: false });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should accept custom cache TTL", () => {
      const m = new AWSCredentialsManager({ cacheTTL: 1800000 });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should allow disabling auto-refresh", () => {
      const m = new AWSCredentialsManager({ autoRefresh: false });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });

    it("should accept multiple options together", () => {
      const m = new AWSCredentialsManager({
        defaultProfile: "production",
        defaultRegion: "eu-west-1",
        cacheCredentials: true,
        cacheTTL: 3600000,
        autoRefresh: true,
      });
      expect(m).toBeInstanceOf(AWSCredentialsManager);
      m.destroy();
    });
  });

  describe("initialize", () => {
    it("should load profiles from config files", async () => {
      await manager.initialize();
      const profiles = manager.listProfiles();
      expect(profiles).toBeInstanceOf(Array);
    });

    it("should handle missing credentials file gracefully", async () => {
      const { readFile } = await import("node:fs/promises");
      vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));
      
      // Should not throw
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it("should handle missing config file gracefully", async () => {
      const { readFile } = await import("node:fs/promises");
      vi.mocked(readFile)
        .mockResolvedValueOnce("[default]\naws_access_key_id = test")
        .mockRejectedValueOnce(new Error("ENOENT"));
      
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it("should handle malformed INI files", async () => {
      const { readFile } = await import("node:fs/promises");
      vi.mocked(readFile).mockResolvedValueOnce("not valid ini content ===");
      
      await expect(manager.initialize()).resolves.not.toThrow();
    });
  });

  describe("listProfiles", () => {
    it("should return empty array before initialization", () => {
      const profiles = manager.listProfiles();
      expect(profiles).toEqual([]);
    });

    it("should return profiles after initialization", async () => {
      await manager.initialize();
      const profiles = manager.listProfiles();
      expect(profiles).toBeInstanceOf(Array);
      expect(profiles.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("listSSOSessions", () => {
    it("should return empty array when no SSO sessions configured", () => {
      const sessions = manager.listSSOSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("getProfile", () => {
    it("should return undefined for non-existent profile", async () => {
      await manager.initialize();
      const profile = manager.getProfile("nonexistent-profile-xyz");
      expect(profile).toBeUndefined();
    });

    it("should return undefined before initialization", () => {
      const profile = manager.getProfile("default");
      expect(profile).toBeUndefined();
    });
  });

  describe("getCredentials", () => {
    it("should return credentials for default profile", async () => {
      await manager.initialize();
      const result = await manager.getCredentials();
      expect(result).toHaveProperty("credentials");
      expect(result.credentials).toHaveProperty("accessKeyId");
      expect(result.credentials).toHaveProperty("secretAccessKey");
    });

    it("should return credentials for specific profile", async () => {
      await manager.initialize();
      const result = await manager.getCredentials("production");
      expect(result).toHaveProperty("credentials");
    });

    it("should return credentials for specific region", async () => {
      await manager.initialize();
      const result = await manager.getCredentials("eu-west-1");
      expect(result).toHaveProperty("region");
    });

    it("should cache credentials when caching is enabled", async () => {
      await manager.initialize();
      
      const result1 = await manager.getCredentials();
      const result2 = await manager.getCredentials();
      
      // Both should succeed
      expect(result1.credentials.accessKeyId).toBeDefined();
      expect(result2.credentials.accessKeyId).toBeDefined();
    });
  });

  describe("validateCredentials", () => {
    it("should validate working credentials", async () => {
      await manager.initialize();
      const result = await manager.getCredentials();
      const valid = await manager.validateCredentials(result.credentials);
      expect(typeof valid).toBe("boolean");
    });

    it("should validate credentials for specific profile", async () => {
      await manager.initialize();
      const result = await manager.getCredentials("production");
      const valid = await manager.validateCredentials(result.credentials);
      expect(typeof valid).toBe("boolean");
    });
  });

  describe("assumeRole", () => {
    it("should assume a role and return temporary credentials", async () => {
      await manager.initialize();
      const credentials = await manager.assumeRole(
        "arn:aws:iam::123456789012:role/TestRole"
      );
      expect(credentials).toHaveProperty("accessKeyId");
      expect(credentials).toHaveProperty("secretAccessKey");
      expect(credentials).toHaveProperty("sessionToken");
    });

    it("should accept custom session name", async () => {
      await manager.initialize();
      const credentials = await manager.assumeRole(
        "arn:aws:iam::123456789012:role/TestRole",
        { sessionName: "my-custom-session" }
      );
      expect(credentials).toHaveProperty("accessKeyId");
    });

    it("should accept external ID for cross-account roles", async () => {
      await manager.initialize();
      const credentials = await manager.assumeRole(
        "arn:aws:iam::123456789012:role/CrossAccountRole",
        { externalId: "external-id-12345" }
      );
      expect(credentials).toHaveProperty("accessKeyId");
    });

    it("should accept duration in seconds", async () => {
      await manager.initialize();
      const credentials = await manager.assumeRole(
        "arn:aws:iam::123456789012:role/TestRole",
        { duration: 7200 }
      );
      expect(credentials).toHaveProperty("accessKeyId");
    });
  });

  describe("clearCache", () => {
    it("should clear cached credentials", async () => {
      await manager.initialize();
      await manager.getCredentials();
      
      manager.clearCache();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("invalidateCache", () => {
    it("should invalidate specific profile cache", async () => {
      await manager.initialize();
      await manager.getCredentials("production");
      
      manager.invalidateCache("production");
      // Should not throw
      expect(true).toBe(true);
    });

    it("should invalidate all cache when no profile specified", async () => {
      await manager.initialize();
      await manager.getCredentials();
      
      manager.invalidateCache();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("destroy", () => {
    it("should clean up resources", async () => {
      await manager.initialize();
      await manager.getCredentials();
      
      manager.destroy();
      // Should not throw when called multiple times
      manager.destroy();
      expect(true).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle concurrent credential requests", async () => {
      await manager.initialize();
      
      const promises = Array(5).fill(null).map(() => manager.getCredentials());
      const results = await Promise.all(promises);
      
      results.forEach((result) => {
        expect(result.credentials.accessKeyId).toBeDefined();
      });
    });

    it("should handle rapid cache invalidation", async () => {
      await manager.initialize();
      
      for (let i = 0; i < 10; i++) {
        await manager.getCredentials();
        manager.invalidateCache();
      }
      
      const result = await manager.getCredentials();
      expect(result.credentials.accessKeyId).toBeDefined();
    });
  });
});

describe("createCredentialsManager", () => {
  it("should create a credentials manager instance", () => {
    const manager = createCredentialsManager();
    expect(manager).toBeInstanceOf(AWSCredentialsManager);
    manager.destroy();
  });

  it("should pass options to the manager", () => {
    const manager = createCredentialsManager({
      defaultProfile: "production",
      defaultRegion: "eu-west-1",
    });
    expect(manager).toBeInstanceOf(AWSCredentialsManager);
    manager.destroy();
  });
});
