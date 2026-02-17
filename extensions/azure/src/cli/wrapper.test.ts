/**
 * Azure CLI Wrapper — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureCLIWrapper, createCLIWrapper } from "./wrapper.js";

// ---------------------------------------------------------------------------
// Mock node:child_process — vi.hoisted ensures the fn is available at hoist time
// ---------------------------------------------------------------------------

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:util", () => ({
  promisify: (_fn: unknown) => mockExecFile,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureCLIWrapper", () => {
  let cli: AzureCLIWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = new AzureCLIWrapper();
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------
  describe("execute", () => {
    it("executes a command and returns success result", async () => {
      mockExecFile.mockResolvedValue({ stdout: '{"name":"test"}', stderr: "" });

      const result = await cli.execute(["group", "list"]);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.parsed).toEqual({ name: "test" });
      expect(mockExecFile).toHaveBeenCalledWith(
        "az",
        ["group", "list", "--output", "json"],
        expect.objectContaining({ timeout: 60000 }),
      );
    });

    it("returns parsed as undefined for non-JSON output", async () => {
      mockExecFile.mockResolvedValue({ stdout: "plain text output", stderr: "" });

      const result = await cli.execute(["version"]);
      expect(result.success).toBe(true);
      expect(result.parsed).toBeUndefined();
      expect(result.stdout).toBe("plain text output");
    });

    it("returns failure result on error", async () => {
      mockExecFile.mockRejectedValue({ stderr: "command not found", code: 127, message: "az not found" });

      const result = await cli.execute(["invalid"]);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toBe("command not found");
    });

    it("uses error message as fallback when stderr missing", async () => {
      mockExecFile.mockRejectedValue({ message: "timeout exceeded" });

      const result = await cli.execute(["slow"]);
      expect(result.success).toBe(false);
      expect(result.stderr).toBe("timeout exceeded");
    });

    it("defaults to 'Unknown error' when error has no details", async () => {
      mockExecFile.mockRejectedValue({});

      const result = await cli.execute(["fail"]);
      expect(result.success).toBe(false);
      expect(result.stderr).toBe("Unknown error");
      expect(result.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable
  // -------------------------------------------------------------------------
  describe("isAvailable", () => {
    it("returns true when az version succeeds", async () => {
      mockExecFile.mockResolvedValue({ stdout: '{"azure-cli": "2.50.0"}', stderr: "" });

      const available = await cli.isAvailable();
      expect(available).toBe(true);
    });

    it("returns false when az version fails", async () => {
      mockExecFile.mockRejectedValue({ message: "command not found" });

      const available = await cli.isAvailable();
      expect(available).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getAccount
  // -------------------------------------------------------------------------
  describe("getAccount", () => {
    it("calls az account show", async () => {
      mockExecFile.mockResolvedValue({ stdout: '{"id":"sub-1","name":"My Sub"}', stderr: "" });

      const result = await cli.getAccount();
      expect(result.success).toBe(true);
      expect(result.parsed).toEqual({ id: "sub-1", name: "My Sub" });
    });
  });

  // -------------------------------------------------------------------------
  // listSubscriptions
  // -------------------------------------------------------------------------
  describe("listSubscriptions", () => {
    it("calls az account list", async () => {
      mockExecFile.mockResolvedValue({ stdout: '[{"id":"sub-1"}]', stderr: "" });

      const result = await cli.listSubscriptions();
      expect(result.success).toBe(true);
      expect(result.parsed).toEqual([{ id: "sub-1" }]);
    });
  });

  // -------------------------------------------------------------------------
  // setSubscription
  // -------------------------------------------------------------------------
  describe("setSubscription", () => {
    it("calls az account set with subscription id", async () => {
      mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await cli.setSubscription("sub-2");
      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        "az",
        ["account", "set", "--subscription", "sub-2", "--output", "json"],
        expect.any(Object),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Constructor options
  // -------------------------------------------------------------------------
  describe("constructor options", () => {
    it("uses custom az path", async () => {
      const custom = new AzureCLIWrapper({ azPath: "/usr/local/bin/az" });
      mockExecFile.mockResolvedValue({ stdout: "{}", stderr: "" });

      await custom.execute(["version"]);
      expect(mockExecFile).toHaveBeenCalledWith(
        "/usr/local/bin/az",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("uses custom timeout", async () => {
      const custom = new AzureCLIWrapper({ timeoutMs: 5000 });
      mockExecFile.mockResolvedValue({ stdout: "{}", stderr: "" });

      await custom.execute(["version"]);
      expect(mockExecFile).toHaveBeenCalledWith(
        "az",
        expect.any(Array),
        expect.objectContaining({ timeout: 5000 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createCLIWrapper", () => {
    it("creates an AzureCLIWrapper instance", () => {
      const instance = createCLIWrapper();
      expect(instance).toBeInstanceOf(AzureCLIWrapper);
    });

    it("passes options through", () => {
      const instance = createCLIWrapper({ azPath: "/opt/az", timeoutMs: 10000 });
      expect(instance).toBeInstanceOf(AzureCLIWrapper);
    });
  });
});
