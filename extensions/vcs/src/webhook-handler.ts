/**
 * VCS webhook event handler — parses incoming webhook payloads.
 */

import type {
  WebhookEvent,
  PushEvent,
  PullRequestEvent,
  CommentEvent,
  VCSProvider,
} from "./types.js";

/**
 * Parse a GitHub webhook payload into a WebhookEvent.
 */
export function parseGitHubWebhook(
  eventType: string,
  payload: Record<string, unknown>,
): WebhookEvent | null {
  switch (eventType) {
    case "push":
      return parseGitHubPush(payload);
    case "pull_request":
      return parseGitHubPullRequest(payload);
    case "issue_comment":
      return parseGitHubComment(payload);
    default:
      return null;
  }
}

function parseGitHubPush(payload: Record<string, unknown>): PushEvent {
  const commits = (payload.commits as Array<Record<string, unknown>> ?? []).map((c) => ({
    sha: c.id as string,
    message: c.message as string,
    author: ((c.author as Record<string, unknown>)?.username as string) ?? "",
    timestamp: c.timestamp as string,
    filesChanged: [
      ...((c.added as string[]) ?? []),
      ...((c.modified as string[]) ?? []),
      ...((c.removed as string[]) ?? []),
    ],
  }));

  return {
    type: "push",
    ref: payload.ref as string,
    commits,
    sender: ((payload.sender as Record<string, unknown>)?.login as string) ?? "",
  };
}

function parseGitHubPullRequest(payload: Record<string, unknown>): PullRequestEvent {
  const pr = payload.pull_request as Record<string, unknown>;
  const head = pr.head as Record<string, unknown>;
  const base = pr.base as Record<string, unknown>;
  const user = pr.user as Record<string, unknown>;

  return {
    type: "pull_request",
    action: payload.action as PullRequestEvent["action"],
    pr: {
      number: pr.number as number,
      title: pr.title as string,
      body: (pr.body as string) ?? "",
      author: (user?.login as string) ?? "",
      branch: (head?.ref as string) ?? "",
      base: (base?.ref as string) ?? "",
      state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
      changedFiles: [],
      checks: [],
      url: (pr.html_url as string) ?? "",
      createdAt: (pr.created_at as string) ?? "",
      updatedAt: (pr.updated_at as string) ?? "",
    },
    sender: ((payload.sender as Record<string, unknown>)?.login as string) ?? "",
  };
}

function parseGitHubComment(payload: Record<string, unknown>): CommentEvent {
  const comment = payload.comment as Record<string, unknown>;
  const issue = payload.issue as Record<string, unknown>;

  return {
    type: "comment",
    prNumber: issue.number as number,
    body: comment.body as string,
    author: ((comment.user as Record<string, unknown>)?.login as string) ?? "",
  };
}

/**
 * Parse a GitLab webhook payload into a WebhookEvent.
 */
export function parseGitLabWebhook(
  eventType: string,
  payload: Record<string, unknown>,
): WebhookEvent | null {
  switch (eventType) {
    case "Push Hook":
      return parseGitLabPush(payload);
    case "Merge Request Hook":
      return parseGitLabMergeRequest(payload);
    case "Note Hook":
      return parseGitLabNote(payload);
    default:
      return null;
  }
}

function parseGitLabPush(payload: Record<string, unknown>): PushEvent {
  const commits = (payload.commits as Array<Record<string, unknown>> ?? []).map((c) => ({
    sha: c.id as string,
    message: c.message as string,
    author: ((c.author as Record<string, unknown>)?.name as string) ?? "",
    timestamp: c.timestamp as string,
    filesChanged: [
      ...((c.added as string[]) ?? []),
      ...((c.modified as string[]) ?? []),
      ...((c.removed as string[]) ?? []),
    ],
  }));

  return {
    type: "push",
    ref: payload.ref as string,
    commits,
    sender: ((payload.user_username as string) ?? ""),
  };
}

function parseGitLabMergeRequest(payload: Record<string, unknown>): PullRequestEvent {
  const attrs = payload.object_attributes as Record<string, unknown>;
  const user = payload.user as Record<string, unknown>;

  const actionMap: Record<string, PullRequestEvent["action"]> = {
    open: "opened",
    update: "updated",
    merge: "merged",
    close: "closed",
  };

  return {
    type: "pull_request",
    action: actionMap[attrs.action as string] ?? "opened",
    pr: {
      number: attrs.iid as number,
      title: attrs.title as string,
      body: (attrs.description as string) ?? "",
      author: (user?.username as string) ?? "",
      branch: attrs.source_branch as string,
      base: attrs.target_branch as string,
      state: attrs.state === "merged" ? "merged" : attrs.state === "closed" ? "closed" : "open",
      changedFiles: [],
      checks: [],
      url: (attrs.url as string) ?? "",
      createdAt: (attrs.created_at as string) ?? "",
      updatedAt: (attrs.updated_at as string) ?? "",
    },
    sender: (user?.username as string) ?? "",
  };
}

function parseGitLabNote(payload: Record<string, unknown>): CommentEvent | null {
  const attrs = payload.object_attributes as Record<string, unknown>;
  const mr = payload.merge_request as Record<string, unknown> | undefined;
  if (!mr) return null;

  return {
    type: "comment",
    prNumber: mr.iid as number,
    body: attrs.note as string,
    author: ((payload.user as Record<string, unknown>)?.username as string) ?? "",
  };
}

/**
 * Check if any changed files match IaC file patterns.
 */
export function hasIaCChanges(files: string[]): boolean {
  const patterns = [
    /\.tf$/,
    /\.tfvars$/,
    /terragrunt\.hcl$/,
    /Pulumi\.(yaml|yml)$/,
    /\.k8s\.(yaml|yml)$/,
    /kustomization\.(yaml|yml)$/,
    /cloudformation\.(json|yaml|yml)$/,
    /\.template\.(json|yaml|yml)$/,
  ];

  return files.some((f) => patterns.some((p) => p.test(f)));
}

/**
 * Get the VCS provider from a webhook header.
 */
export function detectProvider(headers: Record<string, string>): VCSProvider | null {
  if (headers["x-github-event"]) return "github";
  if (headers["x-gitlab-event"]) return "gitlab";
  return null;
}
