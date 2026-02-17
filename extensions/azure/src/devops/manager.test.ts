/**
 * Azure DevOps Manager — Unit Tests
 *
 * Uses fetch-based REST API, not an Azure SDK package.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureDevOpsManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({
    credential: { getToken: vi.fn().mockResolvedValue({ token: "fake-token" }) },
    method: "default",
  }),
} as unknown as AzureCredentialsManager;

describe("AzureDevOpsManager", () => {
  let mgr: AzureDevOpsManager;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchSpy;
    mgr = new AzureDevOpsManager(mockCreds, "my-org", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listProjects", () => {
    it("returns projects from API", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ value: [{ id: "p1", name: "Project1", description: "desc", state: "wellFormed", url: "https://dev.azure.com/my-org/Project1" }] }),
      });
      const projects = await mgr.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("Project1");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("_apis/projects"),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
      await expect(mgr.listProjects()).rejects.toThrow("DevOps API error");
    });
  });

  describe("listPipelines", () => {
    it("returns pipelines", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ value: [{ id: 1, name: "CI Build", folder: "\\" }] }),
      });
      const pipelines = await mgr.listPipelines("Project1");
      expect(pipelines).toHaveLength(1);
    });
  });

  describe("listRuns", () => {
    it("returns pipeline runs", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ value: [{ id: 100, name: "Run 100", state: "completed", result: "succeeded", createdDate: new Date().toISOString() }] }),
      });
      const runs = await mgr.listRuns("Project1", 1);
      expect(runs).toHaveLength(1);
    });
  });

  describe("triggerPipeline", () => {
    it("triggers a pipeline run", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 101, name: "Run 101", state: "inProgress" }),
      });
      const run = await mgr.triggerPipeline("Project1", 1);
      expect(run.id).toBe(101);
    });
  });

  describe("listRepositories", () => {
    it("returns repositories", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ value: [{ id: "r1", name: "my-repo", defaultBranch: "refs/heads/main", remoteUrl: "https://dev.azure.com/my-org/Project1/_git/my-repo" }] }),
      });
      const repos = await mgr.listRepositories("Project1");
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("my-repo");
    });
  });
});
