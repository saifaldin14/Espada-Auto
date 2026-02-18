/**
 * GitLab VCS client — implements VCSClient using GitLab REST API via fetch.
 * No external dependency (no @gitbeaker) — uses native fetch.
 */

import type {
  VCSClient,
  VCSConfig,
  PullRequest,
  ReviewEvent,
  StatusState,
} from "./types.js";

export class GitLabClient implements VCSClient {
  private baseUrl: string;
  private token: string;
  private projectPath: string; // owner/repo URL-encoded

  constructor(config: VCSConfig) {
    this.baseUrl = config.baseUrl ?? "https://gitlab.com";
    this.token = config.token;
    this.projectPath = encodeURIComponent(`${config.owner}/${config.repo}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}/api/v4/projects/${this.projectPath}${path}`;
    const headers: Record<string, string> = {
      "Private-Token": this.token,
    };
    if (body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitLab API ${method} ${path}: ${res.status} ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  async createPR(title: string, body: string, branch: string, base: string): Promise<PullRequest> {
    const data = (await this.request("POST", "/merge_requests", {
      title,
      description: body,
      source_branch: branch,
      target_branch: base,
    })) as Record<string, unknown>;
    return this.mapMR(data);
  }

  async commentOnPR(prNumber: number, body: string): Promise<void> {
    await this.request("POST", `/merge_requests/${prNumber}/notes`, { body });
  }

  async addReview(prNumber: number, body: string, _event: ReviewEvent): Promise<void> {
    // GitLab doesn't have a direct review API like GitHub; use notes instead
    await this.commentOnPR(prNumber, body);
  }

  async getChangedFiles(prNumber: number): Promise<string[]> {
    const changes = (await this.request("GET", `/merge_requests/${prNumber}/changes`)) as { changes?: Array<{ new_path: string }> };
    return (changes.changes ?? []).map((c) => c.new_path);
  }

  async listPRs(state: "open" | "closed" | "all" = "open"): Promise<PullRequest[]> {
    const glState = state === "open" ? "opened" : state === "closed" ? "closed" : "all";
    const data = (await this.request("GET", `/merge_requests?state=${glState}`)) as Array<Record<string, unknown>>;
    return data.map((d) => this.mapMR(d));
  }

  async getPR(prNumber: number): Promise<PullRequest> {
    const data = (await this.request("GET", `/merge_requests/${prNumber}`)) as Record<string, unknown>;
    return this.mapMR(data);
  }

  async setStatus(sha: string, state: StatusState, context: string, description: string, targetUrl?: string): Promise<void> {
    const glState = state === "success" ? "success" : state === "failure" ? "failed" : state === "error" ? "failed" : "pending";
    await this.request("POST", `/statuses/${sha}`, {
      state: glState,
      name: context,
      description,
      target_url: targetUrl,
    });
  }

  private mapMR(data: Record<string, unknown>): PullRequest {
    const author = data.author as Record<string, unknown> | undefined;
    const mrState = data.state as string;

    let state: "open" | "closed" | "merged" = "open";
    if (mrState === "merged") state = "merged";
    else if (mrState === "closed") state = "closed";

    return {
      number: (data.iid as number) ?? (data.id as number),
      title: (data.title as string) ?? "",
      body: (data.description as string) ?? "",
      author: (author?.username as string) ?? "",
      branch: (data.source_branch as string) ?? "",
      base: (data.target_branch as string) ?? "",
      state,
      changedFiles: [],
      checks: [],
      url: (data.web_url as string) ?? "",
      createdAt: (data.created_at as string) ?? "",
      updatedAt: (data.updated_at as string) ?? "",
    };
  }
}

/**
 * Verify a GitLab webhook token.
 */
export function verifyGitLabToken(
  headerToken: string,
  secret: string,
): boolean {
  return headerToken === secret;
}
