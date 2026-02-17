/**
 * Azure Context Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureContextManager, createContextManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({
    credential: { getToken: vi.fn() },
    method: "default",
    subscriptionId: "sub-from-cred",
    tenantId: "tenant-from-cred",
  }),
  getSubscriptionId: vi.fn().mockReturnValue("sub-from-getter"),
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureContextManager", () => {
  let mgr: AzureContextManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureContextManager(mockCredentialsManager);
  });

  // -------------------------------------------------------------------------
  // getContext (before init)
  // -------------------------------------------------------------------------
  describe("getContext (before initialize)", () => {
    it("returns null before initialization", () => {
      expect(mgr.getContext()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // initialize
  // -------------------------------------------------------------------------
  describe("initialize", () => {
    it("initializes context from credentials", async () => {
      const ctx = await mgr.initialize();
      expect(ctx.subscriptionId).toBe("sub-from-cred");
      expect(ctx.tenantId).toBe("tenant-from-cred");
      expect(ctx.region).toBe("eastus");
    });

    it("uses custom default region", async () => {
      const customMgr = new AzureContextManager(mockCredentialsManager, "westus2");
      const ctx = await customMgr.initialize();
      expect(ctx.region).toBe("westus2");
    });

    it("sets context so getContext returns it", async () => {
      expect(mgr.getContext()).toBeNull();
      await mgr.initialize();
      expect(mgr.getContext()).not.toBeNull();
      expect(mgr.getContext()!.subscriptionId).toBe("sub-from-cred");
    });
  });

  // -------------------------------------------------------------------------
  // switchContext
  // -------------------------------------------------------------------------
  describe("switchContext", () => {
    it("switches subscription", async () => {
      await mgr.initialize();
      const ctx = await mgr.switchContext({ subscriptionId: "sub-2" });
      expect(ctx.subscriptionId).toBe("sub-2");
      expect(ctx.tenantId).toBe("tenant-from-cred"); // preserved
    });

    it("switches region", async () => {
      await mgr.initialize();
      const ctx = await mgr.switchContext({ region: "northeurope" });
      expect(ctx.region).toBe("northeurope");
      expect(ctx.subscriptionId).toBe("sub-from-cred"); // preserved
    });

    it("switches tenant", async () => {
      await mgr.initialize();
      const ctx = await mgr.switchContext({ tenantId: "tenant-2" });
      expect(ctx.tenantId).toBe("tenant-2");
    });

    it("switches multiple fields at once", async () => {
      await mgr.initialize();
      const ctx = await mgr.switchContext({ subscriptionId: "s2", tenantId: "t2", region: "r2" });
      expect(ctx.subscriptionId).toBe("s2");
      expect(ctx.tenantId).toBe("t2");
      expect(ctx.region).toBe("r2");
    });

    it("works without prior initialization", async () => {
      const ctx = await mgr.switchContext({ subscriptionId: "sub-new" });
      expect(ctx.subscriptionId).toBe("sub-new");
      expect(ctx.region).toBe("eastus");
    });
  });

  // -------------------------------------------------------------------------
  // getSubscriptionId
  // -------------------------------------------------------------------------
  describe("getSubscriptionId", () => {
    it("returns subscription from context when initialized", async () => {
      await mgr.initialize();
      expect(mgr.getSubscriptionId()).toBe("sub-from-cred");
    });

    it("falls back to credentials manager when not initialized", () => {
      expect(mgr.getSubscriptionId()).toBe("sub-from-getter");
    });
  });

  // -------------------------------------------------------------------------
  // getRegion
  // -------------------------------------------------------------------------
  describe("getRegion", () => {
    it("returns region from context when initialized", async () => {
      await mgr.initialize();
      await mgr.switchContext({ region: "japaneast" });
      expect(mgr.getRegion()).toBe("japaneast");
    });

    it("returns default region when not initialized", () => {
      expect(mgr.getRegion()).toBe("eastus");
    });

    it("returns custom default region", () => {
      const customMgr = new AzureContextManager(mockCredentialsManager, "uksouth");
      expect(customMgr.getRegion()).toBe("uksouth");
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createContextManager", () => {
    it("creates an AzureContextManager instance", () => {
      const instance = createContextManager(mockCredentialsManager);
      expect(instance).toBeInstanceOf(AzureContextManager);
    });

    it("passes default region", () => {
      const instance = createContextManager(mockCredentialsManager, "australiaeast");
      expect(instance.getRegion()).toBe("australiaeast");
    });
  });
});
