/**
 * VCS agent tools — vcs_create_pr, vcs_pr_status, vcs_comment, vcs_review.
 * Wired to real GitHub/GitLab clients.
 */

import { Type } from "@sinclair/typebox";
import type { VCSClient, VCSConfig } from "./types.js";
import { GitHubClient } from "./github.js";
import { GitLabClient } from "./gitlab.js";

/** Cached VCS config — set via `espada vcs configure` or `setVcsConfig()`. */
let vcsConfig: VCSConfig | null = null;

/** Inject VCS configuration (used by gateway, CLI, or tests). */
export function setVcsConfig(config: VCSConfig): void {
  vcsConfig = config;
}

/** Get the VCS client for the configured provider. */
function getClient(): VCSClient | null {
  if (!vcsConfig) return null;
  switch (vcsConfig.provider) {
    case "github":
      return new GitHubClient(vcsConfig);
    case "gitlab":
      return new GitLabClient(vcsConfig);
    default:
      return null;
  }
}

/** Helper to return a "not configured" response. */
function notConfigured() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "error",
          message: "VCS not configured. Run `espada vcs configure` or call setVcsConfig() first.",
        }),
      },
    ],
  };
}

export function createVcsTools() {
  return [vcsCreatePrTool, vcsPrStatusTool, vcsCommentTool, vcsReviewTool];
}

/* ---------- vcs_create_pr ---------- */

const vcsCreatePrTool = {
  name: "vcs_create_pr",
  description: "Create a pull request on GitHub or GitLab with IaC changes.",
  inputSchema: Type.Object({
    title: Type.String({ description: "PR title" }),
    body: Type.String({ description: "PR description body" }),
    branch: Type.String({ description: "Source branch name" }),
    base: Type.Optional(Type.String({ description: "Target branch (default: main)" })),
    provider: Type.Optional(Type.String({ description: "VCS provider: github or gitlab" })),
  }),
  execute: async (input: { title: string; body: string; branch: string; base?: string; provider?: string }) => {
    const client = getClient();
    if (!client) return notConfigured();

    try {
      const pr = await client.createPR(input.title, input.body, input.branch, input.base ?? "main");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "created",
              number: pr.number,
              url: pr.url,
              title: pr.title,
              branch: `${pr.branch} → ${pr.base}`,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  },
};

/* ---------- vcs_pr_status ---------- */

const vcsPrStatusTool = {
  name: "vcs_pr_status",
  description: "Get the status, checks, and reviews of a pull request.",
  inputSchema: Type.Object({
    prNumber: Type.Number({ description: "Pull request number" }),
    provider: Type.Optional(Type.String({ description: "VCS provider: github or gitlab" })),
  }),
  execute: async (input: { prNumber: number; provider?: string }) => {
    const client = getClient();
    if (!client) return notConfigured();

    try {
      const pr = await client.getPR(input.prNumber);
      const files = await client.getChangedFiles(input.prNumber);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "ok",
              number: pr.number,
              title: pr.title,
              state: pr.state,
              author: pr.author,
              branch: `${pr.branch} → ${pr.base}`,
              changedFiles: files,
              checks: pr.checks,
              url: pr.url,
              createdAt: pr.createdAt,
              updatedAt: pr.updatedAt,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  },
};

/* ---------- vcs_comment ---------- */

const vcsCommentTool = {
  name: "vcs_comment",
  description: "Post a comment on a pull request (e.g., plan output, policy results).",
  inputSchema: Type.Object({
    prNumber: Type.Number({ description: "Pull request number" }),
    body: Type.String({ description: "Comment body (Markdown supported)" }),
    provider: Type.Optional(Type.String({ description: "VCS provider: github or gitlab" })),
  }),
  execute: async (input: { prNumber: number; body: string; provider?: string }) => {
    const client = getClient();
    if (!client) return notConfigured();

    try {
      await client.commentOnPR(input.prNumber, input.body);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "posted",
              prNumber: input.prNumber,
              bodyLength: input.body.length,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  },
};

/* ---------- vcs_review ---------- */

const vcsReviewTool = {
  name: "vcs_review",
  description: "Submit a review on a pull request (approve, request changes, or comment).",
  inputSchema: Type.Object({
    prNumber: Type.Number({ description: "Pull request number" }),
    body: Type.String({ description: "Review body" }),
    event: Type.String({ description: "Review event: approve, request_changes, or comment" }),
    provider: Type.Optional(Type.String({ description: "VCS provider: github or gitlab" })),
  }),
  execute: async (input: { prNumber: number; body: string; event: string; provider?: string }) => {
    const client = getClient();
    if (!client) return notConfigured();

    try {
      const validEvents = ["approve", "request_changes", "comment"] as const;
      const event = validEvents.includes(input.event as typeof validEvents[number])
        ? (input.event as typeof validEvents[number])
        : "comment";

      await client.addReview(input.prNumber, input.body, event);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "submitted",
              prNumber: input.prNumber,
              event,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  },
};
