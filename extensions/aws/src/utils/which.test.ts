/**
 * AWS Utils - Which utility - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { which, commandExists } from "./which.js";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  constants: { X_OK: 1 },
}));

describe("which", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default PATH
    process.env.PATH = "/usr/local/bin:/usr/bin:/bin";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("finding executables", () => {
    it("should find aws executable in PATH", async () => {
      const { access } = await import("node:fs/promises");
      vi.mocked(access).mockResolvedValue(undefined);
      
      const result = await which("aws");
      expect(result).toBeDefined();
      expect(result).toContain("aws");
    });

    it("should return null for non-existent command", async () => {
      const { access } = await import("node:fs/promises");
      vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
      
      const result = await which("nonexistent-command");
      expect(result).toBeNull();
    });

    it("should search all PATH directories", async () => {
      const { access } = await import("node:fs/promises");
      let callCount = 0;
      
      vi.mocked(access).mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("ENOENT");
        }
        return undefined;
      });
      
      const result = await which("aws");
      expect(result).toBeDefined();
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it("should handle empty PATH by returning null", async () => {
      const { access } = await import("node:fs/promises");
      // When PATH is empty, there are no valid directories to search
      vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
      process.env.PATH = "";
      
      const result = await which("aws");
      expect(result).toBeNull();
    });

    it("should handle undefined PATH by returning null", async () => {
      const { access } = await import("node:fs/promises");
      vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
      delete process.env.PATH;
      
      const result = await which("aws");
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle command with special characters", async () => {
      const { access } = await import("node:fs/promises");
      vi.mocked(access).mockResolvedValue(undefined);
      
      const result = await which("aws-cli");
      expect(result).toBeDefined();
    });

    it("should handle PATH with trailing colons", async () => {
      const { access } = await import("node:fs/promises");
      vi.mocked(access).mockResolvedValue(undefined);
      process.env.PATH = "/usr/local/bin:/usr/bin:";
      
      const result = await which("aws");
      expect(result).toBeDefined();
    });

    it("should handle PATH with duplicate directories", async () => {
      const { access } = await import("node:fs/promises");
      vi.mocked(access).mockResolvedValue(undefined);
      process.env.PATH = "/usr/local/bin:/usr/bin:/usr/local/bin";
      
      const result = await which("aws");
      expect(result).toBeDefined();
    });
  });
});

describe("commandExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PATH = "/usr/local/bin:/usr/bin:/bin";
  });

  it("should return true for existing command", async () => {
    const { access } = await import("node:fs/promises");
    vi.mocked(access).mockResolvedValue(undefined);
    
    const result = await commandExists("aws");
    expect(result).toBe(true);
  });

  it("should return false for non-existent command", async () => {
    const { access } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    
    const result = await commandExists("nonexistent");
    expect(result).toBe(false);
  });

  it("should return false for empty command name", async () => {
    const { access } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    
    const result = await commandExists("");
    expect(result).toBe(false);
  });
});
