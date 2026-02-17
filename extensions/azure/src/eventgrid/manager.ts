/**
 * Azure Event Grid Manager
 *
 * Manages Event Grid topics, subscriptions, domains, and system topics.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { EventGridTopic, EventGridSubscription, EventGridDomain, SystemTopic } from "./types.js";

export class AzureEventGridManager {
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
    const { EventGridManagementClient } = await import("@azure/arm-eventgrid");
    const credential = this.credentialsManager.getCredential();
    return new EventGridManagementClient(credential, this.subscriptionId);
  }

  async listTopics(resourceGroup?: string): Promise<EventGridTopic[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: EventGridTopic[] = [];
      const iter = resourceGroup
        ? client.topics.listByResourceGroup(resourceGroup)
        : client.topics.listBySubscription();
      for await (const t of iter) {
        results.push({
          id: t.id ?? "",
          name: t.name ?? "",
          resourceGroup: t.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: t.location ?? "",
          endpoint: t.endpoint,
          provisioningState: t.provisioningState,
          publicNetworkAccess: t.publicNetworkAccess,
          inputSchema: t.inputSchema,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listEventSubscriptions(scope?: string): Promise<EventGridSubscription[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const effectiveScope = scope ?? `/subscriptions/${this.subscriptionId}`;
      const results: EventGridSubscription[] = [];
      for await (const s of client.eventSubscriptions.listGlobalBySubscription()) {
        results.push({
          id: s.id ?? "",
          name: s.name ?? "",
          provisioningState: s.provisioningState,
          eventDeliverySchema: s.eventDeliverySchema,
          filter: {
            subjectBeginsWith: s.filter?.subjectBeginsWith,
            subjectEndsWith: s.filter?.subjectEndsWith,
            includedEventTypes: s.filter?.includedEventTypes,
          },
          retryPolicy: s.retryPolicy
            ? {
                maxDeliveryAttempts: s.retryPolicy.maxDeliveryAttempts,
                eventTimeToLiveInMinutes: s.retryPolicy.eventTimeToLiveInMinutes,
              }
            : undefined,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listDomains(resourceGroup?: string): Promise<EventGridDomain[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: EventGridDomain[] = [];
      const iter = resourceGroup
        ? client.domains.listByResourceGroup(resourceGroup)
        : client.domains.listBySubscription();
      for await (const d of iter) {
        results.push({
          id: d.id ?? "",
          name: d.name ?? "",
          resourceGroup: d.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: d.location ?? "",
          endpoint: d.endpoint,
          provisioningState: d.provisioningState,
          publicNetworkAccess: d.publicNetworkAccess,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listSystemTopics(resourceGroup?: string): Promise<SystemTopic[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: SystemTopic[] = [];
      const iter = resourceGroup
        ? client.systemTopics.listByResourceGroup(resourceGroup)
        : client.systemTopics.listBySubscription();
      for await (const st of iter) {
        results.push({
          id: st.id ?? "",
          name: st.name ?? "",
          resourceGroup: st.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: st.location ?? "",
          source: st.source,
          topicType: st.topicType,
          provisioningState: st.provisioningState,
          metricResourceId: st.metricResourceId,
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createEventGridManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureEventGridManager {
  return new AzureEventGridManager(credentialsManager, subscriptionId, retryOptions);
}
