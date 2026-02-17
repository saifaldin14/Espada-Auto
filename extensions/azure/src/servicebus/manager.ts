/**
 * Azure Service Bus Manager
 *
 * Manages Service Bus namespaces, queues, topics, and subscriptions.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  ServiceBusNamespace,
  ServiceBusQueue,
  ServiceBusTopic,
  ServiceBusSubscription,
} from "./types.js";

export class AzureServiceBusManager {
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
    const { ServiceBusManagementClient } = await import("@azure/arm-servicebus");
    const { credential } = await this.credentialsManager.getCredential();
    return new ServiceBusManagementClient(credential, this.subscriptionId);
  }

  async listNamespaces(resourceGroup?: string): Promise<ServiceBusNamespace[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ServiceBusNamespace[] = [];
      const iter = resourceGroup
        ? client.namespaces.listByResourceGroup(resourceGroup)
        : client.namespaces.list();
      for await (const ns of iter) {
        results.push({
          id: ns.id ?? "",
          name: ns.name ?? "",
          resourceGroup: ns.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: ns.location ?? "",
          sku: ns.sku?.name ?? "",
          tier: ns.sku?.tier ?? "",
          endpoint: ns.serviceBusEndpoint,
          provisioningState: ns.provisioningState,
          createdAt: ns.createdAt?.toISOString(),
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listQueues(resourceGroup: string, namespaceName: string): Promise<ServiceBusQueue[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ServiceBusQueue[] = [];
      for await (const q of client.queues.listByNamespace(resourceGroup, namespaceName)) {
        results.push({
          id: q.id ?? "",
          name: q.name ?? "",
          namespaceName,
          maxSizeInMegabytes: q.maxSizeInMegabytes,
          messageCount: q.messageCount ? Number(q.messageCount) : undefined,
          activeMessageCount: q.countDetails?.activeMessageCount
            ? Number(q.countDetails.activeMessageCount)
            : undefined,
          deadLetterMessageCount: q.countDetails?.deadLetterMessageCount
            ? Number(q.countDetails.deadLetterMessageCount)
            : undefined,
          status: q.status,
          lockDuration: q.lockDuration,
          maxDeliveryCount: q.maxDeliveryCount,
          requiresDuplicateDetection: q.requiresDuplicateDetection,
          requiresSession: q.requiresSession,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listTopics(resourceGroup: string, namespaceName: string): Promise<ServiceBusTopic[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ServiceBusTopic[] = [];
      for await (const t of client.topics.listByNamespace(resourceGroup, namespaceName)) {
        results.push({
          id: t.id ?? "",
          name: t.name ?? "",
          namespaceName,
          maxSizeInMegabytes: t.maxSizeInMegabytes,
          subscriptionCount: t.subscriptionCount,
          status: t.status,
          enablePartitioning: t.enablePartitioning,
          enableBatchedOperations: t.enableBatchedOperations,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listSubscriptions(
    resourceGroup: string,
    namespaceName: string,
    topicName: string
  ): Promise<ServiceBusSubscription[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ServiceBusSubscription[] = [];
      for await (const s of client.subscriptions.listByTopic(
        resourceGroup,
        namespaceName,
        topicName
      )) {
        results.push({
          id: s.id ?? "",
          name: s.name ?? "",
          topicName,
          messageCount: s.messageCount ? Number(s.messageCount) : undefined,
          activeMessageCount: s.countDetails?.activeMessageCount
            ? Number(s.countDetails.activeMessageCount)
            : undefined,
          deadLetterMessageCount: s.countDetails?.deadLetterMessageCount
            ? Number(s.countDetails.deadLetterMessageCount)
            : undefined,
          status: s.status,
          lockDuration: s.lockDuration,
          maxDeliveryCount: s.maxDeliveryCount,
          requiresSession: s.requiresSession,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async createQueue(
    resourceGroup: string,
    namespaceName: string,
    queueName: string,
    options?: { maxSizeInMegabytes?: number; lockDuration?: string; maxDeliveryCount?: number }
  ): Promise<ServiceBusQueue> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const result = await client.queues.createOrUpdate(resourceGroup, namespaceName, queueName, {
        maxSizeInMegabytes: options?.maxSizeInMegabytes,
        lockDuration: options?.lockDuration,
        maxDeliveryCount: options?.maxDeliveryCount,
      });
      return {
        id: result.id ?? "",
        name: result.name ?? "",
        namespaceName,
        maxSizeInMegabytes: result.maxSizeInMegabytes,
        status: result.status,
      };
    }, this.retryOptions);
  }

  async deleteQueue(
    resourceGroup: string,
    namespaceName: string,
    queueName: string
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.queues.delete(resourceGroup, namespaceName, queueName);
    }, this.retryOptions);
  }
}

export function createServiceBusManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureServiceBusManager {
  return new AzureServiceBusManager(credentialsManager, subscriptionId, retryOptions);
}
