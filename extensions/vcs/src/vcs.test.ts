import { describe, expect, it } from "vitest";
import {
  parseGitHubWebhook,
  parseGitLabWebhook,
  hasIaCChanges,
  detectProvider,
} from "./webhook-handler.js";
import { formatPlanComment } from "./plan-formatter.js";
import { verifyGitHubSignature } from "./github.js";
import { verifyGitLabToken } from "./gitlab.js";
import type { PlanCommentInput } from "./plan-formatter.js";

/* ================================================================
   GitHub webhook parsing
   ================================================================ */

describe("parseGitHubWebhook", () => {
  it("parses push event", () => {
    const event = parseGitHubWebhook("push", {
      ref: "refs/heads/main",
      commits: [
        {
          id: "abc123",
          message: "update infra",
          author: { username: "dev" },
          timestamp: "2024-01-01T00:00:00Z",
          added: ["main.tf"],
          modified: [],
          removed: [],
        },
      ],
      sender: { login: "dev" },
    });

    expect(event).not.toBeNull();
    const e = event!;
    expect(e.type).toBe("push");
    if (e.type === "push") {
      expect(e.ref).toBe("refs/heads/main");
      expect(e.commits).toHaveLength(1);
      expect(e.commits[0]!.sha).toBe("abc123");
      expect(e.commits[0]!.filesChanged).toContain("main.tf");
    }
  });

  it("parses pull_request event", () => {
    const event = parseGitHubWebhook("pull_request", {
      action: "opened",
      pull_request: {
        number: 42,
        title: "Add VPC",
        body: "New VPC config",
        user: { login: "author" },
        head: { ref: "feature/vpc" },
        base: { ref: "main" },
        state: "open",
        html_url: "https://github.com/org/repo/pull/42",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
      sender: { login: "author" },
    });

    expect(event).not.toBeNull();
    const e = event!;
    expect(e.type).toBe("pull_request");
    if (e.type === "pull_request") {
      expect(e.action).toBe("opened");
      expect(e.pr.number).toBe(42);
      expect(e.pr.branch).toBe("feature/vpc");
    }
  });

  it("parses issue_comment event", () => {
    const event = parseGitHubWebhook("issue_comment", {
      comment: { body: "LGTM", user: { login: "reviewer" } },
      issue: { number: 42 },
    });

    expect(event).not.toBeNull();
    const e = event!;
    expect(e.type).toBe("comment");
    if (e.type === "comment") {
      expect(e.prNumber).toBe(42);
      expect(e.body).toBe("LGTM");
    }
  });

  it("returns null for unknown event type", () => {
    expect(parseGitHubWebhook("unknown_event", {})).toBeNull();
  });
});

/* ================================================================
   GitLab webhook parsing
   ================================================================ */

describe("parseGitLabWebhook", () => {
  it("parses Push Hook", () => {
    const event = parseGitLabWebhook("Push Hook", {
      ref: "refs/heads/main",
      user_username: "dev",
      commits: [
        {
          id: "def456",
          message: "update infra",
          author: { name: "Dev" },
          timestamp: "2024-01-01T00:00:00Z",
          added: ["main.tf"],
          modified: [],
          removed: [],
        },
      ],
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe("push");
  });

  it("parses Merge Request Hook", () => {
    const event = parseGitLabWebhook("Merge Request Hook", {
      object_attributes: {
        iid: 10,
        title: "Add DB",
        description: "New database",
        action: "open",
        source_branch: "feature/db",
        target_branch: "main",
        state: "opened",
        url: "https://gitlab.com/org/repo/-/merge_requests/10",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      },
      user: { username: "dev" },
    });

    expect(event).not.toBeNull();
    const e = event!;
    expect(e.type).toBe("pull_request");
    if (e.type === "pull_request") {
      expect(e.pr.number).toBe(10);
      expect(e.action).toBe("opened");
    }
  });

  it("returns null for unknown event type", () => {
    expect(parseGitLabWebhook("Unknown Hook", {})).toBeNull();
  });
});

/* ================================================================
   hasIaCChanges
   ================================================================ */

describe("hasIaCChanges", () => {
  it("detects .tf files", () => {
    expect(hasIaCChanges(["README.md", "main.tf"])).toBe(true);
  });

  it("detects .tfvars files", () => {
    expect(hasIaCChanges(["prod.tfvars"])).toBe(true);
  });

  it("detects terragrunt.hcl", () => {
    expect(hasIaCChanges(["modules/vpc/terragrunt.hcl"])).toBe(true);
  });

  it("detects Pulumi.yaml", () => {
    expect(hasIaCChanges(["Pulumi.yaml"])).toBe(true);
  });

  it("detects kustomization.yaml", () => {
    expect(hasIaCChanges(["kustomization.yaml"])).toBe(true);
  });

  it("returns false for non-IaC files", () => {
    expect(hasIaCChanges(["README.md", "src/app.ts", "package.json"])).toBe(false);
  });

  it("returns false for empty list", () => {
    expect(hasIaCChanges([])).toBe(false);
  });
});

/* ================================================================
   detectProvider
   ================================================================ */

describe("detectProvider", () => {
  it("detects GitHub from headers", () => {
    expect(detectProvider({ "x-github-event": "push" })).toBe("github");
  });

  it("detects GitLab from headers", () => {
    expect(detectProvider({ "x-gitlab-event": "Push Hook" })).toBe("gitlab");
  });

  it("returns null for unknown headers", () => {
    expect(detectProvider({ "content-type": "application/json" })).toBeNull();
  });
});

/* ================================================================
   formatPlanComment
   ================================================================ */

describe("formatPlanComment", () => {
  it("formats empty plan", () => {
    const result = formatPlanComment({ actions: [] });
    expect(result).toContain("No changes detected");
  });

  it("formats plan with creates and deletes", () => {
    const input: PlanCommentInput = {
      actions: [
        { action: "create", resource: "aws_instance.web", type: "aws_instance" },
        { action: "delete", resource: "aws_iam_role.old", type: "aws_iam_role" },
      ],
    };
    const result = formatPlanComment(input);
    expect(result).toContain("## Terraform Plan");
    expect(result).toContain("+ Create");
    expect(result).toContain("- Delete");
    expect(result).toContain("1 to create");
    expect(result).toContain("1 to destroy");
  });

  it("includes cost delta when provided", () => {
    const result = formatPlanComment({
      actions: [{ action: "create", resource: "aws_instance.web", type: "aws_instance" }],
      costDelta: { current: 100, projected: 145.20, delta: 45.20 },
    });
    expect(result).toContain("+$45.20/month");
  });

  it("includes policy result when provided", () => {
    const result = formatPlanComment({
      actions: [{ action: "update", resource: "aws_s3_bucket.data", type: "aws_s3_bucket" }],
      policyResult: { passed: true, evaluated: 3, violations: [] },
    });
    expect(result).toContain("✅ Policy check: PASSED");
    expect(result).toContain("3 policies evaluated");
  });

  it("shows violations when policy fails", () => {
    const result = formatPlanComment({
      actions: [{ action: "create", resource: "aws_s3_bucket.pub", type: "aws_s3_bucket" }],
      policyResult: {
        passed: false,
        evaluated: 2,
        violations: ["deny-public-s3: Public S3 buckets are not allowed"],
      },
    });
    expect(result).toContain("❌ Policy check: FAILED");
    expect(result).toContain("deny-public-s3");
  });
});

/* ================================================================
   Signature verification
   ================================================================ */

describe("verifyGitHubSignature", () => {
  it("verifies valid HMAC-SHA256 signature", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = "test-secret";
    const payload = '{"action":"opened"}';
    const sig = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

    expect(await verifyGitHubSignature(payload, sig, secret)).toBe(true);
  });

  it("rejects invalid signature", async () => {
    expect(await verifyGitHubSignature("payload", "sha256=invalid", "secret")).toBe(false);
  });
});

describe("verifyGitLabToken", () => {
  it("matches correct token", () => {
    expect(verifyGitLabToken("my-secret", "my-secret")).toBe(true);
  });

  it("rejects wrong token", () => {
    expect(verifyGitLabToken("wrong", "my-secret")).toBe(false);
  });
});
