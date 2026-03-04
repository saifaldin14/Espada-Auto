import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:util", () => ({
  promisify: (_fn: unknown) => execFileMock,
}));

import { tfPlan } from "./cli-wrapper.js";

beforeEach(() => {
  execFileMock.mockReset();
});

describe("terraform cli-wrapper", () => {
  it("passes timeout/signal/maxBuffer options", async () => {
    execFileMock.mockResolvedValue({ stdout: "ok", stderr: "" });
    const controller = new AbortController();

    const result = await tfPlan(
      {
        cwd: "/tmp/tf",
        timeout: 42_000,
        signal: controller.signal,
        maxBufferBytes: 2048,
      },
      { varFile: "prod.tfvars" },
    );

    expect(result.success).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "terraform",
      expect.arrayContaining(["plan", "-input=false", "-no-color", "-var-file=prod.tfvars"]),
      expect.objectContaining({
        timeout: 42_000,
        signal: controller.signal,
        maxBuffer: 2048,
      }),
    );
  });

  it("returns classified not-found error", async () => {
    execFileMock.mockRejectedValue({ code: 127, stderr: "terraform: command not found" });

    const result = await tfPlan({ cwd: "/tmp/tf" });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe("not-found");
    expect(result.commandRedacted).toContain("terraform plan");
  });

  it("redacts sensitive values in command metadata", async () => {
    execFileMock.mockRejectedValue({ code: 1, stderr: "failed" });

    const result = await tfPlan(
      { cwd: "/tmp/tf" },
      { target: ["module.app"], varFile: "secrets.tfvars" },
    );

    expect(result.success).toBe(false);
    expect(result.commandRedacted).toContain("***");
  });
});
