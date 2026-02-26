import { describe, it, expect, vi, beforeEach } from "vitest";
import { GcpIAMManager } from "./index.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

vi.mock("../api.js", () => ({
  gcpRequest: vi.fn(),
  gcpList: vi.fn(),
  gcpMutate: vi.fn(),
}));

vi.mock("../retry.js", () => ({
  withGcpRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const PROJECT = "test-project";
const TOKEN = "tok_test";
const getToken = vi.fn(async () => TOKEN);

function makeManager() {
  return new GcpIAMManager(PROJECT, getToken);
}

function rawServiceAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "sa@test-project.iam.gserviceaccount.com",
    name: "projects/test-project/serviceAccounts/sa@test-project.iam.gserviceaccount.com",
    displayName: "Test SA",
    disabled: false,
    uniqueId: "123456",
    description: "A test service account",
    ...overrides,
  };
}

function rawRole(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "roles/viewer",
    title: "Viewer",
    description: "Read access to all resources",
    includedPermissions: ["resourcemanager.projects.get"],
    stage: "GA",
    ...overrides,
  };
}

describe("GcpIAMManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Service Accounts
  // ---------------------------------------------------------------------------

  describe("listServiceAccounts", () => {
    it("returns mapped service accounts via gcpList", async () => {
      const raw = [rawServiceAccount(), rawServiceAccount({ email: "other@test.iam.gserviceaccount.com", displayName: "Other" })];
      vi.mocked(gcpList).mockResolvedValueOnce(raw);

      const mgr = makeManager();
      const result = await mgr.listServiceAccounts();

      expect(gcpList).toHaveBeenCalledWith(
        `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`,
        TOKEN,
        "accounts",
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        email: "sa@test-project.iam.gserviceaccount.com",
        name: "projects/test-project/serviceAccounts/sa@test-project.iam.gserviceaccount.com",
        displayName: "Test SA",
        disabled: false,
        uniqueId: "123456",
        description: "A test service account",
      });
    });

    it("handles missing fields with defaults", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([{}]);
      const result = await makeManager().listServiceAccounts();
      expect(result[0]).toEqual({
        email: "",
        name: "",
        displayName: "",
        disabled: false,
        uniqueId: "",
        description: "",
      });
    });
  });

  describe("getServiceAccount", () => {
    it("fetches a single account by email", async () => {
      const raw = rawServiceAccount();
      vi.mocked(gcpRequest).mockResolvedValueOnce(raw);

      const result = await makeManager().getServiceAccount("sa@test-project.iam.gserviceaccount.com");
      expect(gcpRequest).toHaveBeenCalledWith(
        "https://iam.googleapis.com/v1/projects/-/serviceAccounts/sa@test-project.iam.gserviceaccount.com",
        TOKEN,
      );
      expect(result.email).toBe("sa@test-project.iam.gserviceaccount.com");
      expect(result.displayName).toBe("Test SA");
    });
  });

  describe("createServiceAccount", () => {
    it("calls gcpMutate with correct body", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ success: true, message: "created" });

      const result = await makeManager().createServiceAccount("my-sa", "My Service Account");
      expect(gcpMutate).toHaveBeenCalledWith(
        `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`,
        TOKEN,
        { accountId: "my-sa", serviceAccount: { displayName: "My Service Account" } },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("deleteServiceAccount", () => {
    it("calls gcpMutate with DELETE method", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ success: true, message: "deleted" });

      const result = await makeManager().deleteServiceAccount("sa@test.iam.gserviceaccount.com");
      expect(gcpMutate).toHaveBeenCalledWith(
        "https://iam.googleapis.com/v1/projects/-/serviceAccounts/sa@test.iam.gserviceaccount.com",
        TOKEN,
        undefined,
        "DELETE",
      );
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // IAM Policies
  // ---------------------------------------------------------------------------

  describe("getIamPolicy", () => {
    it("calls gcpRequest with POST and returns policy", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({
        bindings: [{ role: "roles/viewer", members: ["user:alice@example.com"] }],
        etag: "abc123",
        version: 1,
      });

      const policy = await makeManager().getIamPolicy();
      expect(gcpRequest).toHaveBeenCalledWith(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
        TOKEN,
        { method: "POST", body: {} },
      );
      expect(policy.bindings).toHaveLength(1);
      expect(policy.etag).toBe("abc123");
      expect(policy.version).toBe(1);
    });

    it("defaults missing policy fields", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({});
      const policy = await makeManager().getIamPolicy();
      expect(policy).toEqual({ bindings: [], etag: "", version: 1 });
    });
  });

  describe("setIamPolicy", () => {
    it("posts new policy and returns success", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({});

      const policy = { bindings: [{ role: "roles/editor", members: ["user:bob@example.com"] }], etag: "xyz", version: 1 };
      const result = await makeManager().setIamPolicy(policy);
      expect(gcpRequest).toHaveBeenCalledWith(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:setIamPolicy`,
        TOKEN,
        { method: "POST", body: { policy } },
      );
      expect(result).toEqual({ success: true, message: "IAM policy updated" });
    });
  });

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  describe("listRoles", () => {
    it("lists roles via gcpList with showDeleted=false by default", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([rawRole()]);

      const roles = await makeManager().listRoles();
      expect(gcpList).toHaveBeenCalledWith(
        "https://iam.googleapis.com/v1/roles?showDeleted=false",
        TOKEN,
        "roles",
      );
      expect(roles).toHaveLength(1);
      expect(roles[0].name).toBe("roles/viewer");
    });

    it("passes showDeleted=true when requested", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([]);
      await makeManager().listRoles({ showDeleted: true });
      expect(gcpList).toHaveBeenCalledWith(
        "https://iam.googleapis.com/v1/roles?showDeleted=true",
        TOKEN,
        "roles",
      );
    });
  });

  describe("getRole", () => {
    it("fetches a single role by name", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce(rawRole());
      const role = await makeManager().getRole("roles/viewer");
      expect(gcpRequest).toHaveBeenCalledWith("https://iam.googleapis.com/v1/roles/viewer", TOKEN);
      expect(role.title).toBe("Viewer");
      expect(role.includedPermissions).toEqual(["resourcemanager.projects.get"]);
    });
  });
});
