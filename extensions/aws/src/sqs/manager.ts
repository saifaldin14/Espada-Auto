/**
 * Amazon SQS Manager - Message Queue Operations
 * 
 * Comprehensive SQS operations with:
 * - Queue lifecycle (create, update, delete, purge)
 * - Standard and FIFO queue support
 * - Dead-letter queue configuration
 * - Message operations (send, receive, delete, batch)
 * - Queue attributes and policies
 * - Server-side encryption (SSE-SQS, SSE-KMS)
 * - Long polling and visibility timeout
 * - Redrive policies
 */

import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  ListQueuesCommand,
  ListQueueTagsCommand,
  TagQueueCommand,
  UntagQueueCommand,
  PurgeQueueCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  ChangeMessageVisibilityBatchCommand,
  ListDeadLetterSourceQueuesCommand,
  StartMessageMoveTaskCommand,
  CancelMessageMoveTaskCommand,
  ListMessageMoveTasksCommand,
  type Message,
  type MessageAttributeValue,
  type SendMessageBatchRequestEntry,
  type DeleteMessageBatchRequestEntry,
  type ChangeMessageVisibilityBatchRequestEntry,
  type ListMessageMoveTasksResultEntry,
  QueueAttributeName,
  MessageSystemAttributeName,
} from '@aws-sdk/client-sqs';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface SQSManagerConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxRetries?: number;
  defaultTags?: Record<string, string>;
}

export type QueueType = 'standard' | 'fifo';

export interface CreateQueueConfig {
  queueName: string;
  queueType?: QueueType;
  /** Delay in seconds before messages become visible (0-900) */
  delaySeconds?: number;
  /** Maximum message size in bytes (1024-262144) */
  maximumMessageSize?: number;
  /** Message retention period in seconds (60-1209600, default 345600 = 4 days) */
  messageRetentionPeriod?: number;
  /** Long polling wait time in seconds (0-20) */
  receiveMessageWaitTimeSeconds?: number;
  /** Default visibility timeout in seconds (0-43200) */
  visibilityTimeout?: number;
  /** Dead-letter queue configuration */
  deadLetterQueue?: {
    targetArn: string;
    maxReceiveCount: number;
  };
  /** Server-side encryption */
  encryption?: {
    type: 'SQS' | 'KMS';
    kmsKeyId?: string;
    kmsDataKeyReusePeriodSeconds?: number;
  };
  /** FIFO queue settings */
  fifoSettings?: {
    contentBasedDeduplication?: boolean;
    deduplicationScope?: 'messageGroup' | 'queue';
    fifoThroughputLimit?: 'perQueue' | 'perMessageGroupId';
  };
  /** Queue policy (JSON string) */
  policy?: string;
  tags?: Record<string, string>;
}

export interface UpdateQueueConfig {
  queueUrl: string;
  delaySeconds?: number;
  maximumMessageSize?: number;
  messageRetentionPeriod?: number;
  receiveMessageWaitTimeSeconds?: number;
  visibilityTimeout?: number;
  deadLetterQueue?: {
    targetArn: string;
    maxReceiveCount: number;
  } | null; // null to remove DLQ
  encryption?: {
    type: 'SQS' | 'KMS' | 'NONE';
    kmsKeyId?: string;
    kmsDataKeyReusePeriodSeconds?: number;
  };
  policy?: string | null; // null to remove policy
}

export interface SendMessageConfig {
  queueUrl: string;
  messageBody: string;
  delaySeconds?: number;
  messageAttributes?: Record<string, { dataType: string; stringValue?: string; binaryValue?: Uint8Array }>;
  /** Required for FIFO queues */
  messageGroupId?: string;
  /** For FIFO queues without content-based deduplication */
  messageDeduplicationId?: string;
}

export interface ReceiveMessageConfig {
  queueUrl: string;
  maxNumberOfMessages?: number; // 1-10
  visibilityTimeout?: number;
  waitTimeSeconds?: number; // Long polling (0-20)
  attributeNames?: MessageSystemAttributeName[];
  messageAttributeNames?: string[]; // Use ['All'] for all custom attributes
  receiveRequestAttemptId?: string; // For FIFO queues
}

export interface QueueMetrics {
  queueUrl: string;
  queueName: string;
  queueArn: string;
  queueType: QueueType;
  approximateNumberOfMessages: number;
  approximateNumberOfMessagesNotVisible: number;
  approximateNumberOfMessagesDelayed: number;
  createdTimestamp: Date;
  lastModifiedTimestamp: Date;
  visibilityTimeout: number;
  maximumMessageSize: number;
  messageRetentionPeriod: number;
  delaySeconds: number;
  receiveMessageWaitTimeSeconds: number;
  hasDeadLetterQueue: boolean;
  deadLetterQueueArn?: string;
  maxReceiveCount?: number;
  encryptionType?: 'SQS' | 'KMS' | 'NONE';
  kmsKeyId?: string;
  contentBasedDeduplication?: boolean;
  deduplicationScope?: string;
  fifoThroughputLimit?: string;
}

export interface SQSOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface MessageResult {
  messageId: string;
  md5OfMessageBody: string;
  md5OfMessageAttributes?: string;
  sequenceNumber?: string; // FIFO only
}

export interface ReceivedMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  md5OfBody: string;
  attributes?: Record<string, string>;
  messageAttributes?: Record<string, { dataType: string; stringValue?: string; binaryValue?: Uint8Array }>;
  approximateReceiveCount?: number;
  sentTimestamp?: Date;
  approximateFirstReceiveTimestamp?: Date;
  sequenceNumber?: string;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface BatchResultEntry {
  id: string;
  success: boolean;
  messageId?: string;
  error?: string;
  senderFault?: boolean;
}

// ============================================================================
// SQS Manager Implementation
// ============================================================================

export class SQSManager {
  private client: SQSClient;
  private config: SQSManagerConfig;

  constructor(config: SQSManagerConfig = {}) {
    this.config = config;
    
    this.client = new SQSClient({
      region: config.region,
      credentials: config.credentials,
      maxAttempts: config.maxRetries ?? 3,
    });
  }

  // ==========================================================================
  // Queue Operations
  // ==========================================================================

  /**
   * Create a new SQS queue
   */
  async createQueue(config: CreateQueueConfig): Promise<SQSOperationResult<{ queueUrl: string; queueArn: string }>> {
    try {
      const isFifo = config.queueType === 'fifo' || config.queueName.endsWith('.fifo');
      const queueName = isFifo && !config.queueName.endsWith('.fifo') 
        ? `${config.queueName}.fifo` 
        : config.queueName;

      const attributes: Record<string, string> = {};

      if (config.delaySeconds !== undefined) {
        attributes.DelaySeconds = String(config.delaySeconds);
      }
      if (config.maximumMessageSize !== undefined) {
        attributes.MaximumMessageSize = String(config.maximumMessageSize);
      }
      if (config.messageRetentionPeriod !== undefined) {
        attributes.MessageRetentionPeriod = String(config.messageRetentionPeriod);
      }
      if (config.receiveMessageWaitTimeSeconds !== undefined) {
        attributes.ReceiveMessageWaitTimeSeconds = String(config.receiveMessageWaitTimeSeconds);
      }
      if (config.visibilityTimeout !== undefined) {
        attributes.VisibilityTimeout = String(config.visibilityTimeout);
      }

      // Dead-letter queue
      if (config.deadLetterQueue) {
        attributes.RedrivePolicy = JSON.stringify({
          deadLetterTargetArn: config.deadLetterQueue.targetArn,
          maxReceiveCount: config.deadLetterQueue.maxReceiveCount,
        });
      }

      // Encryption
      if (config.encryption) {
        if (config.encryption.type === 'SQS') {
          attributes.SqsManagedSseEnabled = 'true';
        } else if (config.encryption.type === 'KMS') {
          attributes.KmsMasterKeyId = config.encryption.kmsKeyId ?? 'alias/aws/sqs';
          if (config.encryption.kmsDataKeyReusePeriodSeconds !== undefined) {
            attributes.KmsDataKeyReusePeriodSeconds = String(config.encryption.kmsDataKeyReusePeriodSeconds);
          }
        }
      }

      // FIFO settings
      if (isFifo) {
        attributes.FifoQueue = 'true';
        if (config.fifoSettings?.contentBasedDeduplication) {
          attributes.ContentBasedDeduplication = 'true';
        }
        if (config.fifoSettings?.deduplicationScope) {
          attributes.DeduplicationScope = config.fifoSettings.deduplicationScope;
        }
        if (config.fifoSettings?.fifoThroughputLimit) {
          attributes.FifoThroughputLimit = config.fifoSettings.fifoThroughputLimit;
        }
      }

      // Policy
      if (config.policy) {
        attributes.Policy = config.policy;
      }

      const response = await this.client.send(new CreateQueueCommand({
        QueueName: queueName,
        Attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        tags: { ...this.config.defaultTags, ...config.tags },
      }));

      // Get queue ARN
      const arnResponse = await this.client.send(new GetQueueAttributesCommand({
        QueueUrl: response.QueueUrl!,
        AttributeNames: [QueueAttributeName.QueueArn],
      }));

      return {
        success: true,
        data: {
          queueUrl: response.QueueUrl!,
          queueArn: arnResponse.Attributes?.QueueArn ?? '',
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
   * Delete a queue
   */
  async deleteQueue(queueUrl: string): Promise<SQSOperationResult<void>> {
    try {
      await this.client.send(new DeleteQueueCommand({
        QueueUrl: queueUrl,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get queue URL by name
   */
  async getQueueUrl(queueName: string, accountId?: string): Promise<SQSOperationResult<string>> {
    try {
      const response = await this.client.send(new GetQueueUrlCommand({
        QueueName: queueName,
        QueueOwnerAWSAccountId: accountId,
      }));

      return { success: true, data: response.QueueUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all queues
   */
  async listQueues(prefix?: string, maxResults?: number): Promise<SQSOperationResult<string[]>> {
    try {
      const queues: string[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.client.send(new ListQueuesCommand({
          QueueNamePrefix: prefix,
          MaxResults: maxResults ? Math.min(maxResults - queues.length, 1000) : 1000,
          NextToken: nextToken,
        }));

        queues.push(...(response.QueueUrls ?? []));
        nextToken = response.NextToken;

        if (maxResults && queues.length >= maxResults) break;
      } while (nextToken);

      return { success: true, data: queues };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get queue metrics and attributes
   */
  async getQueueMetrics(queueUrl: string): Promise<SQSOperationResult<QueueMetrics>> {
    try {
      const response = await this.client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [QueueAttributeName.All],
      }));

      const attrs = response.Attributes ?? {};
      const queueArn = attrs.QueueArn ?? '';
      const queueName = queueArn.split(':').pop() ?? '';
      const isFifo = queueName.endsWith('.fifo');

      let redrivePolicy: { deadLetterTargetArn?: string; maxReceiveCount?: number } = {};
      if (attrs.RedrivePolicy) {
        try {
          redrivePolicy = JSON.parse(attrs.RedrivePolicy);
        } catch {
          // Ignore parse errors
        }
      }

      const metrics: QueueMetrics = {
        queueUrl,
        queueName,
        queueArn,
        queueType: isFifo ? 'fifo' : 'standard',
        approximateNumberOfMessages: parseInt(attrs.ApproximateNumberOfMessages ?? '0', 10),
        approximateNumberOfMessagesNotVisible: parseInt(attrs.ApproximateNumberOfMessagesNotVisible ?? '0', 10),
        approximateNumberOfMessagesDelayed: parseInt(attrs.ApproximateNumberOfMessagesDelayed ?? '0', 10),
        createdTimestamp: new Date(parseInt(attrs.CreatedTimestamp ?? '0', 10) * 1000),
        lastModifiedTimestamp: new Date(parseInt(attrs.LastModifiedTimestamp ?? '0', 10) * 1000),
        visibilityTimeout: parseInt(attrs.VisibilityTimeout ?? '30', 10),
        maximumMessageSize: parseInt(attrs.MaximumMessageSize ?? '262144', 10),
        messageRetentionPeriod: parseInt(attrs.MessageRetentionPeriod ?? '345600', 10),
        delaySeconds: parseInt(attrs.DelaySeconds ?? '0', 10),
        receiveMessageWaitTimeSeconds: parseInt(attrs.ReceiveMessageWaitTimeSeconds ?? '0', 10),
        hasDeadLetterQueue: !!redrivePolicy.deadLetterTargetArn,
        deadLetterQueueArn: redrivePolicy.deadLetterTargetArn,
        maxReceiveCount: redrivePolicy.maxReceiveCount,
        encryptionType: attrs.SqsManagedSseEnabled === 'true' ? 'SQS' : attrs.KmsMasterKeyId ? 'KMS' : 'NONE',
        kmsKeyId: attrs.KmsMasterKeyId,
        contentBasedDeduplication: attrs.ContentBasedDeduplication === 'true',
        deduplicationScope: attrs.DeduplicationScope,
        fifoThroughputLimit: attrs.FifoThroughputLimit,
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
   * Update queue attributes
   */
  async updateQueue(config: UpdateQueueConfig): Promise<SQSOperationResult<void>> {
    try {
      const attributes: Record<string, string> = {};

      if (config.delaySeconds !== undefined) {
        attributes.DelaySeconds = String(config.delaySeconds);
      }
      if (config.maximumMessageSize !== undefined) {
        attributes.MaximumMessageSize = String(config.maximumMessageSize);
      }
      if (config.messageRetentionPeriod !== undefined) {
        attributes.MessageRetentionPeriod = String(config.messageRetentionPeriod);
      }
      if (config.receiveMessageWaitTimeSeconds !== undefined) {
        attributes.ReceiveMessageWaitTimeSeconds = String(config.receiveMessageWaitTimeSeconds);
      }
      if (config.visibilityTimeout !== undefined) {
        attributes.VisibilityTimeout = String(config.visibilityTimeout);
      }

      // Dead-letter queue
      if (config.deadLetterQueue !== undefined) {
        if (config.deadLetterQueue === null) {
          attributes.RedrivePolicy = '';
        } else {
          attributes.RedrivePolicy = JSON.stringify({
            deadLetterTargetArn: config.deadLetterQueue.targetArn,
            maxReceiveCount: config.deadLetterQueue.maxReceiveCount,
          });
        }
      }

      // Encryption
      if (config.encryption) {
        if (config.encryption.type === 'NONE') {
          attributes.SqsManagedSseEnabled = 'false';
          // Cannot remove KMS - queue must be recreated
        } else if (config.encryption.type === 'SQS') {
          attributes.SqsManagedSseEnabled = 'true';
        } else if (config.encryption.type === 'KMS') {
          attributes.KmsMasterKeyId = config.encryption.kmsKeyId ?? 'alias/aws/sqs';
          if (config.encryption.kmsDataKeyReusePeriodSeconds !== undefined) {
            attributes.KmsDataKeyReusePeriodSeconds = String(config.encryption.kmsDataKeyReusePeriodSeconds);
          }
        }
      }

      // Policy
      if (config.policy !== undefined) {
        attributes.Policy = config.policy ?? '';
      }

      await this.client.send(new SetQueueAttributesCommand({
        QueueUrl: config.queueUrl,
        Attributes: attributes,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Purge all messages from a queue
   */
  async purgeQueue(queueUrl: string): Promise<SQSOperationResult<void>> {
    try {
      await this.client.send(new PurgeQueueCommand({
        QueueUrl: queueUrl,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Message Operations
  // ==========================================================================

  /**
   * Send a message to a queue
   */
  async sendMessage(config: SendMessageConfig): Promise<SQSOperationResult<MessageResult>> {
    try {
      const messageAttributes: Record<string, MessageAttributeValue> | undefined = config.messageAttributes
        ? Object.fromEntries(
            Object.entries(config.messageAttributes).map(([key, value]) => [
              key,
              {
                DataType: value.dataType,
                StringValue: value.stringValue,
                BinaryValue: value.binaryValue,
              },
            ])
          )
        : undefined;

      const response = await this.client.send(new SendMessageCommand({
        QueueUrl: config.queueUrl,
        MessageBody: config.messageBody,
        DelaySeconds: config.delaySeconds,
        MessageAttributes: messageAttributes,
        MessageGroupId: config.messageGroupId,
        MessageDeduplicationId: config.messageDeduplicationId,
      }));

      return {
        success: true,
        data: {
          messageId: response.MessageId!,
          md5OfMessageBody: response.MD5OfMessageBody!,
          md5OfMessageAttributes: response.MD5OfMessageAttributes,
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
   * Send multiple messages in a batch (up to 10)
   */
  async sendMessageBatch(
    queueUrl: string,
    messages: {
      id: string;
      messageBody: string;
      delaySeconds?: number;
      messageAttributes?: Record<string, { dataType: string; stringValue?: string; binaryValue?: Uint8Array }>;
      messageGroupId?: string;
      messageDeduplicationId?: string;
    }[]
  ): Promise<SQSOperationResult<BatchResultEntry[]>> {
    try {
      const entries: SendMessageBatchRequestEntry[] = messages.map(msg => ({
        Id: msg.id,
        MessageBody: msg.messageBody,
        DelaySeconds: msg.delaySeconds,
        MessageAttributes: msg.messageAttributes
          ? Object.fromEntries(
              Object.entries(msg.messageAttributes).map(([key, value]) => [
                key,
                {
                  DataType: value.dataType,
                  StringValue: value.stringValue,
                  BinaryValue: value.binaryValue,
                },
              ])
            )
          : undefined,
        MessageGroupId: msg.messageGroupId,
        MessageDeduplicationId: msg.messageDeduplicationId,
      }));

      const response = await this.client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries,
      }));

      const results: BatchResultEntry[] = [
        ...(response.Successful ?? []).map(s => ({
          id: s.Id!,
          success: true,
          messageId: s.MessageId,
        })),
        ...(response.Failed ?? []).map(f => ({
          id: f.Id!,
          success: false,
          error: f.Message,
          senderFault: f.SenderFault,
        })),
      ];

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Receive messages from a queue
   */
  async receiveMessages(config: ReceiveMessageConfig): Promise<SQSOperationResult<ReceivedMessage[]>> {
    try {
      const response = await this.client.send(new ReceiveMessageCommand({
        QueueUrl: config.queueUrl,
        MaxNumberOfMessages: config.maxNumberOfMessages ?? 1,
        VisibilityTimeout: config.visibilityTimeout,
        WaitTimeSeconds: config.waitTimeSeconds,
        AttributeNames: config.attributeNames ? config.attributeNames as unknown as QueueAttributeName[] : [QueueAttributeName.All],
        MessageAttributeNames: config.messageAttributeNames ?? ['All'],
        ReceiveRequestAttemptId: config.receiveRequestAttemptId,
      }));

      const messages: ReceivedMessage[] = (response.Messages ?? []).map(msg => ({
        messageId: msg.MessageId!,
        receiptHandle: msg.ReceiptHandle!,
        body: msg.Body!,
        md5OfBody: msg.MD5OfBody!,
        attributes: msg.Attributes,
        messageAttributes: msg.MessageAttributes
          ? Object.fromEntries(
              Object.entries(msg.MessageAttributes).map(([key, value]) => [
                key,
                {
                  dataType: value.DataType!,
                  stringValue: value.StringValue,
                  binaryValue: value.BinaryValue,
                },
              ])
            )
          : undefined,
        approximateReceiveCount: msg.Attributes?.ApproximateReceiveCount
          ? parseInt(msg.Attributes.ApproximateReceiveCount, 10)
          : undefined,
        sentTimestamp: msg.Attributes?.SentTimestamp
          ? new Date(parseInt(msg.Attributes.SentTimestamp, 10))
          : undefined,
        approximateFirstReceiveTimestamp: msg.Attributes?.ApproximateFirstReceiveTimestamp
          ? new Date(parseInt(msg.Attributes.ApproximateFirstReceiveTimestamp, 10))
          : undefined,
        sequenceNumber: msg.Attributes?.SequenceNumber,
        messageGroupId: msg.Attributes?.MessageGroupId,
        messageDeduplicationId: msg.Attributes?.MessageDeduplicationId,
      }));

      return { success: true, data: messages };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a message from a queue
   */
  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<SQSOperationResult<void>> {
    try {
      await this.client.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete multiple messages in a batch (up to 10)
   */
  async deleteMessageBatch(
    queueUrl: string,
    messages: { id: string; receiptHandle: string }[]
  ): Promise<SQSOperationResult<BatchResultEntry[]>> {
    try {
      const entries: DeleteMessageBatchRequestEntry[] = messages.map(msg => ({
        Id: msg.id,
        ReceiptHandle: msg.receiptHandle,
      }));

      const response = await this.client.send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries,
      }));

      const results: BatchResultEntry[] = [
        ...(response.Successful ?? []).map(s => ({
          id: s.Id!,
          success: true,
        })),
        ...(response.Failed ?? []).map(f => ({
          id: f.Id!,
          success: false,
          error: f.Message,
          senderFault: f.SenderFault,
        })),
      ];

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Change the visibility timeout of a message
   */
  async changeMessageVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeout: number
  ): Promise<SQSOperationResult<void>> {
    try {
      await this.client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Change visibility timeout for multiple messages
   */
  async changeMessageVisibilityBatch(
    queueUrl: string,
    messages: { id: string; receiptHandle: string; visibilityTimeout: number }[]
  ): Promise<SQSOperationResult<BatchResultEntry[]>> {
    try {
      const entries: ChangeMessageVisibilityBatchRequestEntry[] = messages.map(msg => ({
        Id: msg.id,
        ReceiptHandle: msg.receiptHandle,
        VisibilityTimeout: msg.visibilityTimeout,
      }));

      const response = await this.client.send(new ChangeMessageVisibilityBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries,
      }));

      const results: BatchResultEntry[] = [
        ...(response.Successful ?? []).map(s => ({
          id: s.Id!,
          success: true,
        })),
        ...(response.Failed ?? []).map(f => ({
          id: f.Id!,
          success: false,
          error: f.Message,
          senderFault: f.SenderFault,
        })),
      ];

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Dead-Letter Queue Operations
  // ==========================================================================

  /**
   * List source queues for a dead-letter queue
   */
  async listDeadLetterSourceQueues(dlqUrl: string): Promise<SQSOperationResult<string[]>> {
    try {
      const queues: string[] = [];
      let nextToken: string | undefined;

      do {
        const response = await this.client.send(new ListDeadLetterSourceQueuesCommand({
          QueueUrl: dlqUrl,
          NextToken: nextToken,
        }));

        queues.push(...(response.queueUrls ?? []));
        nextToken = response.NextToken;
      } while (nextToken);

      return { success: true, data: queues };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start moving messages from DLQ back to source queue
   */
  async startMessageMoveTask(
    sourceArn: string,
    destinationArn?: string,
    maxNumberOfMessagesPerSecond?: number
  ): Promise<SQSOperationResult<{ taskHandle: string }>> {
    try {
      const response = await this.client.send(new StartMessageMoveTaskCommand({
        SourceArn: sourceArn,
        DestinationArn: destinationArn,
        MaxNumberOfMessagesPerSecond: maxNumberOfMessagesPerSecond,
      }));

      return {
        success: true,
        data: { taskHandle: response.TaskHandle! },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cancel a message move task
   */
  async cancelMessageMoveTask(taskHandle: string): Promise<SQSOperationResult<{ approximateNumberOfMessagesMoved: number }>> {
    try {
      const response = await this.client.send(new CancelMessageMoveTaskCommand({
        TaskHandle: taskHandle,
      }));

      return {
        success: true,
        data: { approximateNumberOfMessagesMoved: response.ApproximateNumberOfMessagesMoved ?? 0 },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List message move tasks
   */
  async listMessageMoveTasks(sourceArn: string): Promise<SQSOperationResult<ListMessageMoveTasksResultEntry[]>> {
    try {
      const response = await this.client.send(new ListMessageMoveTasksCommand({
        SourceArn: sourceArn,
      }));

      return { success: true, data: response.Results ?? [] };
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
   * Tag a queue
   */
  async tagQueue(queueUrl: string, tags: Record<string, string>): Promise<SQSOperationResult<void>> {
    try {
      await this.client.send(new TagQueueCommand({
        QueueUrl: queueUrl,
        Tags: tags,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Remove tags from a queue
   */
  async untagQueue(queueUrl: string, tagKeys: string[]): Promise<SQSOperationResult<void>> {
    try {
      await this.client.send(new UntagQueueCommand({
        QueueUrl: queueUrl,
        TagKeys: tagKeys,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List tags for a queue
   */
  async listQueueTags(queueUrl: string): Promise<SQSOperationResult<Record<string, string>>> {
    try {
      const response = await this.client.send(new ListQueueTagsCommand({
        QueueUrl: queueUrl,
      }));

      return { success: true, data: response.Tags ?? {} };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Create a dead-letter queue pair (main queue + DLQ)
   */
  async createQueueWithDLQ(
    queueName: string,
    maxReceiveCount: number = 3,
    options: Partial<CreateQueueConfig> = {}
  ): Promise<SQSOperationResult<{ mainQueueUrl: string; dlqUrl: string; mainQueueArn: string; dlqArn: string }>> {
    try {
      // Create DLQ first
      const dlqName = options.queueType === 'fifo' || queueName.endsWith('.fifo')
        ? `${queueName.replace('.fifo', '')}-dlq.fifo`
        : `${queueName}-dlq`;

      const dlqResult = await this.createQueue({
        queueName: dlqName,
        queueType: options.queueType,
        encryption: options.encryption,
        tags: options.tags,
      });

      if (!dlqResult.success || !dlqResult.data) {
        return { success: false, error: dlqResult.error ?? 'Failed to create DLQ' };
      }

      // Create main queue with redrive policy
      const mainResult = await this.createQueue({
        ...options,
        queueName,
        deadLetterQueue: {
          targetArn: dlqResult.data.queueArn,
          maxReceiveCount,
        },
      });

      if (!mainResult.success || !mainResult.data) {
        // Cleanup DLQ if main queue creation fails
        await this.deleteQueue(dlqResult.data.queueUrl);
        return { success: false, error: mainResult.error ?? 'Failed to create main queue' };
      }

      return {
        success: true,
        data: {
          mainQueueUrl: mainResult.data.queueUrl,
          dlqUrl: dlqResult.data.queueUrl,
          mainQueueArn: mainResult.data.queueArn,
          dlqArn: dlqResult.data.queueArn,
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
   * Get estimated monthly cost for a queue based on current message counts
   */
  async estimateQueueCost(queueUrl: string): Promise<SQSOperationResult<{
    estimatedRequestsCostUsd: number;
    dataTransferCostUsd: number;
    totalCostUsd: number;
    assumptionsNote: string;
  }>> {
    try {
      const metricsResult = await this.getQueueMetrics(queueUrl);
      if (!metricsResult.success || !metricsResult.data) {
        return { success: false, error: metricsResult.error ?? 'Failed to get queue metrics' };
      }

      const metrics = metricsResult.data;
      
      // Rough estimation based on current message count
      // Assuming current count represents daily average, project to monthly
      const estimatedMonthlyMessages = metrics.approximateNumberOfMessages * 30;
      
      // SQS pricing: $0.40 per million requests (first 1M free)
      const requestsPerMessage = 2; // Send + Receive
      const totalRequests = estimatedMonthlyMessages * requestsPerMessage;
      const billableRequests = Math.max(0, totalRequests - 1_000_000);
      const requestsCost = (billableRequests / 1_000_000) * 0.40;

      // Data transfer: Assume average 1KB message, $0.09/GB
      const avgMessageSizeBytes = 1024;
      const totalDataBytes = estimatedMonthlyMessages * avgMessageSizeBytes;
      const totalDataGB = totalDataBytes / (1024 * 1024 * 1024);
      const dataTransferCost = totalDataGB * 0.09;

      return {
        success: true,
        data: {
          estimatedRequestsCostUsd: Math.round(requestsCost * 100) / 100,
          dataTransferCostUsd: Math.round(dataTransferCost * 100) / 100,
          totalCostUsd: Math.round((requestsCost + dataTransferCost) * 100) / 100,
          assumptionsNote: `Based on current queue depth of ${metrics.approximateNumberOfMessages} messages, assuming this represents daily average, 1KB avg message size, 2 API calls per message (send+receive).`,
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
   * Process messages with a handler function (consumer pattern)
   */
  async processMessages<T = unknown>(
    queueUrl: string,
    handler: (message: ReceivedMessage) => Promise<T>,
    options: {
      maxMessages?: number;
      visibilityTimeout?: number;
      waitTimeSeconds?: number;
      deleteOnSuccess?: boolean;
      stopOnError?: boolean;
    } = {}
  ): Promise<SQSOperationResult<{ processed: number; failed: number; results: T[] }>> {
    try {
      const receiveResult = await this.receiveMessages({
        queueUrl,
        maxNumberOfMessages: options.maxMessages ?? 10,
        visibilityTimeout: options.visibilityTimeout ?? 30,
        waitTimeSeconds: options.waitTimeSeconds ?? 0,
      });

      if (!receiveResult.success || !receiveResult.data) {
        return { success: false, error: receiveResult.error };
      }

      const results: T[] = [];
      let processed = 0;
      let failed = 0;

      for (const message of receiveResult.data) {
        try {
          const result = await handler(message);
          results.push(result);
          processed++;

          if (options.deleteOnSuccess !== false) {
            await this.deleteMessage(queueUrl, message.receiptHandle);
          }
        } catch (error) {
          failed++;
          if (options.stopOnError) {
            return {
              success: false,
              data: { processed, failed, results },
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
      }

      return {
        success: true,
        data: { processed, failed, results },
      };
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

export function createSQSManager(config?: SQSManagerConfig): SQSManager {
  return new SQSManager(config);
}

// ============================================================================
// Tool Definitions for Agent Integration
// ============================================================================

export const sqsToolDefinitions = {
  sqs_create_queue: {
    name: 'sqs_create_queue',
    description: 'Create a new SQS queue (standard or FIFO)',
    parameters: {
      type: 'object',
      properties: {
        queueName: { type: 'string', description: 'Name of the queue (add .fifo suffix for FIFO queues)' },
        queueType: { type: 'string', enum: ['standard', 'fifo'], description: 'Queue type' },
        delaySeconds: { type: 'number', description: 'Message delay in seconds (0-900)' },
        visibilityTimeout: { type: 'number', description: 'Default visibility timeout (0-43200 seconds)' },
        messageRetentionPeriod: { type: 'number', description: 'Message retention in seconds (60-1209600)' },
        encryption: { type: 'boolean', description: 'Enable server-side encryption' },
        deadLetterQueueArn: { type: 'string', description: 'ARN of dead-letter queue' },
        maxReceiveCount: { type: 'number', description: 'Max receives before sending to DLQ' },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['queueName'],
    },
  },
  sqs_list_queues: {
    name: 'sqs_list_queues',
    description: 'List all SQS queues in the account',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Filter by queue name prefix' },
        maxResults: { type: 'number', description: 'Maximum number of results' },
      },
    },
  },
  sqs_get_queue_metrics: {
    name: 'sqs_get_queue_metrics',
    description: 'Get detailed metrics and attributes for a queue',
    parameters: {
      type: 'object',
      properties: {
        queueUrl: { type: 'string', description: 'Queue URL' },
      },
      required: ['queueUrl'],
    },
  },
  sqs_send_message: {
    name: 'sqs_send_message',
    description: 'Send a message to an SQS queue',
    parameters: {
      type: 'object',
      properties: {
        queueUrl: { type: 'string', description: 'Queue URL' },
        messageBody: { type: 'string', description: 'Message content' },
        delaySeconds: { type: 'number', description: 'Delay before message becomes visible' },
        messageGroupId: { type: 'string', description: 'Message group ID (required for FIFO)' },
        messageDeduplicationId: { type: 'string', description: 'Deduplication ID (for FIFO without content-based dedup)' },
      },
      required: ['queueUrl', 'messageBody'],
    },
  },
  sqs_receive_messages: {
    name: 'sqs_receive_messages',
    description: 'Receive messages from an SQS queue',
    parameters: {
      type: 'object',
      properties: {
        queueUrl: { type: 'string', description: 'Queue URL' },
        maxMessages: { type: 'number', description: 'Max messages to receive (1-10)' },
        waitTimeSeconds: { type: 'number', description: 'Long polling wait time (0-20 seconds)' },
        visibilityTimeout: { type: 'number', description: 'Visibility timeout for received messages' },
      },
      required: ['queueUrl'],
    },
  },
  sqs_delete_message: {
    name: 'sqs_delete_message',
    description: 'Delete a message from an SQS queue',
    parameters: {
      type: 'object',
      properties: {
        queueUrl: { type: 'string', description: 'Queue URL' },
        receiptHandle: { type: 'string', description: 'Receipt handle of the message' },
      },
      required: ['queueUrl', 'receiptHandle'],
    },
  },
  sqs_purge_queue: {
    name: 'sqs_purge_queue',
    description: 'Delete all messages from an SQS queue',
    parameters: {
      type: 'object',
      properties: {
        queueUrl: { type: 'string', description: 'Queue URL' },
      },
      required: ['queueUrl'],
    },
  },
  sqs_create_queue_with_dlq: {
    name: 'sqs_create_queue_with_dlq',
    description: 'Create a queue with an associated dead-letter queue',
    parameters: {
      type: 'object',
      properties: {
        queueName: { type: 'string', description: 'Name of the main queue' },
        maxReceiveCount: { type: 'number', description: 'Max receives before sending to DLQ (default 3)' },
        queueType: { type: 'string', enum: ['standard', 'fifo'], description: 'Queue type' },
        encryption: { type: 'boolean', description: 'Enable encryption' },
      },
      required: ['queueName'],
    },
  },
  sqs_move_messages_from_dlq: {
    name: 'sqs_move_messages_from_dlq',
    description: 'Move messages from a dead-letter queue back to the source queue',
    parameters: {
      type: 'object',
      properties: {
        dlqArn: { type: 'string', description: 'ARN of the dead-letter queue' },
        destinationArn: { type: 'string', description: 'ARN of destination queue (optional, defaults to original source)' },
        maxMessagesPerSecond: { type: 'number', description: 'Rate limit for message movement' },
      },
      required: ['dlqArn'],
    },
  },
};
