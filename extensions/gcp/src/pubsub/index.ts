/**
 * GCP Extension — Cloud Pub/Sub Manager
 *
 * Manages Pub/Sub topics, subscriptions, and message publishing.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpMutate, gcpRequest } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Pub/Sub topic. */
export type GcpPubSubTopic = {
  name: string;
  labels: Record<string, string>;
  messageStoragePolicy: Record<string, unknown>;
  kmsKeyName: string;
};

/** A Pub/Sub subscription. */
export type GcpPubSubSubscription = {
  name: string;
  topic: string;
  pushConfig?: { pushEndpoint: string; attributes?: Record<string, string> };
  ackDeadlineSeconds: number;
  messageRetention: string;
  labels: Record<string, string>;
  deadLetterPolicy?: { deadLetterTopic: string; maxDeliveryAttempts: number };
};

// =============================================================================
// Helpers
// =============================================================================

function mapTopic(raw: Record<string, unknown>): GcpPubSubTopic {
  return {
    name: (raw.name as string) ?? "",
    labels: (raw.labels as Record<string, string>) ?? {},
    messageStoragePolicy: (raw.messageStoragePolicy as Record<string, unknown>) ?? {},
    kmsKeyName: (raw.kmsKeyName as string) ?? "",
  };
}

function mapSubscription(raw: Record<string, unknown>): GcpPubSubSubscription {
  return {
    name: (raw.name as string) ?? "",
    topic: (raw.topic as string) ?? "",
    pushConfig: raw.pushConfig as GcpPubSubSubscription["pushConfig"],
    ackDeadlineSeconds: (raw.ackDeadlineSeconds as number) ?? 10,
    messageRetention: (raw.messageRetentionDuration as string) ?? "",
    labels: (raw.labels as Record<string, string>) ?? {},
    deadLetterPolicy: raw.deadLetterPolicy as GcpPubSubSubscription["deadLetterPolicy"],
  };
}

// =============================================================================
// GcpPubSubManager
// =============================================================================

/**
 * Manages GCP Cloud Pub/Sub resources.
 *
 * Provides methods for creating and managing topics and subscriptions,
 * and for publishing messages.
 */
export class GcpPubSubManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all topics in the project. */
  async listTopics(): Promise<GcpPubSubTopic[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/topics`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "topics");
      return raw.map(mapTopic);
    }, this.retryOptions);
  }

  /** Get a single topic by name. */
  async getTopic(name: string): Promise<GcpPubSubTopic> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const fullName = name.startsWith("projects/") ? name : `projects/${this.projectId}/topics/${name}`;
      const url = `https://pubsub.googleapis.com/v1/${fullName}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return mapTopic(raw);
    }, this.retryOptions);
  }

  /** Create a new topic. */
  async createTopic(
    topicId: string,
    opts?: { labels?: Record<string, string> },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/topics/${topicId}`;
      return gcpMutate(url, token, { labels: opts?.labels ?? {} }, "PUT");
    }, this.retryOptions);
  }

  /** Delete a topic by name. */
  async deleteTopic(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const fullName = name.startsWith("projects/") ? name : `projects/${this.projectId}/topics/${name}`;
      const url = `https://pubsub.googleapis.com/v1/${fullName}`;
      return gcpMutate(url, token, {}, "DELETE");
    }, this.retryOptions);
  }

  /** List subscriptions, optionally filtered by topic. */
  async listSubscriptions(opts?: { topic?: string }): Promise<GcpPubSubSubscription[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/subscriptions`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "subscriptions");
      const subs = raw.map(mapSubscription);
      if (opts?.topic) {
        const topicFull = opts.topic.startsWith("projects/")
          ? opts.topic
          : `projects/${this.projectId}/topics/${opts.topic}`;
        return subs.filter((s) => s.topic === topicFull);
      }
      return subs;
    }, this.retryOptions);
  }

  /** Get a single subscription by name. */
  async getSubscription(name: string): Promise<GcpPubSubSubscription> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const fullName = name.startsWith("projects/") ? name : `projects/${this.projectId}/subscriptions/${name}`;
      const url = `https://pubsub.googleapis.com/v1/${fullName}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return mapSubscription(raw);
    }, this.retryOptions);
  }

  /** Create a new subscription to a topic. */
  async createSubscription(
    subId: string,
    topic: string,
    opts?: { ackDeadlineSeconds?: number; pushEndpoint?: string },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/subscriptions/${subId}`;
      const topicFull = topic.startsWith("projects/") ? topic : `projects/${this.projectId}/topics/${topic}`;
      const body: Record<string, unknown> = {
        topic: topicFull,
        ackDeadlineSeconds: opts?.ackDeadlineSeconds ?? 10,
      };
      if (opts?.pushEndpoint) {
        body.pushConfig = { pushEndpoint: opts.pushEndpoint };
      }
      return gcpMutate(url, token, body, "PUT");
    }, this.retryOptions);
  }

  /** Delete a subscription by name. */
  async deleteSubscription(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const fullName = name.startsWith("projects/") ? name : `projects/${this.projectId}/subscriptions/${name}`;
      const url = `https://pubsub.googleapis.com/v1/${fullName}`;
      return gcpMutate(url, token, {}, "DELETE");
    }, this.retryOptions);
  }

  /** Publish messages to a topic. */
  async publish(
    topic: string,
    messages: Array<{ data: string; attributes?: Record<string, string> }>,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const topicFull = topic.startsWith("projects/") ? topic : `projects/${this.projectId}/topics/${topic}`;
      const url = `https://pubsub.googleapis.com/v1/${topicFull}:publish`;
      const encoded = messages.map((m) => ({
        data: Buffer.from(m.data).toString("base64"),
        attributes: m.attributes,
      }));
      await gcpRequest(url, token, { method: "POST", body: { messages: encoded } });
      return {
        success: true,
        message: `Published ${messages.length} message(s) to ${topicFull}`,
      } as GcpOperationResult;
    }, this.retryOptions);
  }
}
