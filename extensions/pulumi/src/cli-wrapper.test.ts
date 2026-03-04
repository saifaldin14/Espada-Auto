import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { pulumiPreview, pulumiRunCommand, pulumiUp } from "./cli-wrapper.js";

function resolveWith(stdout: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout, stderr: "" });
    },
  );
}

beforeEach(() => {
  execFileMock.mockReset();
  resolveWith("ok");
});

describe("pulumi cli-wrapper", () => {
  it("builds preview args with stack", async () => {
    await pulumiPreview({ stack: "dev" });
    const args = execFileMock.mock.calls[0]?.[1] as string[];
    expect(args).toEqual(["preview", "--json", "--stack", "dev"]);
  });

  it("builds up args without stack", async () => {
    await pulumiUp();
    const args = execFileMock.mock.calls[0]?.[1] as string[];
    expect(args).toEqual(["up", "--yes", "--json"]);
  });

  it("passes timeout/signal/maxBuffer through to execFile", async () => {
    const controller = new AbortController();
    await pulumiPreview({
      timeoutMs: 25_000,
      signal: controller.signal,
      maxBufferBytes: 2048,
      cwd: "/tmp/project",
    });

    const callOpts = execFileMock.mock.calls[0]?.[2] as {
      timeout?: number;
      signal?: AbortSignal;
      maxBuffer?: number;
      cwd?: string;
      env?: Record<string, string>;
    };

    expect(callOpts.timeout).toBe(25_000);
    expect(callOpts.signal).toBe(controller.signal);
    expect(callOpts.maxBuffer).toBe(2048);
    expect(callOpts.cwd).toBe("/tmp/project");
    expect(callOpts.env?.PULUMI_SKIP_UPDATE_CHECK).toBe("1");
  });

  it("returns structured success result from pulumiRunCommand", async () => {
    resolveWith('{"status":"ok"}');
    const result = await pulumiRunCommand(["stack", "ls", "--json"]);
    expect(result.success).toBe(true);
    expect(result.command).toContain("pulumi stack ls --json");
  });

  it("classifies command-not-found in pulumiRunCommand", async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: { message: string; code: number }) => void) => {
        cb({ message: "pulumi: command not found", code: 127 });
      },
    );
    const result = await pulumiRunCommand(["stack", "ls", "--json"]);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("not-found");
  });

  it("redacts secrets in commandRedacted", async () => {
    resolveWith("ok");
    const result = await pulumiRunCommand(["login", "https://api.example", "--token", "super-secret"]);
    expect(result.command).toContain("super-secret");
    expect(result.commandRedacted).toContain("***");
  });
});
