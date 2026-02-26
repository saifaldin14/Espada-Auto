/**
 * Azure IAM / RBAC Manager
 *
 * Manages role assignments and definitions via @azure/arm-authorization.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { RoleDefinition, RoleAssignment, RoleAssignmentCreateOptions } from "./types.js";

export class AzureIAMManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  private async getAuthClient() {
    const { AuthorizationManagementClient } = await import("@azure/arm-authorization");
    const { credential } = await this.credentialsManager.getCredential();
    return new AuthorizationManagementClient(credential, this.subscriptionId);
  }

  async listRoleDefinitions(scope?: string): Promise<RoleDefinition[]> {
    return withAzureRetry(async () => {
      const client = await this.getAuthClient();
      const effectiveScope = scope ?? `/subscriptions/${this.subscriptionId}`;
      const results: RoleDefinition[] = [];
      for await (const rd of client.roleDefinitions.list(effectiveScope)) {
        results.push({
          id: rd.id ?? "",
          name: rd.name ?? "",
          roleName: rd.roleName ?? "",
          description: rd.description,
          roleType: rd.roleType ?? "",
          permissions: (rd.permissions ?? []).map((p) => ({
            actions: p.actions ?? [],
            notActions: p.notActions ?? [],
            dataActions: p.dataActions ?? [],
            notDataActions: p.notDataActions ?? [],
          })),
          assignableScopes: rd.assignableScopes ?? [],
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listRoleAssignments(scope?: string): Promise<RoleAssignment[]> {
    return withAzureRetry(async () => {
      const client = await this.getAuthClient();
      const results: RoleAssignment[] = [];
      const iter = scope
        ? client.roleAssignments.listForScope(scope)
        : client.roleAssignments.listForSubscription();
      for await (const ra of iter) {
        results.push({
          id: ra.id ?? "",
          name: ra.name ?? "",
          principalId: ra.principalId ?? "",
          principalType: ra.principalType,
          roleDefinitionId: ra.roleDefinitionId ?? "",
          scope: ra.scope ?? "",
          createdOn: ra.createdOn?.toISOString(),
          updatedOn: ra.updatedOn?.toISOString(),
        });
      }
      return results;
    }, this.retryOptions);
  }

  async createRoleAssignment(
    assignmentName: string,
    options: RoleAssignmentCreateOptions
  ): Promise<RoleAssignment> {
    return withAzureRetry(async () => {
      const client = await this.getAuthClient();
      const result = await client.roleAssignments.create(options.scope, assignmentName, {
        principalId: options.principalId,
        roleDefinitionId: options.roleDefinitionId,
        principalType: options.principalType as "User" | "Group" | "ServicePrincipal" | "ForeignGroup" | undefined,
      });
      return {
        id: result.id ?? "",
        name: result.name ?? "",
        principalId: result.principalId ?? "",
        principalType: result.principalType,
        roleDefinitionId: result.roleDefinitionId ?? "",
        scope: result.scope ?? "",
        createdOn: result.createdOn?.toISOString(),
        updatedOn: result.updatedOn?.toISOString(),
      };
    }, this.retryOptions);
  }

  async deleteRoleAssignment(scope: string, assignmentName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getAuthClient();
      await client.roleAssignments.delete(scope, assignmentName);
    }, this.retryOptions);
  }

  async getRoleDefinitionByName(roleName: string): Promise<RoleDefinition | undefined> {
    const definitions = await this.listRoleDefinitions();
    return definitions.find((d) => d.roleName === roleName);
  }
}

export function createIAMManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureIAMManager {
  return new AzureIAMManager(credentialsManager, subscriptionId, retryOptions);
}
