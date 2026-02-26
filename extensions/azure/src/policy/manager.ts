/**
 * Azure Policy Manager
 *
 * Manages policy definitions, assignments, and compliance via @azure/arm-policy.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  PolicyDefinition,
  PolicyAssignment,
  PolicyComplianceState,
  PolicyRemediationTask,
  PolicyType,
} from "./types.js";

export class AzurePolicyManager {
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

  private async getClient() {
    const { PolicyClient } = await import("@azure/arm-policy");
    const { credential } = await this.credentialsManager.getCredential();
    return new PolicyClient(credential, this.subscriptionId);
  }

  async listDefinitions(): Promise<PolicyDefinition[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: PolicyDefinition[] = [];
      for await (const pd of client.policyDefinitions.list()) {
        results.push({
          id: pd.id ?? "",
          name: pd.name ?? "",
          displayName: pd.displayName,
          description: pd.description,
          policyType: ((pd.policyType ?? "NotSpecified") as string as PolicyType),
          mode: pd.mode ?? "",
          metadata: pd.metadata as Record<string, unknown>,
          parameters: pd.parameters as Record<string, unknown>,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listAssignments(scope?: string): Promise<PolicyAssignment[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: PolicyAssignment[] = [];
      const iter = scope
        ? client.policyAssignments.listForResource(
            scope.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
            "",
            "",
            "",
            ""
          )
        : client.policyAssignments.list();
      for await (const pa of iter) {
        results.push({
          id: pa.id ?? "",
          name: pa.name ?? "",
          displayName: pa.displayName,
          description: pa.description,
          policyDefinitionId: pa.policyDefinitionId ?? "",
          scope: pa.scope ?? "",
          enforcementMode: pa.enforcementMode,
          parameters: pa.parameters as Record<string, unknown>,
          notScopes: pa.notScopes,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async createAssignment(
    assignmentName: string,
    options: {
      policyDefinitionId: string;
      scope: string;
      displayName?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }
  ): Promise<PolicyAssignment> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const result = await client.policyAssignments.create(options.scope, assignmentName, {
        policyDefinitionId: options.policyDefinitionId,
        displayName: options.displayName,
        description: options.description,
        parameters: options.parameters as Record<string, { value: unknown }> | undefined,
      });
      return {
        id: result.id ?? "",
        name: result.name ?? "",
        displayName: result.displayName,
        description: result.description,
        policyDefinitionId: result.policyDefinitionId ?? "",
        scope: result.scope ?? "",
        enforcementMode: result.enforcementMode,
      };
    }, this.retryOptions);
  }

  async deleteAssignment(scope: string, assignmentName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.policyAssignments.delete(scope, assignmentName);
    }, this.retryOptions);
  }

  async getComplianceState(scope?: string): Promise<PolicyComplianceState[]> {
    return withAzureRetry(async () => {
      const { PolicyInsightsClient } = await import("@azure/arm-policyinsights");
      const { credential } = await this.credentialsManager.getCredential();
      const client = new PolicyInsightsClient(credential, this.subscriptionId);
      const effectiveScope = scope ?? `/subscriptions/${this.subscriptionId}`;
      const results: PolicyComplianceState[] = [];
      for await (const state of client.policyStates.listQueryResultsForSubscription(
        "latest",
        this.subscriptionId
      )) {
        results.push({
          policyAssignmentId: state.policyAssignmentId ?? "",
          complianceState: ((state.complianceState ?? "Unknown") as string as PolicyComplianceState["complianceState"]),
          resourceCount: 1,
          nonCompliantResources: state.complianceState === "NonCompliant" ? 1 : 0,
          nonCompliantPolicies: 0,
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createPolicyManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzurePolicyManager {
  return new AzurePolicyManager(credentialsManager, subscriptionId, retryOptions);
}
