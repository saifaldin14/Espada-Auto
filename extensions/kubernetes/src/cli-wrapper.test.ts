/**
 * kubectl CLI wrapper — Unit Tests
 *
 * Mocks `node:child_process` execFile to verify that each wrapper function
 * builds the correct argument arrays and passes options through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------- mock setup ---------- */

// vi.hoisted ensures the variable is initialized before the vi.mock factory runs
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

// After vi.mock we can import — vitest hoists the mock automatically
import {
  kubectlApplyDryRun,
  kubectlApply,
  kubectlGet,
  kubectlDiff,
  kubectlDescribe,
  kubectlRolloutStatus,
  kubectlGetNamespaces,
  kubectlDelete,
  kubectlLogs,
  kubectlScale,
  kubectlRolloutRestart,
  kubectlRolloutUndo,
  kubectlRolloutHistory,
} from "./cli-wrapper.js";

/* ---------- helpers ---------- */

/** Make execFileMock resolve with {stdout} via callback style used by promisify. */
function resolveWith(stdout: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout, stderr: "" });
    },
  );
}

/** Make execFileMock reject with an error that has a `stdout` property (like kubectl diff exit 1). */
function rejectWithStdout(stdout: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: { stdout: string }) => void) => {
      cb({ stdout });
    },
  );
}

/** Make execFileMock reject with a plain error. */
function rejectWithError(message: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error(message));
    },
  );
}

/** Extract the args array passed to execFile. */
function calledArgs(): string[] {
  return execFileMock.mock.calls[0][1];
}

beforeEach(() => {
  execFileMock.mockReset();
  resolveWith("ok");
});

/* ================================================================
   Existing wrapper functions (regression tests)
   ================================================================ */

describe("kubectlApplyDryRun", () => {
  it("builds correct args", async () => {
    await kubectlApplyDryRun("/tmp/manifest.yaml");
    expect(calledArgs()).toEqual(["apply", "-f", "/tmp/manifest.yaml", "--dry-run=server", "-o", "json"]);
  });

  it("appends namespace when provided", async () => {
    await kubectlApplyDryRun("/tmp/m.yaml", { namespace: "prod" });
    expect(calledArgs()).toContain("-n");
    expect(calledArgs()).toContain("prod");
  });
});

describe("kubectlApply", () => {
  it("builds correct args", async () => {
    await kubectlApply("/tmp/manifest.yaml");
    expect(calledArgs()).toEqual(["apply", "-f", "/tmp/manifest.yaml"]);
  });
});

describe("kubectlGet", () => {
  it("builds basic args", async () => {
    await kubectlGet("pods");
    expect(calledArgs()).toEqual(["get", "pods", "-o", "json"]);
  });

  it("inserts name when provided", async () => {
    await kubectlGet("pods", { name: "my-pod" });
    expect(calledArgs()).toContain("my-pod");
    // name goes before -o json
    const idx = calledArgs().indexOf("my-pod");
    expect(idx).toBeLessThan(calledArgs().indexOf("-o"));
  });

  it("passes --all-namespaces", async () => {
    await kubectlGet("pods", { allNamespaces: true });
    expect(calledArgs()).toContain("--all-namespaces");
  });
});

describe("kubectlDiff", () => {
  it("returns stdout on success (no diff)", async () => {
    resolveWith("");
    const result = await kubectlDiff("/tmp/m.yaml");
    expect(result).toBe("");
  });

  it("returns stdout when kubectl exits 1 (diff found)", async () => {
    rejectWithStdout("--- a/v1\n+++ b/v1\n-old\n+new");
    const result = await kubectlDiff("/tmp/m.yaml");
    expect(result).toContain("+new");
  });

  it("re-throws errors without stdout", async () => {
    rejectWithError("connection refused");
    await expect(kubectlDiff("/tmp/m.yaml")).rejects.toThrow("connection refused");
  });
});

describe("kubectlDescribe", () => {
  it("builds correct args", async () => {
    await kubectlDescribe("pod", "my-pod");
    expect(calledArgs()).toEqual(["describe", "pod", "my-pod"]);
  });
});

describe("kubectlRolloutStatus", () => {
  it("builds correct args", async () => {
    await kubectlRolloutStatus("deployment", "web");
    expect(calledArgs()).toEqual(["rollout", "status", "deployment/web"]);
  });
});

describe("kubectlGetNamespaces", () => {
  it("builds correct args", async () => {
    await kubectlGetNamespaces();
    expect(calledArgs()).toEqual(["get", "namespaces", "-o", "json"]);
  });
});

/* ================================================================
   New wrapper functions
   ================================================================ */

describe("kubectlDelete", () => {
  it("builds basic args", async () => {
    await kubectlDelete("deployment", "web");
    expect(calledArgs()).toEqual(["delete", "deployment", "web"]);
  });

  it("adds --force when requested", async () => {
    await kubectlDelete("pod", "stuck-pod", { force: true });
    expect(calledArgs()).toContain("--force");
  });

  it("adds --grace-period when provided", async () => {
    await kubectlDelete("pod", "stuck-pod", { gracePeriod: 0 });
    expect(calledArgs()).toContain("--grace-period=0");
  });

  it("combines force and gracePeriod", async () => {
    await kubectlDelete("pod", "p", { force: true, gracePeriod: 0 });
    const args = calledArgs();
    expect(args).toContain("--force");
    expect(args).toContain("--grace-period=0");
  });

  it("appends namespace and context", async () => {
    await kubectlDelete("svc", "api", { namespace: "staging", context: "my-ctx" });
    const args = calledArgs();
    expect(args).toContain("-n");
    expect(args).toContain("staging");
    expect(args).toContain("--context");
    expect(args).toContain("my-ctx");
  });
});

describe("kubectlLogs", () => {
  it("builds basic args", async () => {
    await kubectlLogs("web-abc-123");
    expect(calledArgs()).toEqual(["logs", "web-abc-123"]);
  });

  it("adds -c for container", async () => {
    await kubectlLogs("web-abc", { container: "sidecar" });
    expect(calledArgs()).toContain("-c");
    expect(calledArgs()).toContain("sidecar");
  });

  it("adds --previous", async () => {
    await kubectlLogs("web-abc", { previous: true });
    expect(calledArgs()).toContain("--previous");
  });

  it("adds --tail", async () => {
    await kubectlLogs("web-abc", { tail: 50 });
    expect(calledArgs()).toContain("--tail=50");
  });

  it("adds --since", async () => {
    await kubectlLogs("web-abc", { since: "5m" });
    expect(calledArgs()).toContain("--since=5m");
  });

  it("adds --since-time", async () => {
    await kubectlLogs("web-abc", { sinceTime: "2024-01-15T10:00:00Z" });
    expect(calledArgs()).toContain("--since-time=2024-01-15T10:00:00Z");
  });

  it("adds --timestamps", async () => {
    await kubectlLogs("web-abc", { timestamps: true });
    expect(calledArgs()).toContain("--timestamps");
  });

  it("does NOT add --follow even if passed in options", async () => {
    // follow exists on the interface but is intentionally never pushed to args
    await kubectlLogs("web-abc", { follow: true } as any);
    expect(calledArgs()).not.toContain("--follow");
    expect(calledArgs()).not.toContain("-f");
  });

  it("combines multiple options", async () => {
    await kubectlLogs("web-abc", {
      container: "app",
      tail: 100,
      since: "1h",
      timestamps: true,
      namespace: "prod",
    });
    const args = calledArgs();
    expect(args).toContain("-c");
    expect(args).toContain("app");
    expect(args).toContain("--tail=100");
    expect(args).toContain("--since=1h");
    expect(args).toContain("--timestamps");
    expect(args).toContain("-n");
    expect(args).toContain("prod");
  });
});

describe("kubectlScale", () => {
  it("builds correct args", async () => {
    await kubectlScale("deployment", "web", 5);
    expect(calledArgs()).toEqual(["scale", "deployment/web", "--replicas=5"]);
  });

  it("works with statefulset", async () => {
    await kubectlScale("statefulset", "db", 3, { namespace: "prod" });
    const args = calledArgs();
    expect(args[0]).toBe("scale");
    expect(args[1]).toBe("statefulset/db");
    expect(args[2]).toBe("--replicas=3");
    expect(args).toContain("-n");
    expect(args).toContain("prod");
  });

  it("scales to zero", async () => {
    await kubectlScale("deployment", "web", 0);
    expect(calledArgs()).toContain("--replicas=0");
  });
});

describe("kubectlRolloutRestart", () => {
  it("builds correct args", async () => {
    await kubectlRolloutRestart("deployment", "web");
    expect(calledArgs()).toEqual(["rollout", "restart", "deployment/web"]);
  });

  it("appends namespace", async () => {
    await kubectlRolloutRestart("deployment", "web", { namespace: "staging" });
    expect(calledArgs()).toContain("-n");
    expect(calledArgs()).toContain("staging");
  });
});

describe("kubectlRolloutUndo", () => {
  it("builds basic args (previous revision)", async () => {
    await kubectlRolloutUndo("deployment", "web");
    expect(calledArgs()).toEqual(["rollout", "undo", "deployment/web"]);
  });

  it("adds --to-revision when specified", async () => {
    await kubectlRolloutUndo("deployment", "web", { toRevision: 3 });
    expect(calledArgs()).toContain("--to-revision=3");
  });

  it("appends namespace and context", async () => {
    await kubectlRolloutUndo("deployment", "web", { namespace: "prod", context: "prod-ctx" });
    const args = calledArgs();
    expect(args).toContain("-n");
    expect(args).toContain("prod");
    expect(args).toContain("--context");
    expect(args).toContain("prod-ctx");
  });
});

describe("kubectlRolloutHistory", () => {
  it("builds basic args", async () => {
    await kubectlRolloutHistory("deployment", "web");
    expect(calledArgs()).toEqual(["rollout", "history", "deployment/web"]);
  });

  it("adds --revision when specified", async () => {
    await kubectlRolloutHistory("deployment", "web", { revision: 2 });
    expect(calledArgs()).toContain("--revision=2");
  });
});

/* ================================================================
   Common KubectlOptions pass-through
   ================================================================ */

describe("KubectlOptions pass-through", () => {
  it("passes kubeconfig to any wrapper", async () => {
    await kubectlDelete("pod", "x", { kubeconfig: "/home/user/.kube/staging" });
    expect(calledArgs()).toContain("--kubeconfig");
    expect(calledArgs()).toContain("/home/user/.kube/staging");
  });

  it("merges env into process.env", async () => {
    await kubectlScale("deployment", "web", 1, { env: { KUBECONFIG: "/tmp/kc" } });
    const opts = execFileMock.mock.calls[0][2];
    expect(opts.env.KUBECONFIG).toBe("/tmp/kc");
  });
});
