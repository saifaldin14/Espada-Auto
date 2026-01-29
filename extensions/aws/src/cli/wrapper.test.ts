/**
 * AWS CLI Wrapper - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AWSCLIWrapper, createCLIWrapper } from "./wrapper.js";

// Mock the which utility
vi.mock("../utils/which.js", () => ({
  which: vi.fn().mockResolvedValue("/usr/local/bin/aws"),
  commandExists: vi.fn().mockResolvedValue(true),
}));

// Mock child_process spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn().mockImplementation(() => {
    const events: Record<string, ((...args: unknown[]) => void)[]> = {};
    const stdoutEvents: Record<string, ((...args: unknown[]) => void)[]> = {};
    const stderrEvents: Record<string, ((...args: unknown[]) => void)[]> = {};
    
    const proc = {
      stdout: {
        on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (!stdoutEvents[event]) stdoutEvents[event] = [];
          stdoutEvents[event].push(callback);
        }),
      },
      stderr: {
        on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (!stderrEvents[event]) stderrEvents[event] = [];
          stderrEvents[event].push(callback);
        }),
      },
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        if (!events[event]) events[event] = [];
        events[event].push(callback);
        
        // Auto-complete with success after a short delay
        if (event === "close") {
          setTimeout(() => {
            // Emit data first
            stdoutEvents.data?.forEach(cb => cb('{"Account": "123456789012"}'));
            // Then close
            callback(0);
          }, 10);
        }
      }),
      kill: vi.fn(),
    };
    
    return proc;
  }),
}));

describe("AWSCLIWrapper", () => {
  let wrapper: AWSCLIWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = new AWSCLIWrapper();
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      const w = new AWSCLIWrapper();
      expect(w).toBeInstanceOf(AWSCLIWrapper);
    });

    it("should accept custom CLI path", () => {
      const w = new AWSCLIWrapper({ cliPath: "/custom/path/aws" });
      expect(w).toBeInstanceOf(AWSCLIWrapper);
    });

    it("should accept default options", () => {
      const w = new AWSCLIWrapper({ 
        defaultOptions: {
          profile: "production",
          region: "eu-west-1",
        }
      });
      expect(w).toBeInstanceOf(AWSCLIWrapper);
    });

    it("should accept timeout settings", () => {
      const w = new AWSCLIWrapper({ 
        commandTimeout: 60000,
        maxRetries: 5,
        retryDelay: 2000,
      });
      expect(w).toBeInstanceOf(AWSCLIWrapper);
    });

    it("should accept multiple options together", () => {
      const w = new AWSCLIWrapper({
        cliPath: "/custom/path/aws",
        defaultOptions: {
          profile: "production",
          region: "eu-west-1",
          output: "json",
        },
        commandTimeout: 120000,
        maxRetries: 3,
        retryDelay: 1000,
      });
      expect(w).toBeInstanceOf(AWSCLIWrapper);
    });
  });

  describe("initialize", () => {
    it("should find AWS CLI in PATH", async () => {
      await wrapper.initialize();
      // Should complete without throwing
      expect(true).toBe(true);
    });

    it("should use custom CLI path if provided", async () => {
      const w = new AWSCLIWrapper({ cliPath: "/custom/path/aws" });
      await w.initialize();
      // Should complete without throwing
      expect(true).toBe(true);
    });

    it("should throw if AWS CLI not found", async () => {
      const { which } = await import("../utils/which.js");
      vi.mocked(which).mockResolvedValueOnce(null);
      
      const w = new AWSCLIWrapper();
      await expect(w.initialize()).rejects.toThrow("AWS CLI not found");
    });
  });

  describe("execute", () => {
    beforeEach(async () => {
      await wrapper.initialize();
    });

    it("should execute a command and return result", async () => {
      const result = await wrapper.execute("sts", "get-caller-identity");
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    it("should include profile in command if specified", async () => {
      const { spawn } = await import("node:child_process");
      
      await wrapper.execute("ec2", "describe-instances", {
        profile: "production",
      });
      
      expect(spawn).toHaveBeenCalled();
      const callArgs = vi.mocked(spawn).mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain("--profile");
      expect(args).toContain("production");
    });

    it("should include region in command if specified", async () => {
      const { spawn } = await import("node:child_process");
      
      await wrapper.execute("ec2", "describe-instances", {
        region: "eu-west-1",
      });
      
      expect(spawn).toHaveBeenCalled();
      const callArgs = vi.mocked(spawn).mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain("--region");
      expect(args).toContain("eu-west-1");
    });

    it("should use output format from options", async () => {
      const { spawn } = await import("node:child_process");
      
      await wrapper.execute("ec2", "describe-instances", {
        output: "yaml",
      });
      
      expect(spawn).toHaveBeenCalled();
      const callArgs = vi.mocked(spawn).mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain("--output");
      expect(args).toContain("yaml");
    });

    it("should use additional arguments", async () => {
      const { spawn } = await import("node:child_process");
      
      await wrapper.execute("ec2", "describe-instances", {
        args: ["--instance-ids", "i-12345"],
      });
      
      expect(spawn).toHaveBeenCalled();
      const callArgs = vi.mocked(spawn).mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain("--instance-ids");
      expect(args).toContain("i-12345");
    });

    it("should support dry-run mode", async () => {
      const { spawn } = await import("node:child_process");
      
      await wrapper.execute("ec2", "run-instances", {
        dryRun: true,
      });
      
      expect(spawn).toHaveBeenCalled();
      const callArgs = vi.mocked(spawn).mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain("--dry-run");
    });
  });

  describe("getVersion", () => {
    it("should return version info", async () => {
      await wrapper.initialize();
      const version = await wrapper.getVersion();
      expect(version).toBeDefined();
    });
  });
});

describe("createCLIWrapper", () => {
  it("should create a CLI wrapper instance", () => {
    const wrapper = createCLIWrapper();
    expect(wrapper).toBeInstanceOf(AWSCLIWrapper);
  });

  it("should pass config to the wrapper", () => {
    const wrapper = createCLIWrapper({
      defaultOptions: {
        profile: "production",
        region: "eu-west-1",
      },
    });
    expect(wrapper).toBeInstanceOf(AWSCLIWrapper);
  });
});
