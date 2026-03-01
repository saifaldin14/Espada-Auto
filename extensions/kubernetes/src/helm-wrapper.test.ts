/**
 * Helm CLI wrapper — Unit Tests
 *
 * Mocks `node:child_process` execFile to verify that each wrapper function
 * builds the correct argument arrays and passes options through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------- mock setup ---------- */

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import {
  helmInstall,
  helmUpgrade,
  helmUninstall,
  helmList,
  helmStatus,
  helmRollback,
  helmHistory,
  helmGetValues,
  helmTemplate,
  helmRepoAdd,
  helmRepoUpdate,
  helmRepoList,
  helmSearchRepo,
} from "./helm-wrapper.js";

/* ---------- helpers ---------- */

/** Make execFileMock resolve with {stdout} via callback style used by promisify. */
function resolveWith(stdout: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout, stderr: "" });
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

/** Extract the binary name passed to execFile. */
function calledBinary(): string {
  return execFileMock.mock.calls[0][0];
}

beforeEach(() => {
  execFileMock.mockReset();
  resolveWith("ok");
});

/* ================================================================
   helmInstall
   ================================================================ */

describe("helmInstall", () => {
  it("builds basic args", async () => {
    await helmInstall("my-release", "bitnami/nginx");
    expect(calledBinary()).toBe("helm");
    expect(calledArgs()).toEqual(["install", "my-release", "bitnami/nginx"]);
  });

  it("appends namespace", async () => {
    await helmInstall("r", "chart", { namespace: "prod" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("prod");
  });

  it("appends values file", async () => {
    await helmInstall("r", "chart", { valuesFile: "/tmp/vals.yaml" });
    expect(calledArgs()).toContain("-f");
    expect(calledArgs()).toContain("/tmp/vals.yaml");
  });

  it("appends --set pairs", async () => {
    await helmInstall("r", "chart", { setValues: { "image.tag": "v2", replicas: "3" } });
    const args = calledArgs();
    expect(args).toContain("--set");
    expect(args).toContain("image.tag=v2");
    expect(args).toContain("replicas=3");
  });

  it("appends version", async () => {
    await helmInstall("r", "chart", { version: "1.2.3" });
    expect(calledArgs()).toContain("--version");
    expect(calledArgs()).toContain("1.2.3");
  });

  it("appends --wait and --timeout", async () => {
    await helmInstall("r", "chart", { wait: true, timeout: "5m0s" });
    expect(calledArgs()).toContain("--wait");
    expect(calledArgs()).toContain("--timeout");
    expect(calledArgs()).toContain("5m0s");
  });

  it("appends --create-namespace", async () => {
    await helmInstall("r", "chart", { createNamespace: true });
    expect(calledArgs()).toContain("--create-namespace");
  });

  it("appends --dry-run", async () => {
    await helmInstall("r", "chart", { dryRun: true });
    expect(calledArgs()).toContain("--dry-run");
  });

  it("appends --generate-name and removes release from args", async () => {
    await helmInstall("chart-only", "bitnami/nginx", { generateName: true });
    const args = calledArgs();
    expect(args).toContain("--generate-name");
    // release name should be removed, only chart remains after "install"
    expect(args[1]).toBe("bitnami/nginx");
  });

  it("appends --description", async () => {
    await helmInstall("r", "chart", { description: "initial deploy" });
    expect(calledArgs()).toContain("--description");
    expect(calledArgs()).toContain("initial deploy");
  });

  it("appends kubeContext and kubeconfig", async () => {
    await helmInstall("r", "chart", { kubeContext: "staging", kubeconfig: "/tmp/kc" });
    const args = calledArgs();
    expect(args).toContain("--kube-context");
    expect(args).toContain("staging");
    expect(args).toContain("--kubeconfig");
    expect(args).toContain("/tmp/kc");
  });

  it("rejects on error", async () => {
    rejectWithError("chart not found");
    await expect(helmInstall("r", "bad-chart")).rejects.toThrow("chart not found");
  });
});

/* ================================================================
   helmUpgrade
   ================================================================ */

describe("helmUpgrade", () => {
  it("builds basic args", async () => {
    await helmUpgrade("my-release", "bitnami/nginx");
    expect(calledArgs()).toEqual(["upgrade", "my-release", "bitnami/nginx"]);
  });

  it("appends --install", async () => {
    await helmUpgrade("r", "chart", { install: true });
    expect(calledArgs()).toContain("--install");
  });

  it("appends --force", async () => {
    await helmUpgrade("r", "chart", { force: true });
    expect(calledArgs()).toContain("--force");
  });

  it("appends --reset-values", async () => {
    await helmUpgrade("r", "chart", { resetValues: true });
    expect(calledArgs()).toContain("--reset-values");
  });

  it("appends --reuse-values", async () => {
    await helmUpgrade("r", "chart", { reuseValues: true });
    expect(calledArgs()).toContain("--reuse-values");
  });

  it("appends shared install flags (values, version, wait)", async () => {
    await helmUpgrade("r", "chart", {
      valuesFile: "/tmp/v.yaml",
      version: "2.0.0",
      wait: true,
      timeout: "3m",
    });
    const args = calledArgs();
    expect(args).toContain("-f");
    expect(args).toContain("/tmp/v.yaml");
    expect(args).toContain("--version");
    expect(args).toContain("2.0.0");
    expect(args).toContain("--wait");
    expect(args).toContain("--timeout");
    expect(args).toContain("3m");
  });
});

/* ================================================================
   helmUninstall
   ================================================================ */

describe("helmUninstall", () => {
  it("builds basic args", async () => {
    await helmUninstall("my-release");
    expect(calledArgs()).toEqual(["uninstall", "my-release"]);
  });

  it("appends --keep-history", async () => {
    await helmUninstall("r", { keepHistory: true });
    expect(calledArgs()).toContain("--keep-history");
  });

  it("appends --wait and --timeout", async () => {
    await helmUninstall("r", { wait: true, timeout: "2m" });
    expect(calledArgs()).toContain("--wait");
    expect(calledArgs()).toContain("--timeout");
    expect(calledArgs()).toContain("2m");
  });

  it("appends --dry-run", async () => {
    await helmUninstall("r", { dryRun: true });
    expect(calledArgs()).toContain("--dry-run");
  });

  it("appends namespace", async () => {
    await helmUninstall("r", { namespace: "staging" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("staging");
  });
});

/* ================================================================
   helmList
   ================================================================ */

describe("helmList", () => {
  it("builds basic args and parses JSON", async () => {
    const releases = [{ name: "web", namespace: "default", revision: "1", updated: "", status: "deployed", chart: "nginx-1.0", app_version: "1.0" }];
    resolveWith(JSON.stringify(releases));
    const result = await helmList();
    expect(calledArgs()).toEqual(["list", "-o", "json"]);
    expect(result).toEqual(releases);
  });

  it("appends --all-namespaces", async () => {
    resolveWith("[]");
    await helmList({ allNamespaces: true });
    expect(calledArgs()).toContain("--all-namespaces");
  });

  it("appends --filter", async () => {
    resolveWith("[]");
    await helmList({ filter: "web.*" });
    expect(calledArgs()).toContain("--filter");
    expect(calledArgs()).toContain("web.*");
  });
});

/* ================================================================
   helmStatus
   ================================================================ */

describe("helmStatus", () => {
  it("builds correct args", async () => {
    await helmStatus("my-release");
    expect(calledArgs()).toEqual(["status", "my-release", "-o", "json"]);
  });

  it("appends namespace", async () => {
    await helmStatus("r", { namespace: "prod" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("prod");
  });
});

/* ================================================================
   helmRollback
   ================================================================ */

describe("helmRollback", () => {
  it("builds basic args", async () => {
    await helmRollback("my-release", 2);
    expect(calledArgs()).toEqual(["rollback", "my-release", "2"]);
  });

  it("appends --wait", async () => {
    await helmRollback("r", 1, { wait: true });
    expect(calledArgs()).toContain("--wait");
  });

  it("appends --timeout", async () => {
    await helmRollback("r", 1, { timeout: "3m" });
    expect(calledArgs()).toContain("--timeout");
    expect(calledArgs()).toContain("3m");
  });

  it("appends --force", async () => {
    await helmRollback("r", 1, { force: true });
    expect(calledArgs()).toContain("--force");
  });

  it("appends namespace", async () => {
    await helmRollback("r", 1, { namespace: "prod" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("prod");
  });
});

/* ================================================================
   helmHistory
   ================================================================ */

describe("helmHistory", () => {
  it("builds correct args and parses JSON", async () => {
    const history = [{ revision: 1, updated: "2024-01-01", status: "deployed", chart: "nginx-1.0", app_version: "1.0", description: "Install complete" }];
    resolveWith(JSON.stringify(history));
    const result = await helmHistory("my-release");
    expect(calledArgs()).toEqual(["history", "my-release", "-o", "json"]);
    expect(result).toEqual(history);
  });

  it("appends namespace", async () => {
    resolveWith("[]");
    await helmHistory("r", { namespace: "staging" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("staging");
  });
});

/* ================================================================
   helmGetValues
   ================================================================ */

describe("helmGetValues", () => {
  it("builds correct args and parses JSON", async () => {
    const values = { replicaCount: 3, image: { tag: "v2" } };
    resolveWith(JSON.stringify(values));
    const result = await helmGetValues("my-release");
    expect(calledArgs()).toEqual(["get", "values", "my-release", "-o", "json"]);
    expect(result).toEqual(values);
  });

  it("appends --all for all values", async () => {
    resolveWith("{}");
    await helmGetValues("r", { allValues: true });
    expect(calledArgs()).toContain("--all");
  });

  it("appends namespace", async () => {
    resolveWith("{}");
    await helmGetValues("r", { namespace: "prod" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("prod");
  });
});

/* ================================================================
   helmTemplate
   ================================================================ */

describe("helmTemplate", () => {
  it("builds basic args", async () => {
    await helmTemplate("my-release", "bitnami/nginx");
    expect(calledArgs()).toEqual(["template", "my-release", "bitnami/nginx"]);
  });

  it("appends values file", async () => {
    await helmTemplate("r", "chart", { valuesFile: "/tmp/vals.yaml" });
    expect(calledArgs()).toContain("-f");
    expect(calledArgs()).toContain("/tmp/vals.yaml");
  });

  it("appends --set pairs", async () => {
    await helmTemplate("r", "chart", { setValues: { "image.tag": "v3" } });
    const args = calledArgs();
    expect(args).toContain("--set");
    expect(args).toContain("image.tag=v3");
  });

  it("appends --version", async () => {
    await helmTemplate("r", "chart", { version: "1.0.0" });
    expect(calledArgs()).toContain("--version");
    expect(calledArgs()).toContain("1.0.0");
  });

  it("appends --show-only for multiple templates", async () => {
    await helmTemplate("r", "chart", { showOnly: ["templates/deployment.yaml", "templates/service.yaml"] });
    const args = calledArgs();
    expect(args.filter((a) => a === "--show-only").length).toBe(2);
    expect(args).toContain("templates/deployment.yaml");
    expect(args).toContain("templates/service.yaml");
  });

  it("appends namespace", async () => {
    await helmTemplate("r", "chart", { namespace: "staging" });
    expect(calledArgs()).toContain("--namespace");
    expect(calledArgs()).toContain("staging");
  });
});

/* ================================================================
   helmRepoAdd
   ================================================================ */

describe("helmRepoAdd", () => {
  it("builds basic args", async () => {
    await helmRepoAdd("bitnami", "https://charts.bitnami.com/bitnami");
    expect(calledArgs()).toEqual(["repo", "add", "bitnami", "https://charts.bitnami.com/bitnami"]);
  });

  it("appends --force-update", async () => {
    await helmRepoAdd("bitnami", "https://charts.bitnami.com/bitnami", { forceUpdate: true });
    expect(calledArgs()).toContain("--force-update");
  });
});

/* ================================================================
   helmRepoUpdate
   ================================================================ */

describe("helmRepoUpdate", () => {
  it("builds correct args", async () => {
    await helmRepoUpdate();
    expect(calledArgs()).toEqual(["repo", "update"]);
  });
});

/* ================================================================
   helmRepoList
   ================================================================ */

describe("helmRepoList", () => {
  it("builds correct args and parses JSON", async () => {
    const repos = [{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }];
    resolveWith(JSON.stringify(repos));
    const result = await helmRepoList();
    expect(calledArgs()).toEqual(["repo", "list", "-o", "json"]);
    expect(result).toEqual(repos);
  });
});

/* ================================================================
   helmSearchRepo
   ================================================================ */

describe("helmSearchRepo", () => {
  it("builds basic args and parses JSON", async () => {
    const results = [{ name: "bitnami/nginx", chart_version: "15.0.0", app_version: "1.25.0", description: "NGINX web server" }];
    resolveWith(JSON.stringify(results));
    const result = await helmSearchRepo("nginx");
    expect(calledArgs()).toEqual(["search", "repo", "nginx", "-o", "json"]);
    expect(result).toEqual(results);
  });

  it("appends --version constraint", async () => {
    resolveWith("[]");
    await helmSearchRepo("nginx", { version: ">1.0.0" });
    expect(calledArgs()).toContain("--version");
    expect(calledArgs()).toContain(">1.0.0");
  });

  it("appends --versions flag", async () => {
    resolveWith("[]");
    await helmSearchRepo("nginx", { versions: true });
    expect(calledArgs()).toContain("--versions");
  });
});

/* ================================================================
   Global options pass-through
   ================================================================ */

describe("HelmGlobalOptions pass-through", () => {
  it("passes kubeconfig to any wrapper", async () => {
    await helmUninstall("r", { kubeconfig: "/home/user/.kube/staging" });
    expect(calledArgs()).toContain("--kubeconfig");
    expect(calledArgs()).toContain("/home/user/.kube/staging");
  });

  it("passes kube-context to any wrapper", async () => {
    resolveWith("{}");
    await helmGetValues("r", { kubeContext: "my-ctx" });
    expect(calledArgs()).toContain("--kube-context");
    expect(calledArgs()).toContain("my-ctx");
  });

  it("sets maxBuffer on execFile options", async () => {
    await helmInstall("r", "chart");
    const opts = execFileMock.mock.calls[0][2];
    expect(opts.maxBuffer).toBe(50 * 1024 * 1024);
  });
});
