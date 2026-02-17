/**
 * GCP Extension — Cloud Pub/Sub Manager
 *
 * Manages Pub/Sub topics, subscriptions, and message publishing.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all topics in the project. */
  async listTopics(): Promise<GcpPubSubTopic[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/topics`;
      return [] as GcpPubSubTopic[];
    }, this.retryOptions);
  }

  /** Get a single topic by name. */
  async getTopic(name: string): Promise<GcpPubSubTopic> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/${name}`;
      throw new Error(`Topic ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** Create a new topic. */
  async createTopic(
    topicId: string,
    opts?: { labels?: Record<string, string> },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/topics/${topicId}`;
      const _body = { labels: opts?.labels };
      return { success: true, message: `Topic ${topicId} created (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Delete a topic by name. */
  async deleteTopic(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/${name}`;
      return { success: true, message: `Topic ${name} deleted (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** List subscriptions, optionally filtered by topic. */
  async listSubscriptions(opts?: { topic?: string }): Promise<GcpPubSubSubscription[]> {
    return withGcpRetry(async () => {
      const _endpoint = opts?.topic
        ? `https://pubsub.googleapis.com/v1/${opts.topic}/subscriptions`
        : `https://pubsub.googleapis.com/v1/projects/${this.projectId}/subscriptions`;
      return [] as GcpPubSubSubscription[];
    }, this.retryOptions);
  }

  /** Get a single subscription by name. */
  async getSubscription(name: string): Promise<GcpPubSubSubscription> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/${name}`;
      throw new Error(`Subscription ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** Create a new subscription to a topic. */
  async createSubscription(
    subId: string,
    topic: string,
    opts?: { ackDeadlineSeconds?: number; pushEndpoint?: string },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/projects/${this.projectId}/subscriptions/${subId}`;
      const _body = {
        topic,
        ackDeadlineSeconds: opts?.ackDeadlineSeconds,
        pushConfig: opts?.pushEndpoint ? { pushEndpoint: opts.pushEndpoint } : undefined,
      };
      return { success: true, message: `Subscription ${subId} created (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Delete a subscription by name. */
  async deleteSubscription(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/${name}`;
      return { success: true, message: `Subscription ${name} deleted (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Publish messages to a topic. */
  async publish(
    topic: string,
    messages: Array<{ data: string; attributes?: Record<string, string> }>,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://pubsub.googleapis.com/v1/${topic}:publish`;
      const _body = { messages };
      return {
        success: true,
        message: `Published ${messages.length} message(s) to ${topic} (placeholder)`,
      } as GcpOperationResult;
    }, this.retryOptions);
  }
}
