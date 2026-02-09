import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAWSProgress,
  withAWSProgress,
  waitWithProgress,
  createCloudFormationProgress,
  createS3UploadProgress,
  createS3DownloadProgress,
  createEC2StateProgress,
  createLambdaDeployProgress,
  createRDSProgress,
  createContainerDeployProgress,
  createMultiStepProgress,
} from "./progress.js";

describe("AWS Progress Utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("createAWSProgress", () => {
    it("should create a progress reporter", () => {
      const progress = createAWSProgress({ label: "Test operation" });
      
      expect(progress).toHaveProperty("setLabel");
      expect(progress).toHaveProperty("setPercent");
      expect(progress).toHaveProperty("tick");
      expect(progress).toHaveProperty("done");
    });

    it("should return noop reporter when disabled", () => {
      const progress = createAWSProgress({ label: "Test", enabled: false });
      
      // Should not throw
      progress.setLabel("New label");
      progress.setPercent(50);
      progress.tick();
      progress.done();
    });
  });

  describe("withAWSProgress", () => {
    it("should execute function with progress", async () => {
      const fn = vi.fn(async (progress) => {
        progress.setLabel("Working...");
        return "result";
      });

      const result = await withAWSProgress("Test", fn);

      expect(result).toBe("result");
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({
        setLabel: expect.any(Function),
        done: expect.any(Function),
      }));
    });

    it("should call done() even on error", async () => {
      const progress = createAWSProgress({ label: "Test" });
      const doneSpy = vi.spyOn(progress, "done");

      await expect(
        withAWSProgress("Test", async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    });
  });

  describe("createCloudFormationProgress", () => {
    it("should create progress for stack name", () => {
      const progress = createCloudFormationProgress("my-stack");
      expect(progress).toBeDefined();
    });
  });

  describe("createS3UploadProgress", () => {
    it("should create progress for single key", () => {
      const progress = createS3UploadProgress("my-bucket", "path/to/file.txt");
      expect(progress).toBeDefined();
    });

    it("should create progress for multiple objects", () => {
      const progress = createS3UploadProgress("my-bucket", 100);
      expect(progress).toBeDefined();
    });
  });

  describe("createS3DownloadProgress", () => {
    it("should create progress for single key", () => {
      const progress = createS3DownloadProgress("my-bucket", "path/to/file.txt");
      expect(progress).toBeDefined();
    });

    it("should create progress for multiple objects", () => {
      const progress = createS3DownloadProgress("my-bucket", 50);
      expect(progress).toBeDefined();
    });
  });

  describe("createEC2StateProgress", () => {
    it("should create progress for instance state transition", () => {
      const progress = createEC2StateProgress("i-1234567890abcdef0", "running");
      expect(progress).toBeDefined();
    });
  });

  describe("createLambdaDeployProgress", () => {
    it("should create progress for Lambda deployment", () => {
      const progress = createLambdaDeployProgress("my-function");
      expect(progress).toBeDefined();
    });
  });

  describe("createRDSProgress", () => {
    it("should create progress for RDS operation", () => {
      const progress = createRDSProgress("my-db-instance", "creating snapshot");
      expect(progress).toBeDefined();
    });
  });

  describe("createContainerDeployProgress", () => {
    it("should create progress for container deployment", () => {
      const progress = createContainerDeployProgress("my-service", "my-cluster");
      expect(progress).toBeDefined();
    });
  });

  describe("createMultiStepProgress", () => {
    it("should create multi-step progress with nextStep method", () => {
      const progress = createMultiStepProgress("Deploy", 5);
      
      expect(progress).toHaveProperty("nextStep");
      expect(typeof progress.nextStep).toBe("function");
    });

    it("should update label on nextStep", () => {
      const progress = createMultiStepProgress("Deploy", 3);
      
      progress.nextStep("Preparing");
      progress.nextStep("Building");
      progress.nextStep("Deploying");
    });
  });

  describe("waitWithProgress", () => {
    it("should resolve when check returns true", async () => {
      const check = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const waitPromise = waitWithProgress("Waiting for resource", check, {
        pollIntervalMs: 100,
        maxWaitMs: 10000,
      });

      // Advance timer to trigger polls
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      await waitPromise;

      expect(check).toHaveBeenCalledTimes(3);
    });

    it("should timeout if check never returns true", async () => {
      const check = vi.fn().mockResolvedValue(false);

      const waitPromise = waitWithProgress("Waiting for resource", check, {
        pollIntervalMs: 100,
        maxWaitMs: 500,
      });

      // Attach rejection handler immediately to prevent unhandled rejection,
      // then flush all timers so the polling loop runs to timeout
      const rejection = expect(waitPromise).rejects.toThrow("Timed out after 0.5s");
      await vi.runAllTimersAsync();
      await rejection;
    });
  });
});
