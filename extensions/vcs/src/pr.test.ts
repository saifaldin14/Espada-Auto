/**
 * VCS — PR / Plan Formatter Tests
 *
 * Covers: formatPlanComment edge cases, GitHubClient PR mapping,
 * status checks, and plan rendering variations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatPlanComment } from "./plan-formatter.js";
import type { PlanCommentInput } from "./plan-formatter.js";
import { GitHubClient } from "./github.js";
import type { VCSConfig } from "./types.js";

// ── formatPlanComment ────────────────────────────────────────────

describe("formatPlanComment — extended", () => {
  it("formats plan with only updates", () => {
    const input: PlanCommentInput = {
      actions: [
        { action: "update", resource: "aws_instance.web", type: "aws_instance" },
        { action: "update", resource: "aws_security_group.web", type: "aws_security_group" },
      ],
    };
    const result = formatPlanComment(input);
    expect(result).toContain("~ Update");
    expect(result).toContain("2 to update");
    expect(result).not.toContain("to create");
    expect(result).not.toContain("to destroy");
  });

  it("formats plan with replace actions", () => {
    const input: PlanCommentInput = {
      actions: [
        { action: "replace", resource: "aws_instance.app", type: "aws_instance" },
      ],
    };
    const result = formatPlanComment(input);
    expect(result).toContain("± Replace");
    expect(result).toContain("1 to replace");
  });

  it("formats plan with all action types", () => {
    const input: PlanCommentInput = {
      actions: [
        { action: "create", resource: "aws_s3_bucket.new", type: "aws_s3_bucket" },
        { action: "update", resource: "aws_instance.web", type: "aws_instance" },
        { action: "delete", resource: "aws_iam_role.old", type: "aws_iam_role" },
        { action: "replace", resource: "aws_db_instance.main", type: "aws_db_instance" },
      ],
    };
    const result = formatPlanComment(input);
    expect(result).toContain("1 to create");
    expect(result).toContain("1 to update");
    expect(result).toContain("1 to destroy");
    expect(result).toContain("1 to replace");
  });

  it("shows negative cost delta", () => {
    const result = formatPlanComment({
      actions: [{ action: "delete", resource: "aws_instance.old", type: "aws_instance" }],
      costDelta: { current: 200, projected: 150, delta: -50 },
    });
    expect(result).toContain("$-50.00/month");
    expect(result).not.toContain("+$");
  });

  it("shows zero cost delta", () => {
    const result = formatPlanComment({
      actions: [{ action: "update", resource: "aws_instance.web", type: "aws_instance" }],
      costDelta: { current: 100, projected: 100, delta: 0 },
    });
    expect(result).toContain("+$0.00/month");
  });

  it("shows passed policy with zero violations", () => {
    const result = formatPlanComment({
      actions: [{ action: "create", resource: "aws_vpc.main", type: "aws_vpc" }],
      policyResult: { passed: true, evaluated: 5, violations: [] },
    });
    expect(result).toContain("✅ Policy check: PASSED");
    expect(result).toContain("5 policies evaluated");
    expect(result).not.toContain("Violations");
  });

  it("renders multiple violations", () => {
    const result = formatPlanComment({
      actions: [{ action: "create", resource: "aws_s3_bucket.pub", type: "aws_s3_bucket" }],
      policyResult: {
        passed: false,
        evaluated: 3,
        violations: [
          "deny-public-s3: No public buckets",
          "require-encryption: Must encrypt at rest",
        ],
      },
    });
    expect(result).toContain("❌ Policy check: FAILED");
    expect(result).toContain("deny-public-s3");
    expect(result).toContain("require-encryption");
  });

  it("contains markdown table headers", () => {
    const result = formatPlanComment({
      actions: [{ action: "create", resource: "aws_vpc.main", type: "aws_vpc" }],
    });
    expect(result).toContain("| Action | Resource | Type |");
    expect(result).toContain("|--------|----------|------|");
  });

  it("includes resource names in table rows", () => {
    const result = formatPlanComment({
      actions: [{ action: "create", resource: "module.network.aws_vpc.main", type: "aws_vpc" }],
    });
    expect(result).toContain("module.network.aws_vpc.main");
    expect(result).toContain("aws_vpc");
  });
});

// ── GitHubClient PR methods ──────────────────────────────────────

describe("GitHubClient", () => {
  const config: VCSConfig = {
    provider: "github",
    token: "ghp_test_token",
    owner: "test-org",
    repo: "test-repo",
    baseUrl: "https://api.github.com",
  };

  function mockFetch(response: unknown, status = 200) {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    });
  }

  it("createPR sends correct payload and maps response", async () => {
    const prData = {
      number: 99,
      title: "Add VPC",
      body: "VPC config",
      user: { login: "dev" },
      head: { ref: "feature/vpc" },
      base: { ref: "main" },
      state: "open",
      html_url: "https://github.com/test-org/test-repo/pull/99",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    const fetchMock = mockFetch(prData);
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient(config);
    const pr = await client.createPR("Add VPC", "VPC config", "feature/vpc", "main");

    expect(pr.number).toBe(99);
    expect(pr.title).toBe("Add VPC");
    expect(pr.branch).toBe("feature/vpc");
    expect(pr.base).toBe("main");
    expect(pr.state).toBe("open");
    expect(pr.author).toBe("dev");

    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/test-org/test-repo/pulls");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      title: "Add VPC",
      body: "VPC config",
      head: "feature/vpc",
      base: "main",
    });

    vi.unstubAllGlobals();
  });

  it("setStatus sends correct state and context", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient(config);
    await client.setStatus("abc123", "success", "espada/plan", "Plan succeeded", "https://example.com/run/1");

    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/test-org/test-repo/statuses/abc123");
    const body = JSON.parse(opts.body);
    expect(body.state).toBe("success");
    expect(body.context).toBe("espada/plan");
    expect(body.description).toBe("Plan succeeded");
    expect(body.target_url).toBe("https://example.com/run/1");

    vi.unstubAllGlobals();
  });

  it("commentOnPR posts to correct issue endpoint", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient(config);
    await client.commentOnPR(42, "Plan output looks good");

    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/test-org/test-repo/issues/42/comments");
    expect(JSON.parse(opts.body)).toEqual({ body: "Plan output looks good" });

    vi.unstubAllGlobals();
  });

  it("throws on API error", async () => {
    const fetchMock = mockFetch({ message: "Not Found" }, 404);
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient(config);
    await expect(client.getPR(999)).rejects.toThrow("GitHub API GET /pulls/999: 404");

    vi.unstubAllGlobals();
  });

  it("maps merged_at to merged state", async () => {
    const prData = {
      number: 10,
      title: "Merged PR",
      body: "",
      user: { login: "dev" },
      head: { ref: "feat" },
      base: { ref: "main" },
      state: "closed",
      merged_at: "2025-01-02T00:00:00Z",
      html_url: "https://github.com/test-org/test-repo/pull/10",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    };
    const fetchMock = mockFetch(prData);
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient(config);
    const pr = await client.getPR(10);
    expect(pr.state).toBe("merged");

    vi.unstubAllGlobals();
  });
});
