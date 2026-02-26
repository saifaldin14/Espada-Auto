/**
 * Azure Notification Hubs manager.
 *
 * Provides operations for managing Notification Hubs namespaces and
 * notification hubs including listing, retrieval, and deletion.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  NotificationHubNamespace,
  NotificationHub,
  NotificationHubAuthorizationRule,
} from "./types.js";

export class AzureNotificationHubsManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  // ---------------------------------------------------------------------------
  // SDK client
  // ---------------------------------------------------------------------------

  private async getClient() {
    const { NotificationHubsManagementClient } = await import("@azure/arm-notificationhubs");
    const { credential } = await this.credentialsManager.getCredential();
    return new NotificationHubsManagementClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // Namespace operations
  // ---------------------------------------------------------------------------

  /** List Notification Hubs namespaces, optionally filtered by resource group. */
  async listNamespaces(resourceGroup?: string): Promise<NotificationHubNamespace[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: NotificationHubNamespace[] = [];
      const iter = resourceGroup
        ? client.namespaces.list(resourceGroup)
        : client.namespaces.listAll();
      for await (const ns of iter) {
        results.push(this.mapNamespace(ns));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single Notification Hubs namespace. Returns null if not found. */
  async getNamespace(resourceGroup: string, namespaceName: string): Promise<NotificationHubNamespace | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getClient();
        const ns = await client.namespaces.get(resourceGroup, namespaceName);
        return this.mapNamespace(ns);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Notification Hubs namespace. */
  async deleteNamespace(resourceGroup: string, namespaceName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.namespaces.beginDeleteAndWait(resourceGroup, namespaceName);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Notification Hub operations
  // ---------------------------------------------------------------------------

  /** List notification hubs in a namespace. */
  async listNotificationHubs(resourceGroup: string, namespaceName: string): Promise<NotificationHub[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: NotificationHub[] = [];
      for await (const hub of client.notificationHubs.list(resourceGroup, namespaceName)) {
        results.push(this.mapHub(hub));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single notification hub. Returns null if not found. */
  async getNotificationHub(resourceGroup: string, namespaceName: string, hubName: string): Promise<NotificationHub | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getClient();
        const hub = await client.notificationHubs.get(resourceGroup, namespaceName, hubName);
        return this.mapHub(hub);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a notification hub. */
  async deleteNotificationHub(resourceGroup: string, namespaceName: string, hubName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.notificationHubs.delete(resourceGroup, namespaceName, hubName);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Authorization rules
  // ---------------------------------------------------------------------------

  /** List authorization rules for a namespace. */
  async listNamespaceAuthorizationRules(resourceGroup: string, namespaceName: string): Promise<NotificationHubAuthorizationRule[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: NotificationHubAuthorizationRule[] = [];
      for await (const rule of client.namespaces.listAuthorizationRules(resourceGroup, namespaceName)) {
        results.push({
          id: rule.id ?? "",
          name: rule.name ?? "",
          rights: (rule.rights ?? []) as string[],
        });
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private extractResourceGroup(resourceId?: string): string {
    if (!resourceId) return "";
    const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
    return match?.[1] ?? "";
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapNamespace(ns: unknown): NotificationHubNamespace {
    const typed = ns as {
      id?: string; name?: string; location?: string;
      provisioningState?: string; status?: string; enabled?: boolean;
      critical?: boolean; sku?: { name?: string; tier?: string; capacity?: number };
      serviceBusEndpoint?: string; scaleUnit?: string; namespaceType?: string;
      createdAt?: Date; updatedAt?: Date; tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      provisioningState: typed.provisioningState,
      status: typed.status,
      enabled: typed.enabled,
      critical: typed.critical,
      skuName: typed.sku?.name,
      skuTier: typed.sku?.tier,
      skuCapacity: typed.sku?.capacity,
      serviceBusEndpoint: typed.serviceBusEndpoint,
      scaleUnit: typed.scaleUnit,
      namespaceType: typed.namespaceType,
      createdAt: typed.createdAt,
      updatedAt: typed.updatedAt,
      tags: typed.tags ?? {},
    };
  }

  private mapHub(hub: unknown): NotificationHub {
    const typed = hub as {
      id?: string; name?: string; location?: string;
      registrationTtl?: string; dailyMaxActiveDevices?: number;
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      registrationTtl: typed.registrationTtl,
      dailyMaxActiveDevices: typed.dailyMaxActiveDevices,
      tags: typed.tags ?? {},
    };
  }
}

/** Factory function for creating a Notification Hubs manager. */
export function createNotificationHubsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureNotificationHubsManager {
  return new AzureNotificationHubsManager(credentialsManager, subscriptionId, retryOptions);
}
