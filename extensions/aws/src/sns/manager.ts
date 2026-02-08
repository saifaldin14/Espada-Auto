/**
 * Amazon SNS Manager - Pub/Sub & Notifications
 * 
 * Comprehensive SNS operations with:
 * - Topic management (Standard & FIFO)
 * - Subscription management (multiple protocols)
 * - Message publishing (single & batch)
 * - Filter policies
 * - Dead-letter queues
 * - Platform applications (mobile push)
 * - SMS operations
 * - Data protection policies
 */

import { withAWSRetry, type AWSRetryOptions } from '../retry.js';

import {
  SNSClient,
  CreateTopicCommand,
  DeleteTopicCommand,
  GetTopicAttributesCommand,
  SetTopicAttributesCommand,
  ListTopicsCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  SubscribeCommand,
  UnsubscribeCommand,
  ConfirmSubscriptionCommand,
  GetSubscriptionAttributesCommand,
  SetSubscriptionAttributesCommand,
  ListSubscriptionsCommand,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
  PublishBatchCommand,
  CreatePlatformApplicationCommand,
  DeletePlatformApplicationCommand,
  GetPlatformApplicationAttributesCommand,
  SetPlatformApplicationAttributesCommand,
  ListPlatformApplicationsCommand,
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  GetEndpointAttributesCommand,
  SetEndpointAttributesCommand,
  ListEndpointsByPlatformApplicationCommand,
  CreateSMSSandboxPhoneNumberCommand,
  DeleteSMSSandboxPhoneNumberCommand,
  ListSMSSandboxPhoneNumbersCommand,
  VerifySMSSandboxPhoneNumberCommand,
  GetSMSAttributesCommand,
  SetSMSAttributesCommand,
  GetSMSSandboxAccountStatusCommand,
  CheckIfPhoneNumberIsOptedOutCommand,
  ListPhoneNumbersOptedOutCommand,
  OptInPhoneNumberCommand,
  GetDataProtectionPolicyCommand,
  PutDataProtectionPolicyCommand,
  type Topic,
  type Subscription,
  type PlatformApplication,
  type Endpoint,
  type PublishBatchRequestEntry,
  type MessageAttributeValue,
  type Tag,
} from '@aws-sdk/client-sns';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface SNSManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export interface CreateTopicConfig {
  name: string;
  /** Use FIFO topic for ordered, deduplicated messaging */
  fifo?: boolean;
  /** Enable content-based deduplication (FIFO only) */
  contentBasedDeduplication?: boolean;
  /** Display name for SMS subscriptions */
  displayName?: string;
  /** KMS key for encryption */
  kmsMasterKeyId?: string;
  /** Server-side encryption */
  signatureVersion?: '1' | '2';
  /** Message delivery policy */
  deliveryPolicy?: {
    http?: {
      defaultHealthyRetryPolicy?: {
        minDelayTarget?: number;
        maxDelayTarget?: number;
        numRetries?: number;
        numMaxDelayRetries?: number;
        numNoDelayRetries?: number;
        numMinDelayRetries?: number;
        backoffFunction?: 'arithmetic' | 'exponential' | 'geometric' | 'linear';
      };
      disableSubscriptionOverrides?: boolean;
    };
  };
  /** Enable tracing with X-Ray */
  tracingConfig?: 'Active' | 'PassThrough';
  /** Dead letter queue config */
  redrivePolicy?: {
    deadLetterTargetArn: string;
  };
  tags?: Record<string, string>;
}

export interface SubscriptionConfig {
  topicArn: string;
  protocol: 'http' | 'https' | 'email' | 'email-json' | 'sms' | 'sqs' | 'lambda' | 'firehose' | 'application';
  endpoint: string;
  /** Filter messages by attributes */
  filterPolicy?: Record<string, string[]>;
  /** Filter policy scope: MessageAttributes or MessageBody */
  filterPolicyScope?: 'MessageAttributes' | 'MessageBody';
  /** Return subscription ARN immediately */
  returnSubscriptionArn?: boolean;
  /** Enable raw message delivery (SQS, HTTP/S, Firehose) */
  rawMessageDelivery?: boolean;
  /** Dead letter queue for failed deliveries */
  redrivePolicy?: {
    deadLetterTargetArn: string;
  };
  /** Delivery policy for HTTP/S endpoints */
  deliveryPolicy?: string;
  /** Subscription role ARN (for Firehose) */
  subscriptionRoleArn?: string;
}

export interface PublishMessageConfig {
  topicArn?: string;
  targetArn?: string;
  phoneNumber?: string;
  message: string;
  /** Message to send when publishing to multiple protocols */
  messageStructure?: 'json';
  /** Message subject (for email protocol) */
  subject?: string;
  /** Message attributes for filtering */
  messageAttributes?: Record<string, {
    dataType: 'String' | 'Number' | 'Binary' | 'String.Array';
    stringValue?: string;
    binaryValue?: Uint8Array;
  }>;
  /** Message deduplication ID (FIFO topics) */
  messageDeduplicationId?: string;
  /** Message group ID (FIFO topics) */
  messageGroupId?: string;
}

export interface BatchPublishConfig {
  topicArn: string;
  messages: {
    id: string;
    message: string;
    subject?: string;
    messageAttributes?: Record<string, {
      dataType: 'String' | 'Number' | 'Binary';
      stringValue?: string;
      binaryValue?: Uint8Array;
    }>;
    messageDeduplicationId?: string;
    messageGroupId?: string;
  }[];
}

export interface CreatePlatformApplicationConfig {
  name: string;
  platform: 'ADM' | 'APNS' | 'APNS_SANDBOX' | 'GCM' | 'BAIDU' | 'WNS' | 'MPNS';
  attributes: Record<string, string>;
}

export interface CreatePlatformEndpointConfig {
  platformApplicationArn: string;
  token: string;
  customUserData?: string;
  attributes?: Record<string, string>;
}

export interface SMSAttributesConfig {
  defaultSenderID?: string;
  defaultSMSType?: 'Promotional' | 'Transactional';
  monthlySpendLimit?: string;
  deliveryStatusIAMRole?: string;
  deliveryStatusSuccessSamplingRate?: string;
  usageReportS3Bucket?: string;
}

export interface TopicMetrics {
  topicArn: string;
  topicName: string;
  displayName?: string;
  owner: string;
  policy: string;
  subscriptionsPending: number;
  subscriptionsConfirmed: number;
  subscriptionsDeleted: number;
  kmsMasterKeyId?: string;
  fifoTopic: boolean;
  contentBasedDeduplication?: boolean;
  tags: Record<string, string>;
}

export interface SNSOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// SNS Manager Implementation
// ============================================================================

export class SNSManager {
  private client: SNSClient;
  private config: SNSManagerConfig;
  private retryOptions: AWSRetryOptions;

  constructor(config: SNSManagerConfig = {}, retryOptions: AWSRetryOptions = {}) {
    this.config = config;
    this.retryOptions = retryOptions;
    this.client = new SNSClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });
  }

  // --------------------------------------------------------------------------
  // Retry Helper
  // --------------------------------------------------------------------------

  private async withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return withAWSRetry(fn, {
      ...this.retryOptions,
      label: label || this.retryOptions.label,
    });
  }

  // ==========================================================================
  // Topic Operations
  // ==========================================================================

  /**
   * Create a new SNS topic
   */
  async createTopic(config: CreateTopicConfig): Promise<SNSOperationResult<{ topicArn: string }>> {
    try {
      const attributes: Record<string, string> = {};

      if (config.displayName) {
        attributes.DisplayName = config.displayName;
      }
      if (config.kmsMasterKeyId) {
        attributes.KmsMasterKeyId = config.kmsMasterKeyId;
      }
      if (config.signatureVersion) {
        attributes.SignatureVersion = config.signatureVersion;
      }
      if (config.deliveryPolicy) {
        attributes.DeliveryPolicy = JSON.stringify(config.deliveryPolicy);
      }
      if (config.tracingConfig) {
        attributes.TracingConfig = config.tracingConfig;
      }
      if (config.fifo) {
        attributes.FifoTopic = 'true';
        if (config.contentBasedDeduplication) {
          attributes.ContentBasedDeduplication = 'true';
        }
      }

      const topicName = config.fifo && !config.name.endsWith('.fifo')
        ? `${config.name}.fifo`
        : config.name;

      const tags: Tag[] = Object.entries({ ...this.config.defaultTags, ...config.tags }).map(
        ([Key, Value]) => ({ Key, Value })
      );

      const response = await this.withRetry(
        () => this.client.send(new CreateTopicCommand({
          Name: topicName,
          Attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
          Tags: tags.length > 0 ? tags : undefined,
        })),
        'CreateTopic'
      );

      // Set redrive policy if specified
      if (config.redrivePolicy && response.TopicArn) {
        await this.withRetry(
          () => this.client.send(new SetTopicAttributesCommand({
            TopicArn: response.TopicArn,
            AttributeName: 'RedrivePolicy',
            AttributeValue: JSON.stringify(config.redrivePolicy),
          })),
          'SetTopicAttributes'
        );
      }

      return {
        success: true,
        data: { topicArn: response.TopicArn! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete an SNS topic
   */
  async deleteTopic(topicArn: string): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new DeleteTopicCommand({
          TopicArn: topicArn,
        })),
        'DeleteTopic'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get topic details
   */
  async getTopic(topicArn: string): Promise<SNSOperationResult<TopicMetrics>> {
    try {
      const [attributesResponse, tagsResponse] = await Promise.all([
        this.withRetry(() => this.client.send(new GetTopicAttributesCommand({ TopicArn: topicArn })), 'GetTopicAttributes'),
        this.withRetry(() => this.client.send(new ListTagsForResourceCommand({ ResourceArn: topicArn })), 'ListTagsForResource').catch(() => ({ Tags: [] })),
      ]);

      const attrs = attributesResponse.Attributes ?? {};
      const topicName = topicArn.split(':').pop() ?? '';

      const tags: Record<string, string> = {};
      for (const tag of tagsResponse.Tags ?? []) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }

      const metrics: TopicMetrics = {
        topicArn,
        topicName,
        displayName: attrs.DisplayName,
        owner: attrs.Owner ?? '',
        policy: attrs.Policy ?? '',
        subscriptionsPending: parseInt(attrs.SubscriptionsPending ?? '0', 10),
        subscriptionsConfirmed: parseInt(attrs.SubscriptionsConfirmed ?? '0', 10),
        subscriptionsDeleted: parseInt(attrs.SubscriptionsDeleted ?? '0', 10),
        kmsMasterKeyId: attrs.KmsMasterKeyId,
        fifoTopic: attrs.FifoTopic === 'true',
        contentBasedDeduplication: attrs.ContentBasedDeduplication === 'true',
        tags,
      };

      return { success: true, data: metrics };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all topics
   */
  async listTopics(): Promise<SNSOperationResult<Topic[]>> {
    try {
      const topics: Topic[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListTopicsCommand({
            NextToken: nextToken,
          })),
          'ListTopics'
        );

        topics.push(...(response.Topics ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: topics };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update topic attributes
   */
  async updateTopicAttribute(
    topicArn: string,
    attributeName: string,
    attributeValue: string
  ): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new SetTopicAttributesCommand({
          TopicArn: topicArn,
          AttributeName: attributeName,
          AttributeValue: attributeValue,
        })),
        'SetTopicAttributes'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Subscription Operations
  // ==========================================================================

  /**
   * Create a subscription
   */
  async subscribe(config: SubscriptionConfig): Promise<SNSOperationResult<{ subscriptionArn: string }>> {
    try {
      const attributes: Record<string, string> = {};

      if (config.filterPolicy) {
        attributes.FilterPolicy = JSON.stringify(config.filterPolicy);
      }
      if (config.filterPolicyScope) {
        attributes.FilterPolicyScope = config.filterPolicyScope;
      }
      if (config.rawMessageDelivery !== undefined) {
        attributes.RawMessageDelivery = String(config.rawMessageDelivery);
      }
      if (config.redrivePolicy) {
        attributes.RedrivePolicy = JSON.stringify(config.redrivePolicy);
      }
      if (config.deliveryPolicy) {
        attributes.DeliveryPolicy = config.deliveryPolicy;
      }
      if (config.subscriptionRoleArn) {
        attributes.SubscriptionRoleArn = config.subscriptionRoleArn;
      }

      const response = await this.withRetry(
        () => this.client.send(new SubscribeCommand({
          TopicArn: config.topicArn,
          Protocol: config.protocol,
          Endpoint: config.endpoint,
          Attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
          ReturnSubscriptionArn: config.returnSubscriptionArn ?? true,
        })),
        'Subscribe'
      );

      return {
        success: true,
        data: { subscriptionArn: response.SubscriptionArn ?? 'pending confirmation' },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(subscriptionArn: string): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new UnsubscribeCommand({
          SubscriptionArn: subscriptionArn,
        })),
        'Unsubscribe'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Confirm a subscription
   */
  async confirmSubscription(
    topicArn: string,
    token: string,
    authenticateOnUnsubscribe?: boolean
  ): Promise<SNSOperationResult<{ subscriptionArn: string }>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new ConfirmSubscriptionCommand({
          TopicArn: topicArn,
          Token: token,
          AuthenticateOnUnsubscribe: authenticateOnUnsubscribe ? 'true' : undefined,
        })),
        'ConfirmSubscription'
      );

      return {
        success: true,
        data: { subscriptionArn: response.SubscriptionArn! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get subscription attributes
   */
  async getSubscriptionAttributes(subscriptionArn: string): Promise<SNSOperationResult<Record<string, string>>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new GetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
        })),
        'GetSubscriptionAttributes'
      );

      return { success: true, data: response.Attributes ?? {} };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update subscription attribute
   */
  async updateSubscriptionAttribute(
    subscriptionArn: string,
    attributeName: string,
    attributeValue: string
  ): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName: attributeName,
          AttributeValue: attributeValue,
        })),
        'SetSubscriptionAttributes'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set filter policy on subscription
   */
  async setFilterPolicy(
    subscriptionArn: string,
    filterPolicy: Record<string, string[]>,
    scope: 'MessageAttributes' | 'MessageBody' = 'MessageAttributes'
  ): Promise<SNSOperationResult<void>> {
    try {
      await Promise.all([
        this.withRetry(
          () => this.client.send(new SetSubscriptionAttributesCommand({
            SubscriptionArn: subscriptionArn,
            AttributeName: 'FilterPolicy',
            AttributeValue: JSON.stringify(filterPolicy),
          })),
          'SetSubscriptionAttributes'
        ),
        this.withRetry(
          () => this.client.send(new SetSubscriptionAttributesCommand({
            SubscriptionArn: subscriptionArn,
            AttributeName: 'FilterPolicyScope',
            AttributeValue: scope,
          })),
          'SetSubscriptionAttributes'
        ),
      ]);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all subscriptions
   */
  async listSubscriptions(): Promise<SNSOperationResult<Subscription[]>> {
    try {
      const subscriptions: Subscription[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListSubscriptionsCommand({
            NextToken: nextToken,
          })),
          'ListSubscriptions'
        );

        subscriptions.push(...(response.Subscriptions ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: subscriptions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List subscriptions for a topic
   */
  async listSubscriptionsByTopic(topicArn: string): Promise<SNSOperationResult<Subscription[]>> {
    try {
      const subscriptions: Subscription[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListSubscriptionsByTopicCommand({
            TopicArn: topicArn,
            NextToken: nextToken,
          })),
          'ListSubscriptionsByTopic'
        );

        subscriptions.push(...(response.Subscriptions ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: subscriptions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Publishing Operations
  // ==========================================================================

  /**
   * Publish a message
   */
  async publish(config: PublishMessageConfig): Promise<SNSOperationResult<{
    messageId: string;
    sequenceNumber?: string;
  }>> {
    try {
      let messageAttributes: Record<string, MessageAttributeValue> | undefined;
      if (config.messageAttributes) {
        messageAttributes = {};
        for (const [key, value] of Object.entries(config.messageAttributes)) {
          messageAttributes[key] = {
            DataType: value.dataType,
            StringValue: value.stringValue,
            BinaryValue: value.binaryValue,
          };
        }
      }

      const response = await this.withRetry(
        () => this.client.send(new PublishCommand({
          TopicArn: config.topicArn,
          TargetArn: config.targetArn,
          PhoneNumber: config.phoneNumber,
          Message: config.message,
          MessageStructure: config.messageStructure,
          Subject: config.subject,
          MessageAttributes: messageAttributes,
          MessageDeduplicationId: config.messageDeduplicationId,
          MessageGroupId: config.messageGroupId,
        })),
        'Publish'
      );

      return {
        success: true,
        data: {
          messageId: response.MessageId!,
          sequenceNumber: response.SequenceNumber,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Publish multiple messages in a batch
   */
  async publishBatch(config: BatchPublishConfig): Promise<SNSOperationResult<{
    successful: { id: string; messageId: string; sequenceNumber?: string }[];
    failed: { id: string; code: string; message?: string }[];
  }>> {
    try {
      const entries: PublishBatchRequestEntry[] = config.messages.map(msg => {
        let messageAttributes: Record<string, MessageAttributeValue> | undefined;
        if (msg.messageAttributes) {
          messageAttributes = {};
          for (const [key, value] of Object.entries(msg.messageAttributes)) {
            messageAttributes[key] = {
              DataType: value.dataType,
              StringValue: value.stringValue,
              BinaryValue: value.binaryValue,
            };
          }
        }

        return {
          Id: msg.id,
          Message: msg.message,
          Subject: msg.subject,
          MessageAttributes: messageAttributes,
          MessageDeduplicationId: msg.messageDeduplicationId,
          MessageGroupId: msg.messageGroupId,
        };
      });

      const response = await this.withRetry(
        () => this.client.send(new PublishBatchCommand({
          TopicArn: config.topicArn,
          PublishBatchRequestEntries: entries,
        })),
        'PublishBatch'
      );

      return {
        success: true,
        data: {
          successful: (response.Successful ?? []).map(s => ({
            id: s.Id!,
            messageId: s.MessageId!,
            sequenceNumber: s.SequenceNumber,
          })),
          failed: (response.Failed ?? []).map(f => ({
            id: f.Id!,
            code: f.Code!,
            message: f.Message,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Publish to multiple protocols with different message formats
   */
  async publishMultiProtocol(
    topicArn: string,
    messages: {
      default: string;
      email?: string;
      sqs?: string;
      lambda?: string;
      http?: string;
      https?: string;
      sms?: string;
    },
    subject?: string
  ): Promise<SNSOperationResult<{ messageId: string }>> {
    try {
      const message = JSON.stringify(messages);

      const response = await this.withRetry(
        () => this.client.send(new PublishCommand({
          TopicArn: topicArn,
          Message: message,
          MessageStructure: 'json',
          Subject: subject,
        })),
        'Publish'
      );

      return {
        success: true,
        data: { messageId: response.MessageId! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Platform Application Operations (Mobile Push)
  // ==========================================================================

  /**
   * Create a platform application for mobile push
   */
  async createPlatformApplication(
    config: CreatePlatformApplicationConfig
  ): Promise<SNSOperationResult<{ platformApplicationArn: string }>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new CreatePlatformApplicationCommand({
          Name: config.name,
          Platform: config.platform,
          Attributes: config.attributes,
        })),
        'CreatePlatformApplication'
      );

      return {
        success: true,
        data: { platformApplicationArn: response.PlatformApplicationArn! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a platform application
   */
  async deletePlatformApplication(platformApplicationArn: string): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new DeletePlatformApplicationCommand({
          PlatformApplicationArn: platformApplicationArn,
        })),
        'DeletePlatformApplication'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List platform applications
   */
  async listPlatformApplications(): Promise<SNSOperationResult<PlatformApplication[]>> {
    try {
      const applications: PlatformApplication[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListPlatformApplicationsCommand({
            NextToken: nextToken,
          })),
          'ListPlatformApplications'
        );

        applications.push(...(response.PlatformApplications ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: applications };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a platform endpoint (device registration)
   */
  async createPlatformEndpoint(
    config: CreatePlatformEndpointConfig
  ): Promise<SNSOperationResult<{ endpointArn: string }>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new CreatePlatformEndpointCommand({
          PlatformApplicationArn: config.platformApplicationArn,
          Token: config.token,
          CustomUserData: config.customUserData,
          Attributes: config.attributes,
        })),
        'CreatePlatformEndpoint'
      );

      return {
        success: true,
        data: { endpointArn: response.EndpointArn! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a platform endpoint
   */
  async deletePlatformEndpoint(endpointArn: string): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new DeleteEndpointCommand({
          EndpointArn: endpointArn,
        })),
        'DeleteEndpoint'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List endpoints for a platform application
   */
  async listEndpoints(platformApplicationArn: string): Promise<SNSOperationResult<Endpoint[]>> {
    try {
      const endpoints: Endpoint[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListEndpointsByPlatformApplicationCommand({
            PlatformApplicationArn: platformApplicationArn,
            NextToken: nextToken,
          })),
          'ListEndpointsByPlatformApplication'
        );

        endpoints.push(...(response.Endpoints ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: endpoints };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send push notification to a mobile device
   */
  async sendPushNotification(
    endpointArn: string,
    message: {
      title?: string;
      body: string;
      data?: Record<string, string>;
    },
    platform: 'APNS' | 'APNS_SANDBOX' | 'GCM' | 'ADM'
  ): Promise<SNSOperationResult<{ messageId: string }>> {
    try {
      let payload: Record<string, unknown>;

      switch (platform) {
        case 'APNS':
        case 'APNS_SANDBOX':
          payload = {
            aps: {
              alert: {
                title: message.title,
                body: message.body,
              },
              sound: 'default',
            },
            ...message.data,
          };
          break;
        case 'GCM':
          payload = {
            notification: {
              title: message.title,
              body: message.body,
            },
            data: message.data,
          };
          break;
        case 'ADM':
          payload = {
            data: {
              message: message.body,
              title: message.title,
              ...message.data,
            },
          };
          break;
        default:
          payload = { message: message.body };
      }

      const messageStructure: Record<string, string> = {
        default: message.body,
        [platform]: JSON.stringify(payload),
      };

      const response = await this.withRetry(
        () => this.client.send(new PublishCommand({
          TargetArn: endpointArn,
          Message: JSON.stringify(messageStructure),
          MessageStructure: 'json',
        })),
        'Publish'
      );

      return {
        success: true,
        data: { messageId: response.MessageId! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // SMS Operations
  // ==========================================================================

  /**
   * Get SMS attributes
   */
  async getSMSAttributes(): Promise<SNSOperationResult<Record<string, string>>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new GetSMSAttributesCommand({
          attributes: [
            'DefaultSenderID',
            'DefaultSMSType',
            'MonthlySpendLimit',
            'DeliveryStatusIAMRole',
            'DeliveryStatusSuccessSamplingRate',
            'UsageReportS3Bucket',
          ],
        })),
        'GetSMSAttributes'
      );

      return { success: true, data: response.attributes ?? {} };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set SMS attributes
   */
  async setSMSAttributes(config: SMSAttributesConfig): Promise<SNSOperationResult<void>> {
    try {
      const attributes: Record<string, string> = {};

      if (config.defaultSenderID) {
        attributes.DefaultSenderID = config.defaultSenderID;
      }
      if (config.defaultSMSType) {
        attributes.DefaultSMSType = config.defaultSMSType;
      }
      if (config.monthlySpendLimit) {
        attributes.MonthlySpendLimit = config.monthlySpendLimit;
      }
      if (config.deliveryStatusIAMRole) {
        attributes.DeliveryStatusIAMRole = config.deliveryStatusIAMRole;
      }
      if (config.deliveryStatusSuccessSamplingRate) {
        attributes.DeliveryStatusSuccessSamplingRate = config.deliveryStatusSuccessSamplingRate;
      }
      if (config.usageReportS3Bucket) {
        attributes.UsageReportS3Bucket = config.usageReportS3Bucket;
      }

      await this.withRetry(
        () => this.client.send(new SetSMSAttributesCommand({ attributes })),
        'SetSMSAttributes'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send an SMS message
   */
  async sendSMS(
    phoneNumber: string,
    message: string,
    options?: {
      senderId?: string;
      smsType?: 'Promotional' | 'Transactional';
    }
  ): Promise<SNSOperationResult<{ messageId: string }>> {
    try {
      const messageAttributes: Record<string, MessageAttributeValue> = {};

      if (options?.senderId) {
        messageAttributes['AWS.SNS.SMS.SenderID'] = {
          DataType: 'String',
          StringValue: options.senderId,
        };
      }
      if (options?.smsType) {
        messageAttributes['AWS.SNS.SMS.SMSType'] = {
          DataType: 'String',
          StringValue: options.smsType,
        };
      }

      const response = await this.withRetry(
        () => this.client.send(new PublishCommand({
          PhoneNumber: phoneNumber,
          Message: message,
          MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        })),
        'Publish'
      );

      return {
        success: true,
        data: { messageId: response.MessageId! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if phone number is opted out
   */
  async checkPhoneNumberOptOut(phoneNumber: string): Promise<SNSOperationResult<boolean>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new CheckIfPhoneNumberIsOptedOutCommand({
          phoneNumber,
        })),
        'CheckIfPhoneNumberIsOptedOut'
      );

      return { success: true, data: response.isOptedOut ?? false };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List opted-out phone numbers
   */
  async listOptedOutPhoneNumbers(): Promise<SNSOperationResult<string[]>> {
    try {
      const phoneNumbers: string[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.withRetry(
          () => this.client.send(new ListPhoneNumbersOptedOutCommand({
            nextToken,
          })),
          'ListPhoneNumbersOptedOut'
        );

        phoneNumbers.push(...(response.phoneNumbers ?? []));
        nextToken = response.nextToken;
      } while (nextToken);

      return { success: true, data: phoneNumbers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Opt in a phone number
   */
  async optInPhoneNumber(phoneNumber: string): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new OptInPhoneNumberCommand({ phoneNumber })),
        'OptInPhoneNumber'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get SMS sandbox account status
   */
  async getSMSSandboxStatus(): Promise<SNSOperationResult<{ isInSandbox: boolean }>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new GetSMSSandboxAccountStatusCommand({})),
        'GetSMSSandboxAccountStatus'
      );

      return {
        success: true,
        data: { isInSandbox: response.IsInSandbox ?? true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Data Protection Operations
  // ==========================================================================

  /**
   * Get data protection policy
   */
  async getDataProtectionPolicy(topicArn: string): Promise<SNSOperationResult<string>> {
    try {
      const response = await this.withRetry(
        () => this.client.send(new GetDataProtectionPolicyCommand({
          ResourceArn: topicArn,
        })),
        'GetDataProtectionPolicy'
      );

      return { success: true, data: response.DataProtectionPolicy ?? '' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Put data protection policy
   */
  async putDataProtectionPolicy(
    topicArn: string,
    policy: {
      name: string;
      description?: string;
      version: string;
      statements: {
        sid: string;
        dataDirection: 'INBOUND' | 'OUTBOUND';
        principals: string[];
        dataSensitivity: ('PII' | 'PHI' | 'ADDRESS' | 'CREDENTIAL' | 'CREDIT_CARD')[];
        operation: {
          deidentify?: {
            maskConfig?: { maskWithCharacter?: string };
            redactConfig?: Record<never, never>;
          };
          deny?: Record<never, never>;
          audit?: {
            sampleRate: number;
            findingsDestination?: {
              cloudWatchLogs?: { logGroup: string };
              firehose?: { deliveryStream: string };
              s3?: { bucket: string; prefix?: string };
            };
          };
        };
      }[];
    }
  ): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new PutDataProtectionPolicyCommand({
          ResourceArn: topicArn,
          DataProtectionPolicy: JSON.stringify(policy),
        })),
        'PutDataProtectionPolicy'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Tag Operations
  // ==========================================================================

  /**
   * Add tags to a resource
   */
  async tagResource(resourceArn: string, tags: Record<string, string>): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new TagResourceCommand({
          ResourceArn: resourceArn,
          Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        })),
        'TagResource'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Remove tags from a resource
   */
  async untagResource(resourceArn: string, tagKeys: string[]): Promise<SNSOperationResult<void>> {
    try {
      await this.withRetry(
        () => this.client.send(new UntagResourceCommand({
          ResourceArn: resourceArn,
          TagKeys: tagKeys,
        })),
        'UntagResource'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSNSManager(config?: SNSManagerConfig): SNSManager {
  return new SNSManager(config);
}

// ============================================================================
// Tool Definitions for Agent Integration
// ============================================================================

export const snsToolDefinitions = {
  sns_create_topic: {
    name: 'sns_create_topic',
    description: 'Create an SNS topic for pub/sub messaging',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Topic name' },
        fifo: { type: 'boolean', description: 'Create FIFO topic for ordered delivery' },
        displayName: { type: 'string', description: 'Display name for SMS' },
        kmsMasterKeyId: { type: 'string', description: 'KMS key ID for encryption' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  sns_list_topics: {
    name: 'sns_list_topics',
    description: 'List all SNS topics',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  sns_subscribe: {
    name: 'sns_subscribe',
    description: 'Subscribe to an SNS topic',
    parameters: {
      type: 'object',
      properties: {
        topicArn: { type: 'string', description: 'Topic ARN' },
        protocol: { type: 'string', enum: ['http', 'https', 'email', 'email-json', 'sms', 'sqs', 'lambda', 'firehose', 'application'], description: 'Subscription protocol' },
        endpoint: { type: 'string', description: 'Endpoint (email, URL, queue ARN, etc.)' },
        filterPolicy: { type: 'object', description: 'Filter policy for message filtering' },
        rawMessageDelivery: { type: 'boolean', description: 'Enable raw message delivery' },
      },
      required: ['topicArn', 'protocol', 'endpoint'],
    },
  },
  sns_publish: {
    name: 'sns_publish',
    description: 'Publish a message to an SNS topic or endpoint',
    parameters: {
      type: 'object',
      properties: {
        topicArn: { type: 'string', description: 'Topic ARN to publish to' },
        message: { type: 'string', description: 'Message content' },
        subject: { type: 'string', description: 'Message subject (for email)' },
        messageGroupId: { type: 'string', description: 'Message group ID (FIFO topics)' },
        messageDeduplicationId: { type: 'string', description: 'Deduplication ID (FIFO topics)' },
      },
      required: ['message'],
    },
  },
  sns_send_sms: {
    name: 'sns_send_sms',
    description: 'Send an SMS message to a phone number',
    parameters: {
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
        message: { type: 'string', description: 'SMS message content' },
        senderId: { type: 'string', description: 'Sender ID' },
        smsType: { type: 'string', enum: ['Promotional', 'Transactional'], description: 'SMS type' },
      },
      required: ['phoneNumber', 'message'],
    },
  },
  sns_list_subscriptions: {
    name: 'sns_list_subscriptions',
    description: 'List all SNS subscriptions',
    parameters: {
      type: 'object',
      properties: {
        topicArn: { type: 'string', description: 'Filter by topic ARN' },
      },
    },
  },
  sns_create_platform_application: {
    name: 'sns_create_platform_application',
    description: 'Create a platform application for mobile push notifications',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Application name' },
        platform: { type: 'string', enum: ['APNS', 'APNS_SANDBOX', 'GCM', 'ADM', 'BAIDU', 'WNS', 'MPNS'], description: 'Push platform' },
        credential: { type: 'string', description: 'Platform credential (API key, certificate, etc.)' },
        principal: { type: 'string', description: 'Principal (APNS certificate)' },
      },
      required: ['name', 'platform', 'credential'],
    },
  },
  sns_send_push: {
    name: 'sns_send_push',
    description: 'Send a push notification to a mobile device',
    parameters: {
      type: 'object',
      properties: {
        endpointArn: { type: 'string', description: 'Device endpoint ARN' },
        title: { type: 'string', description: 'Notification title' },
        body: { type: 'string', description: 'Notification body' },
        platform: { type: 'string', enum: ['APNS', 'APNS_SANDBOX', 'GCM', 'ADM'], description: 'Push platform' },
      },
      required: ['endpointArn', 'body', 'platform'],
    },
  },
};
