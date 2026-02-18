/**
 * VCS extension types — providers, PRs, webhooks, configs.
 */

/* ---------- Provider ---------- */

export type VCSProvider = "github" | "gitlab" | "bitbucket";

/* ---------- Config ---------- */

export interface VCSConfig {
  provider: VCSProvider;
  token: string;
  owner: string;
  repo: string;
  webhookSecret?: string;
  baseUrl?: string; // For GitHub Enterprise / self-hosted GitLab
}

/* ---------- Pull Request ---------- */

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  branch: string;
  base: string;
  state: "open" | "closed" | "merged";
  changedFiles: string[];
  checks: CheckRun[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
  url?: string;
}

/* ---------- Commit ---------- */

export interface Commit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  filesChanged: string[];
}

/* ---------- Webhook ---------- */

export type WebhookEvent =
  | PushEvent
  | PullRequestEvent
  | CommentEvent;

export interface PushEvent {
  type: "push";
  ref: string;
  commits: Commit[];
  sender: string;
}

export interface PullRequestEvent {
  type: "pull_request";
  action: "opened" | "updated" | "merged" | "closed";
  pr: PullRequest;
  sender: string;
}

export interface CommentEvent {
  type: "comment";
  prNumber: number;
  body: string;
  author: string;
}

/* ---------- Review ---------- */

export type ReviewEvent = "approve" | "request_changes" | "comment";

export interface Review {
  id: number;
  author: string;
  event: ReviewEvent;
  body: string;
  submittedAt: string;
}

/* ---------- Status ---------- */

export type StatusState = "pending" | "success" | "error" | "failure";

export interface CommitStatus {
  sha: string;
  state: StatusState;
  context: string;
  description: string;
  targetUrl?: string;
}

/* ---------- VCS Client Interface ---------- */

export interface VCSClient {
  /** Create a new pull request. */
  createPR(title: string, body: string, branch: string, base: string): Promise<PullRequest>;

  /** Comment on a pull request. */
  commentOnPR(prNumber: number, body: string): Promise<void>;

  /** Add a review to a pull request. */
  addReview(prNumber: number, body: string, event: ReviewEvent): Promise<void>;

  /** Get changed files for a pull request. */
  getChangedFiles(prNumber: number): Promise<string[]>;

  /** List open pull requests. */
  listPRs(state?: "open" | "closed" | "all"): Promise<PullRequest[]>;

  /** Get a single pull request. */
  getPR(prNumber: number): Promise<PullRequest>;

  /** Set commit status. */
  setStatus(sha: string, state: StatusState, context: string, description: string, targetUrl?: string): Promise<void>;
}
