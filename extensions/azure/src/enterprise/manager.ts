/**
 * Azure Enterprise Manager
 *
 * Multi-tenant management, management groups, Lighthouse delegations,
 * and enterprise enrollment operations.
 */

import type { AzureCredentialsManager } from "../credentials/index.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureTenantInfo,
  AzureTenantSubscription,
  AzureManagementGroup,
  AzureLighthouseDelegation,
  AzureEnterpriseEnrollment,
} from "./types.js";

export class AzureEnterpriseManager {
  constructor(
    private readonly credentials: AzureCredentialsManager,
    private readonly subscriptionId: string,
    private readonly retryOptions?: AzureRetryOptions,
  ) {}

  /**
   * List management groups in the tenant hierarchy
   */
  async listManagementGroups(): Promise<AzureManagementGroup[]> {
    return withAzureRetry(async () => {
      const { ManagementGroupsAPI } = await import("@azure/arm-managementgroups");
      const client = new ManagementGroupsAPI(this.credentials.getCredential());
      const groups: AzureManagementGroup[] = [];
      for await (const group of client.managementGroups.list()) {
        groups.push({
          id: group.id ?? "",
          name: group.name ?? "",
          displayName: group.displayName ?? group.name ?? "",
          type: group.type ?? "Microsoft.Management/managementGroups",
        });
      }
      return groups;
    }, this.retryOptions);
  }

  /**
   * Get details of a specific management group including children
   */
  async getManagementGroup(groupId: string): Promise<AzureManagementGroup | null> {
    return withAzureRetry(async () => {
      const { ManagementGroupsAPI } = await import("@azure/arm-managementgroups");
      const client = new ManagementGroupsAPI(this.credentials.getCredential());
      const group = await client.managementGroups.get(groupId, { expand: "children" });
      if (!group) return null;
      return {
        id: group.id ?? "",
        name: group.name ?? "",
        displayName: group.displayName ?? group.name ?? "",
        type: group.type ?? "Microsoft.Management/managementGroups",
        children: (group.children ?? []).map((c: any) => ({
          id: c.id ?? "",
          name: c.name ?? "",
          displayName: c.displayName ?? c.name ?? "",
          type: c.type ?? "",
        })),
      };
    }, this.retryOptions);
  }

  /**
   * List tenants the current credential has access to
   */
  async listTenants(): Promise<AzureTenantInfo[]> {
    return withAzureRetry(async () => {
      const { SubscriptionClient } = await import("@azure/arm-subscriptions");
      const client = new SubscriptionClient(this.credentials.getCredential());
      const tenants: AzureTenantInfo[] = [];
      for await (const t of client.tenants.list()) {
        tenants.push({
          tenantId: t.tenantId ?? "",
          displayName: t.displayName ?? "",
          defaultDomain: t.defaultDomain ?? undefined,
          tenantType: t.tenantType ?? undefined,
          subscriptions: [],
        });
      }
      return tenants;
    }, this.retryOptions);
  }

  /**
   * List subscriptions across all accessible tenants
   */
  async listSubscriptionsForTenant(tenantId: string): Promise<AzureTenantSubscription[]> {
    return withAzureRetry(async () => {
      const { SubscriptionClient } = await import("@azure/arm-subscriptions");
      const client = new SubscriptionClient(this.credentials.getCredential());
      const subs: AzureTenantSubscription[] = [];
      for await (const s of client.subscriptions.list()) {
        if (!tenantId || s.tenantId === tenantId) {
          subs.push({
            subscriptionId: s.subscriptionId ?? "",
            displayName: s.displayName ?? "",
            state: s.state ?? "Unknown",
            tenantId: s.tenantId ?? "",
          });
        }
      }
      return subs;
    }, this.retryOptions);
  }

  /**
   * List Lighthouse delegations (managed by others)
   */
  async listLighthouseDelegations(): Promise<AzureLighthouseDelegation[]> {
    return withAzureRetry(async () => {
      const { ManagedServicesClient } = await import("@azure/arm-managedservices");
      const client = new ManagedServicesClient(this.credentials.getCredential());
      const scope = `/subscriptions/${this.subscriptionId}`;
      const delegations: AzureLighthouseDelegation[] = [];
      for await (const d of client.registrationAssignments.list(scope)) {
        delegations.push({
          delegationId: d.id ?? "",
          managedTenantId: (d.properties as any)?.registrationDefinition?.properties?.managedByTenantId ?? "",
          managedSubscriptionId: this.subscriptionId,
          principalId: "",
          roleDefinitionId: "",
          status: (d.properties as any)?.provisioningState ?? "Unknown",
        });
      }
      return delegations;
    }, this.retryOptions);
  }

  /**
   * Get enterprise enrollment billing information
   */
  async getEnrollmentInfo(): Promise<AzureEnterpriseEnrollment | null> {
    return withAzureRetry(async () => {
      const { BillingManagementClient } = await import("@azure/arm-billing");
      const client = new BillingManagementClient(this.credentials.getCredential());
      const accounts: AzureEnterpriseEnrollment[] = [];
      for await (const acct of client.billingAccounts.list()) {
        const enrollment: AzureEnterpriseEnrollment = {
          enrollmentNumber: acct.name ?? "",
          billingAccountId: acct.id ?? "",
          departments: [],
          accounts: [],
        };
        accounts.push(enrollment);
      }
      return accounts[0] ?? null;
    }, this.retryOptions);
  }
}
