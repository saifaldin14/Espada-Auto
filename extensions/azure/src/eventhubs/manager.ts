/**
 * Azure Event Hubs Manager
 *
 * Manages Event Hubs namespaces, event hubs, consumer groups,
 * and authorization rules via @azure/arm-eventhub.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  EventHubsNamespace,
  EventHub,
  ConsumerGroup,
  AuthorizationRule,
} from "./types.js";

export class AzureEventHubsManager {
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

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { EventHubManagementClient } = await import("@azure/arm-eventhub");
    return new EventHubManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Namespaces
  // ---------------------------------------------------------------------------

  /** List Event Hubs namespaces. */
  async listNamespaces(resourceGroup?: string): Promise<EventHubsNamespace[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const namespaces: EventHubsNamespace[] = [];
      const iter = resourceGroup
        ? client.namespaces.listByResourceGroup(resourceGroup)
        : client.namespaces.list();

      for await (const ns of iter) {
        namespaces.push({
          id: ns.id ?? "",
          name: ns.name ?? "",
          resourceGroup: this.extractResourceGroup(ns.id ?? ""),
          location: ns.location ?? "",
          sku: ns.sku?.name ?? "",
          tier: ns.sku?.tier ?? "",
          capacity: ns.sku?.capacity ?? 0,
          isAutoInflateEnabled: ns.isAutoInflateEnabled ?? false,
          maximumThroughputUnits: ns.maximumThroughputUnits ?? 0,
          provisioningState: ns.provisioningState,
          kafkaEnabled: ns.kafkaEnabled ?? false,
          status: ns.status,
          tags: ns.tags as Record<string, string>,
        });
      }
      return namespaces;
    }, this.retryOptions);
  }

  /** Get a specific Event Hubs namespace. */
  async getNamespace(resourceGroup: string, name: string): Promise<EventHubsNamespace | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const ns = await client.namespaces.get(resourceGroup, name);
        return {
          id: ns.id ?? "",
          name: ns.name ?? "",
          resourceGroup,
          location: ns.location ?? "",
          sku: ns.sku?.name ?? "",
          tier: ns.sku?.tier ?? "",
          capacity: ns.sku?.capacity ?? 0,
          isAutoInflateEnabled: ns.isAutoInflateEnabled ?? false,
          maximumThroughputUnits: ns.maximumThroughputUnits ?? 0,
          provisioningState: ns.provisioningState,
          kafkaEnabled: ns.kafkaEnabled ?? false,
          status: ns.status,
          tags: ns.tags as Record<string, string>,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete an Event Hubs namespace. */
  async deleteNamespace(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.namespaces.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Event Hubs
  // ---------------------------------------------------------------------------

  /** List event hubs within a namespace. */
  async listEventHubs(resourceGroup: string, namespaceName: string): Promise<EventHub[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const hubs: EventHub[] = [];
      for await (const eh of client.eventHubs.listByNamespace(resourceGroup, namespaceName)) {
        hubs.push({
          id: eh.id ?? "",
          name: eh.name ?? "",
          partitionCount: eh.partitionCount ?? 0,
          messageRetentionInDays: eh.messageRetentionInDays ?? 0,
          status: eh.status,
          createdAt: eh.createdAt?.toISOString(),
          updatedAt: eh.updatedAt?.toISOString(),
          partitionIds: eh.partitionIds ?? [],
        });
      }
      return hubs;
    }, this.retryOptions);
  }

  /** Get a specific event hub. */
  async getEventHub(
    resourceGroup: string,
    namespaceName: string,
    eventHubName: string,
  ): Promise<EventHub | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const eh = await client.eventHubs.get(resourceGroup, namespaceName, eventHubName);
        return {
          id: eh.id ?? "",
          name: eh.name ?? "",
          partitionCount: eh.partitionCount ?? 0,
          messageRetentionInDays: eh.messageRetentionInDays ?? 0,
          status: eh.status,
          createdAt: eh.createdAt?.toISOString(),
          updatedAt: eh.updatedAt?.toISOString(),
          partitionIds: eh.partitionIds ?? [],
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete an event hub. */
  async deleteEventHub(
    resourceGroup: string,
    namespaceName: string,
    eventHubName: string,
  ): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.eventHubs.delete(resourceGroup, namespaceName, eventHubName),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Consumer Groups
  // ---------------------------------------------------------------------------

  /** List consumer groups for an event hub. */
  async listConsumerGroups(
    resourceGroup: string,
    namespaceName: string,
    eventHubName: string,
  ): Promise<ConsumerGroup[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const groups: ConsumerGroup[] = [];
      for await (const cg of client.consumerGroups.listByEventHub(resourceGroup, namespaceName, eventHubName)) {
        groups.push({
          id: cg.id ?? "",
          name: cg.name ?? "",
          userMetadata: cg.userMetadata,
          createdAt: cg.createdAt?.toISOString(),
          updatedAt: cg.updatedAt?.toISOString(),
        });
      }
      return groups;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Authorization Rules
  // ---------------------------------------------------------------------------

  /** List namespace-level authorization rules. */
  async listAuthorizationRules(
    resourceGroup: string,
    namespaceName: string,
  ): Promise<AuthorizationRule[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const rules: AuthorizationRule[] = [];
      for await (const r of client.namespaces.listAuthorizationRules(resourceGroup, namespaceName)) {
        rules.push({
          id: r.id ?? "",
          name: r.name ?? "",
          rights: (r.rights ?? []) as string[],
        });
      }
      return rules;
    }, this.retryOptions);
  }
}

export function createEventHubsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureEventHubsManager {
  return new AzureEventHubsManager(credentialsManager, subscriptionId, retryOptions);
}
