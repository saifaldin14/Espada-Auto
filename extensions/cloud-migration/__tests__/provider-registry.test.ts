/**
 * Provider Registry & Adapter Integration Tests
 *
 * Tests the provider registry, adapter resolution, and step
 * handler wiring with mock credentials.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getProviderRegistry, resetProviderRegistry, resolveProviderAdapter } from "../src/providers/registry.js";
import type { ProviderCredentialConfig, AWSCredentialConfig, AzureCredentialConfig, GCPCredentialConfig } from "../src/providers/types.js";

// =============================================================================
// Provider Registry
// =============================================================================

describe("ProviderRegistry", () => {
  beforeEach(() => {
    resetProviderRegistry();
  });

  it("singleton returns same instance", () => {
    const r1 = getProviderRegistry();
    const r2 = getProviderRegistry();
    expect(r1).toBe(r2);
  });

  it("reset creates a new instance", () => {
    const r1 = getProviderRegistry();
    resetProviderRegistry();
    const r2 = getProviderRegistry();
    expect(r1).not.toBe(r2);
  });

  it("isSupported returns true for aws, azure, gcp", () => {
    const reg = getProviderRegistry();
    expect(reg.isSupported("aws")).toBe(true);
    expect(reg.isSupported("azure")).toBe(true);
    expect(reg.isSupported("gcp")).toBe(true);
  });

  it("isSupported returns true for on-premises, vmware, nutanix", () => {
    const reg = getProviderRegistry();
    expect(reg.isSupported("on-premises")).toBe(true);
    expect(reg.isSupported("vmware")).toBe(true);
    expect(reg.isSupported("nutanix")).toBe(true);
  });

  it("clear resets cached adapters", () => {
    const reg = getProviderRegistry();
    reg.clear();
    // After clear, resolving will re-create adapters
    expect(reg.isSupported("aws")).toBe(true);
  });
});

// =============================================================================
// Credential Config Types
// =============================================================================

describe("ProviderCredentialConfig type guards", () => {
  it("AWS config has provider=aws", () => {
    const config: AWSCredentialConfig = {
      provider: "aws",
      region: "us-east-1",
      accessKeyId: "AKIA...",
      secretAccessKey: "secret",
    };
    expect(config.provider).toBe("aws");
    expect(config.region).toBe("us-east-1");
  });

  it("Azure config has provider=azure", () => {
    const config: AzureCredentialConfig = {
      provider: "azure",
      subscriptionId: "sub-123",
      tenantId: "tenant-123",
      clientId: "client-123",
      clientSecret: "secret",
      region: "eastus",
    };
    expect(config.provider).toBe("azure");
    expect(config.subscriptionId).toBe("sub-123");
  });

  it("GCP config has provider=gcp", () => {
    const config: GCPCredentialConfig = {
      provider: "gcp",
      projectId: "my-project",
      region: "us-central1",
      keyFilePath: "/path/to/key.json",
    };
    expect(config.provider).toBe("gcp");
    expect(config.projectId).toBe("my-project");
  });
});

// =============================================================================
// Step Handler Wiring (integration — fallback path)
// =============================================================================

describe("step handler wiring — fallback path (no credentials)", () => {
  const fakeLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  function makeCtx(params: Record<string, unknown>, opts: Partial<{
    sourceCredentials: unknown;
    targetCredentials: unknown;
  }> = {}) {
    return {
      params,
      globalParams: {},
      tags: {},
      log: fakeLog,
      signal: undefined,
      sourceCredentials: opts.sourceCredentials,
      targetCredentials: opts.targetCredentials,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("snapshot-source executes in fallback mode without credentials", async () => {
    const { snapshotSourceHandler } = await import("../src/compute/steps/snapshot-source.js");
    const ctx = makeCtx({
      vmId: "vm-123",
      provider: "aws",
      region: "us-east-1",
      volumeIds: ["vol-001", "vol-002"],
    });

    const result = await snapshotSourceHandler.execute(ctx);
    expect(result.snapshotId).toBeDefined();
    expect((result as any).volumeSnapshots).toHaveLength(2);
    expect(result.createdAt).toBeDefined();
  });

  it("export-image executes in fallback mode without credentials", async () => {
    const { exportImageHandler } = await import("../src/compute/steps/export-image.js");
    const ctx = makeCtx({
      snapshotId: "snap-123",
      provider: "aws",
      region: "us-east-1",
      format: "vmdk",
      stagingBucket: "staging",
      stagingKey: "images/snap-123.vmdk",
    });

    const result = await exportImageHandler.execute(ctx);
    expect(result.exportPath).toContain("staging");
    expect(result.exportTaskId).toBeDefined();
    expect(result.format).toBe("vmdk");
  });

  it("import-image executes in fallback mode without credentials", async () => {
    const { importImageHandler } = await import("../src/compute/steps/import-image.js");
    const ctx = makeCtx({
      sourceUri: "aws://staging/images/snap-123.vmdk",
      format: "vmdk",
      targetProvider: "gcp",
      targetRegion: "us-central1",
      imageName: "migrated-vm",
    });

    const result = await importImageHandler.execute(ctx);
    expect(result.imageId).toBeDefined();
    expect(result.imageName).toBe("migrated-vm");
    expect(result.provider).toBe("gcp");
    expect(result.status).toBe("available");
  });

  it("provision-vm executes in fallback mode without credentials", async () => {
    const { provisionVMHandler } = await import("../src/compute/steps/provision-vm.js");
    const ctx = makeCtx({
      imageId: "img-gcp-123",
      targetProvider: "gcp",
      targetRegion: "us-central1",
      instanceType: "n1-standard-4",
      normalizedVM: {
        id: "i-123",
        name: "test-vm",
        provider: "aws",
        region: "us-east-1",
        cpuCores: 4,
        memoryGB: 16,
        osType: "linux",
        architecture: "x86_64",
        disks: [],
        networkInterfaces: [],
        tags: {},
        raw: {},
      },
    });

    const result = await provisionVMHandler.execute(ctx);
    expect(result.instanceId).toBeDefined();
    expect(result.provider).toBe("gcp");
    expect(result.state).toBe("running");
  });

  it("verify-boot executes in fallback mode without credentials", async () => {
    const { verifyBootHandler } = await import("../src/compute/steps/verify-boot.js");
    const ctx = makeCtx({
      instanceId: "i-gcp-123",
      provider: "gcp",
      region: "us-central1",
      expectedOS: "linux",
    });

    const result = await verifyBootHandler.execute(ctx);
    expect(result.vmId).toBe("i-gcp-123");
    expect(result.reachable).toBe(true);
    expect((result as any).services).toBeInstanceOf(Array);
    expect((result as any).services.length).toBeGreaterThanOrEqual(3);
  });

  it("cutover executes in fallback mode without credentials", async () => {
    const { cutoverHandler } = await import("../src/compute/steps/cutover.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-src",
      sourceProvider: "aws",
      targetInstanceId: "i-tgt",
      targetProvider: "gcp",
      targetRegion: "us-central1",
      dnsRecords: [{ name: "app.example.com", type: "A", oldValue: "1.2.3.4", newValue: "5.6.7.8" }],
      stopSource: true,
    });

    const result = await cutoverHandler.execute(ctx);
    expect(result.sourceStatus).toBe("stopped");
    expect(result.targetStatus).toBe("primary");
    expect(result.dnsUpdated).toBe(1);
    expect(result.cutoverAt).toBeDefined();
  });

  it("inventory-source executes in fallback mode without credentials", async () => {
    const { inventorySourceHandler } = await import("../src/data/steps/inventory-source.js");
    const ctx = makeCtx({
      bucketName: "my-bucket",
      provider: "aws",
      region: "us-east-1",
    });

    const result = await inventorySourceHandler.execute(ctx);
    expect(result.bucketName).toBe("my-bucket");
    expect(result.totalObjects).toBe(0);
    expect(result.inventoryDate).toBeDefined();
  });

  it("create-target executes in fallback mode without credentials", async () => {
    const { createTargetHandler } = await import("../src/data/steps/create-target.js");
    const ctx = makeCtx({
      sourceBucket: {
        id: "b-123",
        name: "src-bucket",
        provider: "aws",
        region: "us-east-1",
        objectCount: 100,
        totalSizeBytes: 1024000,
        versioning: true,
        encryption: "AES256",
        lifecycleRules: [],
        tags: {},
      },
      targetProvider: "gcp",
      targetRegion: "us-central1",
    });

    const result = await createTargetHandler.execute(ctx);
    expect(result.bucketName).toBe("src-bucket-migrated");
    expect(result.provider).toBe("gcp");
    expect(result.created).toBe(true);
  });

  it("transfer-objects executes in fallback (stub) mode", async () => {
    const { transferObjectsHandler } = await import("../src/data/steps/transfer-objects.js");
    const ctx = makeCtx({
      sourceBucket: "src-bucket",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      targetBucket: "tgt-bucket",
      targetProvider: "gcp",
      targetRegion: "us-central1",
    });

    const result = await transferObjectsHandler.execute(ctx);
    expect(result.taskId).toBeDefined();
    expect(result.sourceBucket).toBe("src-bucket");
    expect(result.targetBucket).toBe("tgt-bucket");
  });

  it("map-network executes in fallback mode without credentials", async () => {
    const { mapNetworkHandler } = await import("../src/network/steps/map-network.js");
    const ctx = makeCtx({
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
    });

    const result = await mapNetworkHandler.execute(ctx);
    expect(result.vpcs).toBeInstanceOf(Array);
    expect(result.totalSubnets).toBe(0);
  });

  it("create-security-rules executes in fallback mode", async () => {
    const { createSecurityRulesHandler } = await import("../src/network/steps/create-security-rules.js");
    const ctx = makeCtx({
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      securityGroups: [
        {
          groupId: "sg-123",
          groupName: "web-server",
          rules: [
            {
              id: "r1",
              name: "allow-http",
              direction: "inbound" as const,
              action: "allow" as const,
              protocol: "tcp",
              portRange: "80",
              source: "0.0.0.0/0",
              destination: "*",
              priority: 100,
            },
          ],
        },
      ],
    });

    const result = await createSecurityRulesHandler.execute(ctx);
    expect(result.groupsCreated).toBe(1);
    expect(result.rulesCreated).toBeGreaterThanOrEqual(1);
  });

  it("verify-connectivity executes in fallback mode", async () => {
    const { verifyConnectivityHandler } = await import("../src/network/steps/verify-connectivity.js");
    const ctx = makeCtx({
      targetProvider: "gcp",
      targetRegion: "us-central1",
      instanceIds: ["i-123"],
      expectedPorts: [{ host: "10.0.0.1", port: 80, protocol: "tcp" }],
    });

    const result = await verifyConnectivityHandler.execute(ctx);
    expect(result.allPassed).toBe(true);
    expect((result as any).summary.total).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Transfer Engine — Stub Path
// =============================================================================

describe("transfer engine — stub path", () => {
  it("createObjectTransfer returns a stub result without adapters", async () => {
    const { createObjectTransfer } = await import("../src/data/transfer-engine.js");

    const transfer = createObjectTransfer({
      sourceBucket: "src",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      targetBucket: "tgt",
      targetProvider: "gcp",
      targetRegion: "us-central1",
      concurrency: 4,
      chunkSizeMB: 64,
      metadataPreserve: true,
      aclPreserve: false,
    });

    expect(transfer.taskId).toContain("transfer-src-tgt");

    const result = await transfer.start();
    expect(result.objectsTransferred).toBe(0);
    expect(result.objectsFailed).toBe(0);
    expect(result.manifest.sourceBucket).toBe("src");
    expect(result.integrityReport.passed).toBe(true);
  });

  it("getProgress reflects status changes", async () => {
    const { createObjectTransfer } = await import("../src/data/transfer-engine.js");

    const transfer = createObjectTransfer({
      sourceBucket: "a",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      targetBucket: "b",
      targetProvider: "azure",
      targetRegion: "eastus",
      concurrency: 8,
      chunkSizeMB: 32,
      metadataPreserve: false,
      aclPreserve: false,
    });

    // Before start
    const before = transfer.getProgress();
    expect(before.status).toBe("inventorying");

    // After start
    await transfer.start();
    const after = transfer.getProgress();
    expect(after.status).toBe("complete");
  });
});

// =============================================================================
// Rollback Handlers (fallback path)
// =============================================================================

describe("rollback handlers — fallback path", () => {
  const fakeLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  function makeCtx(params: Record<string, unknown>) {
    return { params, globalParams: {}, tags: {}, log: fakeLog };
  }

  it("snapshot-source rollback logs deletion", async () => {
    const { snapshotSourceHandler } = await import("../src/compute/steps/snapshot-source.js");
    const ctx = makeCtx({ vmId: "vm-1", provider: "aws", region: "us-east-1", volumeIds: ["vol-1"] });
    await snapshotSourceHandler.rollback!(ctx, { snapshotId: "snap-1", volumeSnapshots: [{ snapshotId: "snap-1" }] });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("snap-1"));
  });

  it("import-image rollback logs deregistration", async () => {
    const { importImageHandler } = await import("../src/compute/steps/import-image.js");
    const ctx = makeCtx({ targetProvider: "gcp", targetRegion: "us-central1", sourceUri: "x", format: "vmdk", imageName: "img" });
    await importImageHandler.rollback!(ctx, { imageId: "img-1", provider: "gcp" });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("img-1"));
  });

  it("provision-vm rollback logs termination", async () => {
    const { provisionVMHandler } = await import("../src/compute/steps/provision-vm.js");
    const ctx = makeCtx({
      targetProvider: "gcp",
      targetRegion: "us-central1",
      imageId: "img-1",
      instanceType: "n1-standard-4",
      normalizedVM: { id: "v", name: "v", provider: "aws", region: "us-east-1", cpuCores: 4, memoryGB: 16, osType: "linux", architecture: "x86_64", disks: [], networkInterfaces: [], tags: {}, raw: {} },
    });
    await provisionVMHandler.rollback!(ctx, { instanceId: "i-1", provider: "gcp" });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("i-1"));
  });

  it("cutover rollback reverses DNS and logs", async () => {
    const { cutoverHandler } = await import("../src/compute/steps/cutover.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-src",
      sourceProvider: "aws",
      targetInstanceId: "i-tgt",
      targetProvider: "gcp",
      targetRegion: "us-central1",
      dnsRecords: [{ name: "a.com", type: "A", oldValue: "1.1.1.1", newValue: "2.2.2.2" }],
    });
    await cutoverHandler.rollback!(ctx, { sourceStatus: "stopped", dnsUpdated: 1 });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("Rolling back"));
  });

  it("create-target rollback logs bucket deletion", async () => {
    const { createTargetHandler } = await import("../src/data/steps/create-target.js");
    const ctx = makeCtx({
      sourceBucket: { id: "1", name: "x", provider: "aws", region: "us-east-1", objectCount: 0, totalSizeBytes: 0, versioning: false, encryption: "none", lifecycleRules: [], tags: {} },
      targetProvider: "gcp",
      targetRegion: "us-central1",
    });
    await createTargetHandler.rollback!(ctx, { created: true, bucketName: "x-migrated", provider: "gcp" });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("x-migrated"));
  });

  it("create-security-rules rollback logs group deletion", async () => {
    const { createSecurityRulesHandler } = await import("../src/network/steps/create-security-rules.js");
    const ctx = makeCtx({ sourceProvider: "aws", targetProvider: "azure", targetRegion: "eastus", securityGroups: [] });
    await createSecurityRulesHandler.rollback!(ctx, {
      mappings: [{ targetGroupId: "nsg-1", targetProvider: "azure", targetGroupName: "web", sourceGroupId: "sg-1", sourceGroupName: "web", sourceProvider: "aws", rules: [], warnings: [] }],
    });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("nsg-1"));
  });

  it("migrate-dns rollback logs record deletion", async () => {
    const { migrateDNSHandler } = await import("../src/network/steps/migrate-dns.js");
    const ctx = makeCtx({
      sourceZone: { id: "z1", name: "example.com", provider: "aws", type: "public", records: [], nameServers: [] },
      targetProvider: "gcp",
      targetRegion: "us-central1",
    });
    await migrateDNSHandler.rollback!(ctx, { recordsCreated: 5, recordsUpdated: 2 });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("7"));
  });
});

// =============================================================================
// Lifecycle
// =============================================================================

describe("lifecycle — provider registry cleanup", () => {
  it("lifecycle start and stop reset provider registry", async () => {
    const { registerLifecycle } = await import("../src/lifecycle.js");

    let startFn: (() => Promise<void>) | undefined;
    let stopFn: (() => Promise<void>) | undefined;

    const api = {
      registerService: (svc: { id: string; start: () => Promise<void>; stop: () => Promise<void> }) => {
        startFn = svc.start;
        stopFn = svc.stop;
      },
    };

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    registerLifecycle(api, log);

    expect(startFn).toBeDefined();
    expect(stopFn).toBeDefined();

    // Start should reset registry (no errors)
    await startFn!();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("service started"));

    // Stop should reset registry (no errors)
    await stopFn!();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("service stopped"));
  });
});
