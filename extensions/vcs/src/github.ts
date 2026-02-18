/**
 * GitHub VCS client — implements VCSClient using GitHub REST API via fetch.
 * No external dependency (no Octokit) — uses native fetch.
 */

import type {
  VCSClient,
  VCSConfig,
  PullRequest,
  ReviewEvent,
  StatusState,
} from "./types.js";

export class GitHubClient implements VCSClient {
  private baseUrl: string;
  private token: string;
  private owner: string;
  private repo: string;

  constructor(config: VCSConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.github.com";
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${this.token}`,
    };
    if (body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${method} ${path}: ${res.status} ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  async createPR(title: string, body: string, branch: string, base: string): Promise<PullRequest> {
    const data = await this.request("POST", "/pulls", { title, body, head: branch, base }) as Record<string, unknown>;
    return this.mapPR(data);
  }

  async commentOnPR(prNumber: number, body: string): Promise<void> {
    await this.request("POST", `/issues/${prNumber}/comments`, { body });
  }

  async addReview(prNumber: number, body: string, event: ReviewEvent): Promise<void> {
    const ghEvent = event === "approve" ? "APPROVE" : event === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
    await this.request("POST", `/pulls/${prNumber}/reviews`, { body, event: ghEvent });
  }

  async getChangedFiles(prNumber: number): Promise<string[]> {
    const files = (await this.request("GET", `/pulls/${prNumber}/files`)) as Array<{ filename: string }>;
    return files.map((f) => f.filename);
  }

  async listPRs(state: "open" | "closed" | "all" = "open"): Promise<PullRequest[]> {
    const data = (await this.request("GET", `/pulls?state=${state}`)) as Array<Record<string, unknown>>;
    return data.map((d) => this.mapPR(d));
  }

  async getPR(prNumber: number): Promise<PullRequest> {
    const data = (await this.request("GET", `/pulls/${prNumber}`)) as Record<string, unknown>;
    return this.mapPR(data);
  }

  async setStatus(sha: string, state: StatusState, context: string, description: string, targetUrl?: string): Promise<void> {
    await this.request("POST", `/statuses/${sha}`, {
      state,
      context,
      description,
      target_url: targetUrl,
    });
  }

  async createCheckRun(sha: string, name: string, status: string, output?: { title: string; summary: string }): Promise<void> {
    await this.request("POST", "/check-runs", {
      name,
      head_sha: sha,
      status,
      output,
    });
  }

  private mapPR(data: Record<string, unknown>): PullRequest {
    const head = data.head as Record<string, unknown> | undefined;
    const base = data.base as Record<string, unknown> | undefined;
    const user = data.user as Record<string, unknown> | undefined;

    return {
      number: data.number as number,
      title: data.title as string,
      body: (data.body as string) ?? "",
      author: (user?.login as string) ?? "",
      branch: (head?.ref as string) ?? "",
      base: (base?.ref as string) ?? "",
      state: data.merged_at ? "merged" : (data.state as "open" | "closed"),
      changedFiles: [],
      checks: [],
      url: (data.html_url as string) ?? "",
      createdAt: (data.created_at as string) ?? "",
      updatedAt: (data.updated_at as string) ?? "",
    };
  }
}

/**
 * Verify a GitHub webhook signature (HMAC-SHA256).
 */
export async function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const { createHmac } = await import("node:crypto");
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return expected === signature;
}
