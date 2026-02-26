/**
 * Azure IAM Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureIAMManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockRoleDefinitions = { list: vi.fn() };
const mockRoleAssignments = {
  listForSubscription: vi.fn(),
  listForScope: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@azure/arm-authorization", () => ({
  AuthorizationManagementClient: vi.fn().mockImplementation(function() { return {
    roleDefinitions: mockRoleDefinitions,
    roleAssignments: mockRoleAssignments,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureIAMManager", () => {
  let mgr: AzureIAMManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureIAMManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listRoleDefinitions", () => {
    it("lists role definitions at subscription scope", async () => {
      mockRoleDefinitions.list.mockReturnValue(asyncIter([
        { id: "rd-1", name: "guid-1", roleName: "Contributor", description: "Full access except RBAC", roleType: "BuiltInRole", permissions: [{ actions: ["*"], notActions: ["Microsoft.Authorization/*"], dataActions: [], notDataActions: [] }], assignableScopes: ["/subscriptions/sub-1"] },
      ]));
      const defs = await mgr.listRoleDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].roleName).toBe("Contributor");
    });

    it("lists definitions at custom scope", async () => {
      mockRoleDefinitions.list.mockReturnValue(asyncIter([]));
      await mgr.listRoleDefinitions("/subscriptions/sub-1/resourceGroups/rg-1");
      expect(mockRoleDefinitions.list).toHaveBeenCalled();
    });
  });

  describe("listRoleAssignments", () => {
    it("lists assignments at subscription level", async () => {
      mockRoleAssignments.listForSubscription.mockReturnValue(asyncIter([
        { id: "ra-1", name: "assign-1", properties: { principalId: "p-1", roleDefinitionId: "rd-1", scope: "/subscriptions/sub-1", principalType: "User" } },
      ]));
      const assignments = await mgr.listRoleAssignments();
      expect(assignments).toHaveLength(1);
    });

    it("lists assignments for specific scope", async () => {
      mockRoleAssignments.listForScope.mockReturnValue(asyncIter([]));
      await mgr.listRoleAssignments("/subscriptions/sub-1/resourceGroups/rg-1");
      expect(mockRoleAssignments.listForScope).toHaveBeenCalled();
    });
  });

  describe("createRoleAssignment", () => {
    it("creates a role assignment", async () => {
      mockRoleAssignments.create.mockResolvedValue({
        id: "ra-new", name: "assign-new",
        properties: { principalId: "p-1", roleDefinitionId: "rd-1", scope: "/subscriptions/sub-1", principalType: "User" },
      });
      const result = await mgr.createRoleAssignment("assign-new", {
        scope: "/subscriptions/sub-1",
        roleDefinitionId: "rd-1",
        principalId: "p-1",
      });
      expect(result.name).toBe("assign-new");
    });
  });

  describe("deleteRoleAssignment", () => {
    it("deletes a role assignment", async () => {
      mockRoleAssignments.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteRoleAssignment("/subscriptions/sub-1", "assign-old")).resolves.toBeUndefined();
    });
  });

  describe("getRoleDefinitionByName", () => {
    it("finds role by name", async () => {
      mockRoleDefinitions.list.mockReturnValue(asyncIter([
        { id: "rd-1", name: "guid-1", roleName: "Reader", description: "Read-only", roleType: "BuiltInRole", permissions: [], assignableScopes: [] },
        { id: "rd-2", name: "guid-2", roleName: "Contributor", description: "Full access", roleType: "BuiltInRole", permissions: [], assignableScopes: [] },
      ]));
      const role = await mgr.getRoleDefinitionByName("Reader");
      expect(role).toBeDefined();
      expect(role!.roleName).toBe("Reader");
    });

    it("returns undefined when not found", async () => {
      mockRoleDefinitions.list.mockReturnValue(asyncIter([]));
      expect(await mgr.getRoleDefinitionByName("NonExistent")).toBeUndefined();
    });
  });
});
