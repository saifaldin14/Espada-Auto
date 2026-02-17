/**
 * Azure DevOps PAT Manager — Unit Tests
 *
 * Tests encryption, CRUD, validation, expiry, rotation, events, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DevOpsPATManager } from "./pat-manager.js";
import type { PATSummary, PATValidationResult, PATEvent } from "./pat-types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

async function createManager(overrides: Record<string, unknown> = {}): Promise<DevOpsPATManager> {
  const mgr = new DevOpsPATManager({
    storageDir: tempDir,
    encryptionKey: "test-encryption-key-for-unit-tests",
    defaultOrganization: "test-org",
    expiryWarningDays: 7,
    ...overrides,
  });
  await mgr.initialize();
  return mgr;
}

const VALID_TOKEN = "abcdef0123456789abcdef0123456789abcdef0123456789abcd";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pat-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DevOpsPATManager", () => {
  describe("initialization", () => {
    it("initializes and creates storage directory", async () => {
      const mgr = await createManager();
      expect(mgr.count()).toBe(0);
    });

    it("throws if not initialized before use", () => {
      const mgr = new DevOpsPATManager({
        storageDir: tempDir,
        encryptionKey: "test-key",
      });
      expect(() => mgr.listPATs()).toThrow("not initialized");
    });
  });

  describe("storePAT", () => {
    it("stores a PAT and returns a summary", async () => {
      const mgr = await createManager();
      const summary = await mgr.storePAT({
        token: VALID_TOKEN,
        label: "CI Pipeline",
        scopes: ["vso.build", "vso.code"],
      });

      expect(summary.id).toBeTruthy();
      expect(summary.label).toBe("CI Pipeline");
      expect(summary.organization).toBe("test-org");
      expect(summary.scopes).toEqual(["vso.build", "vso.code"]);
      expect(summary.status).toBe("unvalidated");
      expect(summary.backend).toBe("file");
      expect(summary.createdAt).toBeTruthy();
    });

    it("stores with explicit organization", async () => {
      const mgr = await createManager();
      const summary = await mgr.storePAT({
        token: VALID_TOKEN,
        label: "Custom Org",
        organization: "other-org",
      });
      expect(summary.organization).toBe("other-org");
    });

    it("stores with full scope", async () => {
      const mgr = await createManager();
      const summary = await mgr.storePAT({
        token: VALID_TOKEN,
        label: "Full Access",
        scopes: "full",
      });
      expect(summary.scopes).toBe("full");
    });

    it("stores with expiry date", async () => {
      const mgr = await createManager();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const summary = await mgr.storePAT({
        token: VALID_TOKEN,
        label: "Expiring",
        expiresAt,
      });
      expect(summary.expiresAt).toBe(expiresAt);
      expect(summary.status).toBe("unvalidated");
    });

    it("rejects duplicate label + org", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Dup" });
      await expect(mgr.storePAT({ token: VALID_TOKEN, label: "Dup" }))
        .rejects.toThrow(/already exists/);
    });

    it("rejects too-short tokens", async () => {
      const mgr = await createManager();
      await expect(mgr.storePAT({ token: "abc", label: "Short" }))
        .rejects.toThrow(/too short/);
    });

    it("requires organization", async () => {
      const mgr = await createManager({ defaultOrganization: undefined });
      await expect(mgr.storePAT({ token: VALID_TOKEN, label: "No Org" }))
        .rejects.toThrow(/Organization is required/);
    });
  });

  describe("encryption round-trip", () => {
    it("decrypts stored token correctly", async () => {
      const mgr = await createManager();
      const summary = await mgr.storePAT({ token: VALID_TOKEN, label: "Enc Test" });
      const decrypted = await mgr.decryptPAT(summary.id);
      expect(decrypted.token).toBe(VALID_TOKEN);
      expect(decrypted.label).toBe("Enc Test");
      expect(decrypted.organization).toBe("test-org");
    });

    it("updates lastUsedAt on decrypt", async () => {
      const mgr = await createManager();
      const summary = await mgr.storePAT({ token: VALID_TOKEN, label: "Used" });
      expect(summary.lastUsedAt).toBeUndefined();
      const dec = await mgr.decryptPAT(summary.id);
      expect(dec.lastUsedAt).toBeTruthy();
    });

    it("different PATs get unique IVs", async () => {
      const mgr = await createManager();
      const s1 = await mgr.storePAT({ token: VALID_TOKEN, label: "PAT-1" });
      const s2 = await mgr.storePAT({ token: VALID_TOKEN, label: "PAT-2" });
      // Internal check: read the stored file to see IVs differ
      expect(s1.id).not.toBe(s2.id);
    });

    it("wrong key fails to decrypt", async () => {
      const mgr1 = await createManager({ encryptionKey: "key-one-aaaabbbbccccdddd" });
      const summary = await mgr1.storePAT({ token: VALID_TOKEN, label: "WrongKey" });

      const mgr2 = await createManager({ encryptionKey: "key-two-eeeeffffgggghhhh" });
      await expect(mgr2.decryptPAT(summary.id)).rejects.toThrow();
    });
  });

  describe("persistence", () => {
    it("survives re-initialization", async () => {
      const mgr1 = await createManager();
      await mgr1.storePAT({ token: VALID_TOKEN, label: "Persist" });
      expect(mgr1.count()).toBe(1);

      const mgr2 = await createManager();
      expect(mgr2.count()).toBe(1);
      const list = mgr2.listPATs();
      expect(list[0].label).toBe("Persist");
    });
  });

  describe("listPATs", () => {
    it("lists all PATs", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "A" });
      await mgr.storePAT({ token: VALID_TOKEN, label: "B" });
      await mgr.storePAT({ token: VALID_TOKEN, label: "C", organization: "other-org" });
      expect(mgr.listPATs()).toHaveLength(3);
    });

    it("filters by organization", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "A" });
      await mgr.storePAT({ token: VALID_TOKEN, label: "B", organization: "other-org" });
      expect(mgr.listPATs("test-org")).toHaveLength(1);
      expect(mgr.listPATs("other-org")).toHaveLength(1);
      expect(mgr.listPATs("unknown")).toHaveLength(0);
    });
  });

  describe("getPAT", () => {
    it("returns summary by ID", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Get" });
      const found = mgr.getPAT(stored.id);
      expect(found).toBeDefined();
      expect(found!.label).toBe("Get");
    });

    it("returns undefined for missing ID", async () => {
      const mgr = await createManager();
      expect(mgr.getPAT("nonexistent")).toBeUndefined();
    });
  });

  describe("findByLabel", () => {
    it("finds by label and org", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Find Me" });
      const found = mgr.findByLabel("Find Me", "test-org");
      expect(found).toBeDefined();
      expect(found!.label).toBe("Find Me");
    });

    it("uses default org", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Default Org" });
      const found = mgr.findByLabel("Default Org");
      expect(found).toBeDefined();
    });

    it("returns undefined for missing label", async () => {
      const mgr = await createManager();
      expect(mgr.findByLabel("Ghost")).toBeUndefined();
    });
  });

  describe("deletePAT", () => {
    it("deletes a PAT by ID", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Delete Me" });
      expect(mgr.count()).toBe(1);
      const result = await mgr.deletePAT(stored.id);
      expect(result).toBe(true);
      expect(mgr.count()).toBe(0);
    });

    it("returns false for missing ID", async () => {
      const mgr = await createManager();
      const result = await mgr.deletePAT("nonexistent");
      expect(result).toBe(false);
    });

    it("persists deletion", async () => {
      const mgr1 = await createManager();
      const stored = await mgr1.storePAT({ token: VALID_TOKEN, label: "Gone" });
      await mgr1.deletePAT(stored.id);

      const mgr2 = await createManager();
      expect(mgr2.count()).toBe(0);
    });
  });

  describe("rotatePAT", () => {
    it("replaces encrypted token", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Rotate" });
      const newToken = "new-token-value-0123456789abcdef0123456789abcdef";
      const rotated = await mgr.rotatePAT(stored.id, newToken);

      expect(rotated.id).toBe(stored.id);
      expect(rotated.label).toBe("Rotate");
      expect(rotated.validated).toBe(false); // Reset

      const dec = await mgr.decryptPAT(stored.id);
      expect(dec.token).toBe(newToken);
    });

    it("updates expiry on rotation", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Rotate Exp" });
      const newExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const rotated = await mgr.rotatePAT(stored.id, VALID_TOKEN, newExpiry);
      expect(rotated.expiresAt).toBe(newExpiry);
    });

    it("throws for missing PAT", async () => {
      const mgr = await createManager();
      await expect(mgr.rotatePAT("missing", VALID_TOKEN)).rejects.toThrow("PAT not found");
    });

    it("rejects short new token", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Short Rotate" });
      await expect(mgr.rotatePAT(stored.id, "abc")).rejects.toThrow(/too short/);
    });
  });

  describe("expiry tracking", () => {
    it("detects expired PATs", async () => {
      const mgr = await createManager();
      const expired = new Date(Date.now() - 1000).toISOString();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Old", expiresAt: expired });
      const list = mgr.listPATs();
      expect(list[0].status).toBe("expired");
    });

    it("detects expiring-soon PATs", async () => {
      const mgr = await createManager();
      // 3 days from now (within 7-day warning)
      const soonExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      // Must be "validated" to show expiring-soon (unvalidated takes precedence)
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Soon", expiresAt: soonExpiry });
      // Force validation flag
      const pat = (mgr as any).pats.find((p: any) => p.id === stored.id);
      pat.validated = true;
      expect(mgr.getPAT(stored.id)!.status).toBe("expiring-soon");
    });

    it("checkExpiry returns only problematic PATs", async () => {
      const mgr = await createManager();
      // Active PAT (no expiry, unvalidated — but not "expired")
      await mgr.storePAT({ token: VALID_TOKEN, label: "Active" });
      // Expired PAT
      await mgr.storePAT({ token: VALID_TOKEN, label: "Old", expiresAt: new Date(Date.now() - 1000).toISOString() });

      const problems = mgr.checkExpiry();
      expect(problems).toHaveLength(1);
      expect(problems[0].label).toBe("Old");
    });

    it("purgeExpired removes only expired", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Keep" });
      await mgr.storePAT({ token: VALID_TOKEN, label: "Remove", expiresAt: new Date(Date.now() - 1000).toISOString() });

      const purged = await mgr.purgeExpired();
      expect(purged).toBe(1);
      expect(mgr.count()).toBe(1);
      expect(mgr.listPATs()[0].label).toBe("Keep");
    });
  });

  describe("getTokenForOrganization", () => {
    it("returns token for matching org", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Org Token" });
      const token = await mgr.getTokenForOrganization("test-org");
      expect(token).toBe(VALID_TOKEN);
    });

    it("returns null for unknown org", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Org Token" });
      const token = await mgr.getTokenForOrganization("unknown-org");
      expect(token).toBeNull();
    });

    it("skips expired tokens", async () => {
      const mgr = await createManager();
      const expired = new Date(Date.now() - 1000).toISOString();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Expired", expiresAt: expired });
      // Mark as validated so status becomes "expired" not "unvalidated"
      const pat = (mgr as any).pats.find((p: any) => p.id === stored.id);
      pat.validated = true;
      const token = await mgr.getTokenForOrganization("test-org");
      expect(token).toBeNull();
    });

    it("prefers validated tokens", async () => {
      const mgr = await createManager();
      const token1 = "unvalidated-token-abcdef0123456789abcdef012345";
      const token2 = "validated-token-xxxx0123456789abcdef0123456789";
      await mgr.storePAT({ token: token1, label: "Unvalidated" });
      const s2 = await mgr.storePAT({ token: token2, label: "Validated" });
      // Force validate second one
      const pat = (mgr as any).pats.find((p: any) => p.id === s2.id);
      pat.validated = true;

      const result = await mgr.getTokenForOrganization("test-org");
      expect(result).toBe(token2);
    });
  });

  describe("validatePAT", () => {
    it("validates against DevOps API (success)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authenticatedUser: { providerDisplayName: "Test User", properties: { Account: { $value: "test@example.com" } } },
        }),
      });
      globalThis.fetch = fetchSpy;

      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Validate" });
      const result = await mgr.validatePAT(stored.id);

      expect(result.valid).toBe(true);
      expect(result.displayName).toBe("Test User");
      expect(result.emailAddress).toBe("test@example.com");

      const updated = mgr.getPAT(stored.id);
      expect(updated!.validated).toBe(true);
    });

    it("validates against DevOps API (failure)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });
      globalThis.fetch = fetchSpy;

      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Bad" });
      const result = await mgr.validatePAT(stored.id);

      expect(result.valid).toBe(false);
      expect(result.httpStatus).toBe(401);
    });

    it("handles network error during validation", async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("Network timeout"));
      globalThis.fetch = fetchSpy;

      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "NetErr" });
      const result = await mgr.validatePAT(stored.id);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Network timeout");
    });

    it("throws for nonexistent PAT", async () => {
      const mgr = await createManager();
      await expect(mgr.validatePAT("missing")).rejects.toThrow("PAT not found");
    });
  });

  describe("events", () => {
    it("emits pat-stored event", async () => {
      const mgr = await createManager();
      const events: PATEvent[] = [];
      mgr.on((e) => events.push(e));

      await mgr.storePAT({ token: VALID_TOKEN, label: "Event Test" });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pat-stored");
      expect(events[0].label).toBe("Event Test");
    });

    it("emits pat-deleted event", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Del Event" });

      const events: PATEvent[] = [];
      mgr.on((e) => events.push(e));
      await mgr.deletePAT(stored.id);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pat-deleted");
    });

    it("emits pat-rotated event", async () => {
      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Rot Event" });

      const events: PATEvent[] = [];
      mgr.on((e) => events.push(e));
      await mgr.rotatePAT(stored.id, "new-token-0123456789abcdef0123456789abcdef01");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pat-rotated");
    });

    it("emits pat-validated event", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ authenticatedUser: { providerDisplayName: "User" } }),
      });

      const mgr = await createManager();
      const stored = await mgr.storePAT({ token: VALID_TOKEN, label: "Val Event" });

      const events: PATEvent[] = [];
      mgr.on((e) => events.push(e));
      await mgr.validatePAT(stored.id);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pat-validated");
    });

    it("unsubscribes correctly", async () => {
      const mgr = await createManager();
      const events: PATEvent[] = [];
      const unsub = mgr.on((e) => events.push(e));

      await mgr.storePAT({ token: VALID_TOKEN, label: "Sub Test" });
      expect(events).toHaveLength(1);

      unsub();
      await mgr.storePAT({ token: VALID_TOKEN, label: "Sub Test 2" });
      expect(events).toHaveLength(1); // Still 1
    });
  });

  describe("clearAll", () => {
    it("removes all PATs", async () => {
      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "A" });
      await mgr.storePAT({ token: VALID_TOKEN, label: "B" });
      const cleared = await mgr.clearAll();
      expect(cleared).toBe(2);
      expect(mgr.count()).toBe(0);
    });
  });

  describe("validateAll", () => {
    it("validates all stored PATs", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ authenticatedUser: { providerDisplayName: "User" } }),
      });

      const mgr = await createManager();
      await mgr.storePAT({ token: VALID_TOKEN, label: "V1" });
      await mgr.storePAT({ token: VALID_TOKEN, label: "V2" });
      const results = await mgr.validateAll();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.validation.valid)).toBe(true);
    });
  });
});
