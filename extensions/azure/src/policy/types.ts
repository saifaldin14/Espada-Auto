/**
 * Azure Policy — Type Definitions
 */

export type PolicyType = "BuiltIn" | "Custom" | "Static" | "NotSpecified";

export type PolicyDefinition = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  policyType: PolicyType;
  mode: string;
  metadata?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
};

export type PolicyAssignment = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  policyDefinitionId: string;
  scope: string;
  enforcementMode?: string;
  parameters?: Record<string, unknown>;
  notScopes?: string[];
  identity?: { type: string; principalId?: string; tenantId?: string };
};

export type PolicyComplianceState = {
  policyAssignmentId: string;
  complianceState: "Compliant" | "NonCompliant" | "Unknown";
  resourceCount: number;
  nonCompliantResources: number;
  nonCompliantPolicies: number;
};

export type PolicyInitiative = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  policyType: PolicyType;
  policyDefinitions: Array<{ policyDefinitionId: string; parameters?: Record<string, unknown> }>;
};

export type PolicyRemediationTask = {
  id: string;
  name: string;
  policyAssignmentId: string;
  policyDefinitionReferenceId?: string;
  provisioningState?: string;
  createdOn?: string;
  deploymentStatus?: {
    totalDeployments: number;
    successfulDeployments: number;
    failedDeployments: number;
  };
};
