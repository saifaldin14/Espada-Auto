/**
 * Azure Subscription Manager
 *
 * Lists subscriptions, tenants, and locations via @azure/arm-subscriptions.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { AzureSubscription, TenantInfo, AzureLocation } from "./types.js";

export class AzureSubscriptionManager {
  private credentialsManager: AzureCredentialsManager;
  private retryOptions?: AzureRetryOptions;

  constructor(credentialsManager: AzureCredentialsManager, retryOptions?: AzureRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.retryOptions = retryOptions;
  }

  private async getClient() {
    const { SubscriptionClient } = await import("@azure/arm-subscriptions");
    const { credential } = await this.credentialsManager.getCredential();
    return new SubscriptionClient(credential);
  }

  async listSubscriptions(): Promise<AzureSubscription[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureSubscription[] = [];
      for await (const s of client.subscriptions.list()) {
        results.push({
          subscriptionId: s.subscriptionId ?? "",
          displayName: s.displayName ?? "",
          state: (s.state as any) ?? "Enabled",
          tenantId: s.tenantId ?? "",
          subscriptionPolicies: s.subscriptionPolicies
            ? {
                locationPlacementId: s.subscriptionPolicies.locationPlacementId,
                quotaId: s.subscriptionPolicies.quotaId,
                spendingLimit: s.subscriptionPolicies.spendingLimit,
              }
            : undefined,
          authorizationSource: s.authorizationSource,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getSubscription(subscriptionId: string): Promise<AzureSubscription> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const s = await client.subscriptions.get(subscriptionId);
      return {
        subscriptionId: s.subscriptionId ?? "",
        displayName: s.displayName ?? "",
        state: (s.state as any) ?? "Enabled",
        tenantId: s.tenantId ?? "",
        subscriptionPolicies: s.subscriptionPolicies
          ? {
              locationPlacementId: s.subscriptionPolicies.locationPlacementId,
              quotaId: s.subscriptionPolicies.quotaId,
              spendingLimit: s.subscriptionPolicies.spendingLimit,
            }
          : undefined,
        authorizationSource: s.authorizationSource,
      };
    }, this.retryOptions);
  }

  async listTenants(): Promise<TenantInfo[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: TenantInfo[] = [];
      for await (const t of client.tenants.list()) {
        results.push({
          tenantId: t.tenantId ?? "",
          displayName: t.displayName,
          tenantCategory: t.tenantCategory,
          defaultDomain: t.defaultDomain,
          country: t.country,
          countryCode: t.countryCode,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listLocations(subscriptionId: string): Promise<AzureLocation[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureLocation[] = [];
      for await (const loc of client.subscriptions.listLocations(subscriptionId)) {
        const meta = (loc as any).metadata ?? {};
        results.push({
          name: loc.name ?? "",
          displayName: loc.displayName ?? "",
          regionalDisplayName: (loc as any).regionalDisplayName,
          type: (loc as any).type,
          latitude: meta.latitude,
          longitude: meta.longitude,
          physicalLocation: meta.physicalLocation,
          pairedRegion: meta.pairedRegion?.map((r: any) => r.name ?? ""),
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createSubscriptionManager(
  credentialsManager: AzureCredentialsManager,
  retryOptions?: AzureRetryOptions
): AzureSubscriptionManager {
  return new AzureSubscriptionManager(credentialsManager, retryOptions);
}
