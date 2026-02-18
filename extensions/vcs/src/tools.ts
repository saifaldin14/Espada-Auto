/**
 * VCS agent tools — vcs_create_pr, vcs_pr_status, vcs_comment, vcs_review.
 */

import { Type } from "@sinclair/typebox";

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
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ready",
            message: `PR "${input.title}" prepared for branch ${input.branch} → ${input.base ?? "main"}`,
            note: "Use VCS client (GitHub/GitLab) to submit. Configure via `espada vcs configure`.",
          }),
        },
      ],
    };
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
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ready",
            message: `Query PR #${input.prNumber} status. Configure VCS client first via \`espada vcs configure\`.`,
          }),
        },
      ],
    };
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
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ready",
            message: `Comment for PR #${input.prNumber} prepared (${input.body.length} chars). Use VCS client to post.`,
          }),
        },
      ],
    };
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
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ready",
            message: `Review (${input.event}) prepared for PR #${input.prNumber}. Use VCS client to submit.`,
          }),
        },
      ],
    };
  },
};
