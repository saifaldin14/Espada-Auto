/**
 * New Step Handlers — Tests
 *
 * Tests the three step handlers added in the second implementation round:
 *   1. remediate-boot     — injects cloud-specific drivers/agents post-import
 *   2. decommission-source — post-cutover cleanup of source resources
 *   3. approval-gate       — governance checkpoint with polling
 *
 * All handlers are tested in fallback/stub mode (no real cloud credentials).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =============================================================================
// Helpers
// =============================================================================

const fakeLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeCtx(
  params: Record<string, unknown>,
  opts: Partial<{
    sourceCredentials: unknown;
    targetCredentials: unknown;
    signal: AbortSignal;
    tags: Record<string, string>;
  }> = {},
) {
  return {
    params,
    globalParams: {},
    tags: opts.tags ?? {},
    log: fakeLog,
    signal: opts.signal,
    sourceCredentials: opts.sourceCredentials,
    targetCredentials: opts.targetCredentials,
  };
}

// =============================================================================
// remediate-boot
// =============================================================================

describe("compute/steps/remediate-boot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AWS-specific remediations for Linux in fallback mode", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const ctx = makeCtx({
      diskId: "ami-abc123",
      targetProvider: "aws",
      osType: "linux",
      sourceProvider: "azure",
    });

    const result = await remediateBootHandler.execute(ctx);

    expect(result.diskId).toBe("ami-abc123");
    expect(result.targetProvider).toBe("aws");
    expect(result.osType).toBe("linux");
    expect(result.dryRun).toBe(false);
    expect(Array.isArray(result.remediations)).toBe(true);

    const remeds = result.remediations as Array<{ name: string; category: string; action: string; status: string }>;
    expect(remeds.length).toBeGreaterThan(0);

    // Should include ENA driver, NVMe driver, cloud-init, SSM agent
    const names = remeds.map((r) => r.name);
    expect(names).toContain("ena-driver");
    expect(names).toContain("nvme-driver");
    expect(names).toContain("cloud-init");
    expect(names).toContain("ssm-agent");

    // Should remove Azure walinuxagent since source was Azure
    expect(names).toContain("walinuxagent");
    const waRemoval = remeds.find((r) => r.name === "walinuxagent");
    expect(waRemoval?.action).toBe("remove");

    // All should be "applied" in fallback mode (not dry-run)
    expect(remeds.every((r) => r.status === "applied")).toBe(true);
    expect(result.remediationCount).toBe(remeds.length);
    expect(result.failedCount).toBe(0);
    expect(typeof result.elapsedMs).toBe("number");
  });

  it("returns Azure-specific remediations for Linux", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const ctx = makeCtx({
      diskId: "disk-xyz",
      targetProvider: "azure",
      osType: "linux",
      sourceProvider: "gcp",
    });

    const result = await remediateBootHandler.execute(ctx);

    const remeds = result.remediations as Array<{ name: string; action: string }>;
    const names = remeds.map((r) => r.name);
    expect(names).toContain("hyperv-drivers");
    expect(names).toContain("walinuxagent");
    // Should remove GCP guest agent since source was GCP
    expect(names).toContain("google-guest-agent");
    const gcpRemoval = remeds.find((r) => r.name === "google-guest-agent");
    expect(gcpRemoval?.action).toBe("remove");
  });

  it("returns GCP-specific remediations for Linux", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const ctx = makeCtx({
      diskId: "disk-001",
      targetProvider: "gcp",
      osType: "linux",
      sourceProvider: "aws",
    });

    const result = await remediateBootHandler.execute(ctx);

    const remeds = result.remediations as Array<{ name: string; action: string }>;
    const names = remeds.map((r) => r.name);
    expect(names).toContain("virtio-drivers");
    expect(names).toContain("google-guest-agent");
    expect(names).toContain("google-osconfig-agent");
    // Should remove AWS SSM agent since source was AWS
    expect(names).toContain("ssm-agent");
    const ssmRemoval = remeds.find((r) => r.name === "ssm-agent");
    expect(ssmRemoval?.action).toBe("remove");
  });

  it("returns Windows-specific remediations for AWS", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const ctx = makeCtx({
      diskId: "ami-win-001",
      targetProvider: "aws",
      osType: "windows",
    });

    const result = await remediateBootHandler.execute(ctx);

    const remeds = result.remediations as Array<{ name: string }>;
    const names = remeds.map((r) => r.name);
    expect(names).toContain("ec2-config");
    expect(names).toContain("pvdriver");
    // ENA/NVMe are still included for Windows
    expect(names).toContain("ena-driver");
    expect(names).toContain("nvme-driver");
    // Should NOT contain linux-specific agents
    expect(names).not.toContain("cloud-init");
    expect(names).not.toContain("ssm-agent");
  });

  it("marks all remediations as skipped in dry-run mode", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const ctx = makeCtx({
      diskId: "ami-dryrun",
      targetProvider: "aws",
      osType: "linux",
      dryRun: true,
    });

    const result = await remediateBootHandler.execute(ctx);

    expect(result.dryRun).toBe(true);
    const remeds = result.remediations as Array<{ status: string }>;
    expect(remeds.every((r) => r.status === "skipped")).toBe(true);
    expect(result.remediationCount).toBe(0);
    expect(result.skippedCount).toBe(remeds.length);
  });

  it("returns empty remediations for unknown provider", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const ctx = makeCtx({
      diskId: "disk-unknown",
      targetProvider: "oracle",
      osType: "linux",
    });

    const result = await remediateBootHandler.execute(ctx);

    expect((result.remediations as unknown[]).length).toBe(0);
    expect(result.remediationCount).toBe(0);
    expect(fakeLog.warn).toHaveBeenCalled();
  });

  it("does not define a rollback method", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    expect(remediateBootHandler.rollback).toBeUndefined();
  });

  it("respects abort signal", async () => {
    const { remediateBootHandler } = await import("../src/compute/steps/remediate-boot.js");
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx(
      {
        diskId: "ami-abort",
        targetProvider: "aws",
        osType: "linux",
      },
      { signal: controller.signal },
    );

    // The handler checks signal only during iteration — with pre-aborted signal
    // it should throw on the first spec iteration
    await expect(remediateBootHandler.execute(ctx)).rejects.toThrow();
  });
});

// =============================================================================
// decommission-source
// =============================================================================

describe("compute/steps/decommission-source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes soft decommission in fallback mode", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-abc123",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      snapshotIds: ["snap-001", "snap-002"],
      mode: "soft",
    });

    const result = await decommissionSourceHandler.execute(ctx);

    expect(result.sourceInstanceId).toBe("i-abc123");
    expect(result.sourceProvider).toBe("aws");
    expect(result.mode).toBe("soft");
    expect(result.dryRun).toBe(false);

    const actions = result.actions as Array<{ resource: string; action: string; status: string; resourceType: string }>;
    expect(actions.length).toBeGreaterThan(0);

    // In soft mode, VM should be stopped (not terminated)
    const vmAction = actions.find((a) => a.resourceType === "instance" && a.action === "stop");
    expect(vmAction).toBeDefined();
    expect(vmAction!.status).toBe("completed");

    // Snapshots should be skipped in soft mode
    const snapActions = actions.filter((a) => a.resourceType === "snapshot");
    expect(snapActions.length).toBe(2);
    expect(snapActions.every((a) => a.action === "skip" && a.status === "skipped")).toBe(true);

    expect(typeof result.elapsedMs).toBe("number");
    expect(result.decommissionedAt).toBeDefined();
  });

  it("executes hard decommission in fallback mode", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-terminate",
      sourceProvider: "azure",
      sourceRegion: "eastus",
      snapshotIds: ["snap-x"],
      stagingBucket: "staging-bucket",
      stagingKeys: ["export/image.vhd"],
      mode: "hard",
    });

    const result = await decommissionSourceHandler.execute(ctx);

    expect(result.mode).toBe("hard");

    const actions = result.actions as Array<{ resource: string; action: string; status: string; resourceType: string }>;

    // In hard mode, VM should be terminated
    const vmAction = actions.find((a) => a.resourceType === "instance" && a.action === "terminate");
    expect(vmAction).toBeDefined();

    // Snapshots should be deleted in hard mode
    const snapDel = actions.find((a) => a.resourceType === "snapshot" && a.action === "delete");
    expect(snapDel).toBeDefined();

    // Staging objects should be deleted
    const objDel = actions.find((a) => a.resourceType === "object" && a.action === "delete");
    expect(objDel).toBeDefined();

    expect(result.completedCount).toBeGreaterThan(0);
  });

  it("marks actions as dry-run when dryRun is true", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-dry",
      sourceProvider: "gcp",
      sourceRegion: "us-central1",
      mode: "hard",
      dryRun: true,
    });

    const result = await decommissionSourceHandler.execute(ctx);

    expect(result.dryRun).toBe(true);
    const actions = result.actions as Array<{ status: string }>;
    expect(actions.every((a) => a.status === "dry-run" || a.status === "skipped")).toBe(true);
  });

  it("defaults to soft mode when mode is not specified", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-default",
      sourceProvider: "aws",
      sourceRegion: "us-west-2",
    });

    const result = await decommissionSourceHandler.execute(ctx);

    expect(result.mode).toBe("soft");
    const actions = result.actions as Array<{ action: string; resourceType: string }>;
    const vmAction = actions.find((a) => a.resourceType === "instance");
    expect(vmAction?.action).toBe("stop");
  });

  it("includes staging cleanup in hard mode", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-staging",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      stagingBucket: "migration-staging",
      stagingKeys: ["img1.vmdk", "img2.vmdk", "manifest.json"],
      mode: "hard",
    });

    const result = await decommissionSourceHandler.execute(ctx);

    const actions = result.actions as Array<{ resource: string; resourceType: string; action: string }>;
    const objectActions = actions.filter((a) => a.resourceType === "object");
    expect(objectActions.length).toBe(3);
    expect(objectActions.every((a) => a.action === "delete")).toBe(true);
  });

  it("skips staging cleanup in soft mode", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-keep",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      stagingBucket: "migration-staging",
      stagingKeys: ["img1.vmdk"],
      mode: "soft",
    });

    const result = await decommissionSourceHandler.execute(ctx);

    const actions = result.actions as Array<{ resource: string; resourceType: string; action: string }>;
    const objectActions = actions.filter((a) => a.resourceType === "object");
    expect(objectActions.every((a) => a.action === "skip")).toBe(true);
  });

  it("has a rollback method", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    expect(typeof decommissionSourceHandler.rollback).toBe("function");
  });

  it("rollback logs warnings about irrecoverable actions", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-rollback",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
    });

    const outputs = {
      actions: [
        { resource: "i-rollback", resourceType: "instance", action: "terminate", status: "completed" },
        { resource: "snap-123", resourceType: "snapshot", action: "delete", status: "completed" },
      ],
    };

    await decommissionSourceHandler.rollback!(ctx, outputs);

    // Should warn about terminated VM
    expect(fakeLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("terminated"),
    );
    // Should warn about deleted snapshots
    expect(fakeLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("snapshot"),
    );
  });

  it("respects abort signal", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx(
      {
        sourceInstanceId: "i-abort",
        sourceProvider: "aws",
        sourceRegion: "us-east-1",
        snapshotIds: ["snap-1"],
        mode: "hard",
      },
      { signal: controller.signal },
    );

    // Pre-aborted signal should abort during the first action that checks it
    await expect(decommissionSourceHandler.execute(ctx)).rejects.toThrow();
  });

  it("populates decommission tags including job ID", async () => {
    const { decommissionSourceHandler } = await import("../src/compute/steps/decommission-source.js");
    const ctx = makeCtx({
      sourceInstanceId: "i-tags",
      sourceProvider: "aws",
      sourceRegion: "us-east-1",
      jobId: "job-42",
      decommissionTags: { team: "platform" },
      mode: "soft",
    });

    const result = await decommissionSourceHandler.execute(ctx);

    const actions = result.actions as Array<{ action: string; detail?: string }>;
    const tagAction = actions.find((a) => a.action === "tag");
    expect(tagAction).toBeDefined();
    expect(tagAction!.detail).toContain("job-42");
    expect(tagAction!.detail).toContain("platform");
  });
});

// =============================================================================
// approval-gate-handler
// =============================================================================

describe("governance/approval-gate-handler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the in-memory store between tests
    const mod = await import("../src/governance/approval-gate-handler.js");
    mod.resetApprovalStore();
  });

  it("auto-approves when autoApprove flag is set", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");
    const ctx = makeCtx({
      jobId: "job-1",
      gatedStepId: "cutover",
      autoApprove: true,
    });

    const result = await approvalGateHandler.execute(ctx);

    expect(result.approved).toBe(true);
    expect(result.autoApproved).toBe(true);
    expect(result.decidedBy).toBe("system-auto");
    expect(result.requestId).toMatch(/^auto-/);
    expect(result.riskLevel).toBeDefined();
    expect(typeof result.waitDurationMs).toBe("number");
  });

  it("auto-approves in dry-run tag mode", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");
    const ctx = makeCtx(
      {
        jobId: "job-dry",
        gatedStepId: "provision-vm",
      },
      {
        tags: { "dry-run": "true" },
      },
    );

    const result = await approvalGateHandler.execute(ctx);

    expect(result.approved).toBe(true);
    expect(result.autoApproved).toBe(true);
  });

  it("waits for manual approval and returns when approved", async () => {
    const { approvalGateHandler, submitApprovalDecision, getPendingApprovals } = await import(
      "../src/governance/approval-gate-handler.js"
    );

    const ctx = makeCtx({
      jobId: "job-manual",
      gatedStepId: "cutover",
      pollIntervalMs: 50,
      approvalPolicy: { timeoutMs: 30_000, autoApproveInDryRun: true },
    });

    // Start execution in background
    const resultPromise = approvalGateHandler.execute(ctx);

    // Wait for the request to appear in pending
    await new Promise((r) => setTimeout(r, 100));

    const pending = getPendingApprovals();
    expect(pending.length).toBe(1);

    // Submit approval
    const success = submitApprovalDecision({
      requestId: pending[0].id,
      approved: true,
      decidedBy: "admin@example.com",
      decidedAt: new Date().toISOString(),
      reason: "Looks good",
    });
    expect(success).toBe(true);

    const result = await resultPromise;

    expect(result.approved).toBe(true);
    expect(result.decidedBy).toBe("admin@example.com");
    expect(result.reason).toBe("Looks good");
    expect(result.autoApproved).toBe(false);
    expect((result.waitDurationMs as number)).toBeGreaterThanOrEqual(0);
  });

  it("throws when approval is rejected", async () => {
    const { approvalGateHandler, submitApprovalDecision, getPendingApprovals } = await import(
      "../src/governance/approval-gate-handler.js"
    );

    const ctx = makeCtx({
      jobId: "job-reject",
      gatedStepId: "cutover",
      pollIntervalMs: 50,
      approvalPolicy: { timeoutMs: 30_000, autoApproveInDryRun: true },
    });

    const resultPromise = approvalGateHandler.execute(ctx);

    await new Promise((r) => setTimeout(r, 100));

    const pending = getPendingApprovals();
    submitApprovalDecision({
      requestId: pending[0].id,
      approved: false,
      decidedBy: "security@example.com",
      decidedAt: new Date().toISOString(),
      reason: "Risk too high",
    });

    await expect(resultPromise).rejects.toThrow("Approval rejected");
  });

  it("throws on timeout when no decision is received", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");

    const ctx = makeCtx({
      jobId: "job-timeout",
      gatedStepId: "provision-vm",
      pollIntervalMs: 20,
      approvalPolicy: { timeoutMs: 100, autoApproveInDryRun: true },
    });

    await expect(approvalGateHandler.execute(ctx)).rejects.toThrow("timed out");
  });

  it("submitApprovalDecision returns false for unknown request ID", async () => {
    const { submitApprovalDecision } = await import("../src/governance/approval-gate-handler.js");

    const result = submitApprovalDecision({
      requestId: "nonexistent-id",
      approved: true,
      decidedBy: "admin",
      decidedAt: new Date().toISOString(),
    });

    expect(result).toBe(false);
  });

  it("getPendingApprovals returns empty array initially", async () => {
    const { getPendingApprovals } = await import("../src/governance/approval-gate-handler.js");
    expect(getPendingApprovals()).toEqual([]);
  });

  it("evaluates risk level and includes it in result", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");

    const ctx = makeCtx({
      jobId: "job-risk",
      gatedStepId: "cutover",
      autoApprove: true,
      estimatedCostUSD: 100_000,
      vmCount: 50,
      hasDatabase: true,
      isProduction: true,
    });

    const result = await approvalGateHandler.execute(ctx);

    expect(result.riskLevel).toBeDefined();
    expect(["low", "medium", "high", "critical"]).toContain(result.riskLevel);
  });

  it("does not define a rollback method", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");
    expect(approvalGateHandler.rollback).toBeUndefined();
  });

  it("respects abort signal during polling", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");

    const controller = new AbortController();
    const ctx = makeCtx(
      {
        jobId: "job-abort",
        gatedStepId: "cutover",
        pollIntervalMs: 50,
        approvalPolicy: { timeoutMs: 60_000, autoApproveInDryRun: true },
      },
      { signal: controller.signal },
    );

    const resultPromise = approvalGateHandler.execute(ctx);

    // Abort after 150ms of polling
    setTimeout(() => controller.abort(), 150);

    await expect(resultPromise).rejects.toThrow();
  });

  it("includes gated step info in log output", async () => {
    const { approvalGateHandler } = await import("../src/governance/approval-gate-handler.js");

    const ctx = makeCtx({
      jobId: "job-info",
      gatedStepId: "cutover",
      gatedPhase: "cutting-over",
      description: "Approve production cutover",
      autoApprove: true,
    });

    await approvalGateHandler.execute(ctx);

    expect(fakeLog.info).toHaveBeenCalledWith(
      expect.stringContaining("Approve production cutover"),
    );
    expect(fakeLog.info).toHaveBeenCalledWith(
      expect.stringContaining("cutover"),
    );
  });
});
