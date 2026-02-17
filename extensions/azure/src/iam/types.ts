/**
 * Azure IAM / RBAC — Type Definitions
 */

export type RoleScope = "subscription" | "resourceGroup" | "resource";

export type RoleDefinition = {
  id: string;
  name: string;
  roleName: string;
  description?: string;
  roleType: string;
  permissions: Array<{
    actions: string[];
    notActions: string[];
    dataActions: string[];
    notDataActions: string[];
  }>;
  assignableScopes: string[];
};

export type RoleAssignment = {
  id: string;
  name: string;
  principalId: string;
  principalType?: string;
  roleDefinitionId: string;
  scope: string;
  createdOn?: string;
  updatedOn?: string;
};

export type ServicePrincipal = {
  id: string;
  appId: string;
  displayName: string;
  servicePrincipalType?: string;
  accountEnabled?: boolean;
};

export type ManagedIdentity = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  principalId?: string;
  clientId?: string;
  tenantId?: string;
  type: "SystemAssigned" | "UserAssigned";
};

export type RoleAssignmentCreateOptions = {
  principalId: string;
  roleDefinitionId: string;
  scope: string;
  principalType?: string;
};
