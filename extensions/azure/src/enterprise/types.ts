/**
 * Azure Enterprise - Multi-tenant management types
 */

export interface AzureTenantInfo {
  tenantId: string;
  displayName: string;
  defaultDomain?: string;
  tenantType?: string;
  subscriptions: AzureTenantSubscription[];
}

export interface AzureTenantSubscription {
  subscriptionId: string;
  displayName: string;
  state: string;
  tenantId: string;
}

export interface AzureManagementGroup {
  id: string;
  name: string;
  displayName: string;
  type: string;
  children?: AzureManagementGroup[];
}

export interface AzureLighthouseDelegation {
  delegationId: string;
  managedTenantId: string;
  managedSubscriptionId: string;
  principalId: string;
  roleDefinitionId: string;
  status: string;
}

export interface AzureEnterpriseEnrollment {
  enrollmentNumber: string;
  billingAccountId: string;
  departments: AzureDepartment[];
  accounts: AzureEnrollmentAccount[];
}

export interface AzureDepartment {
  departmentId: string;
  name: string;
  costCenter?: string;
}

export interface AzureEnrollmentAccount {
  accountId: string;
  accountName: string;
  departmentId?: string;
  status: string;
}
