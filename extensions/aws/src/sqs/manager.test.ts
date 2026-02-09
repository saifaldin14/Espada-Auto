/**
 * SQS Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQSManager, createSQSManager } from './manager.js';

// Mock SQS Client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: mockSend })),
  CreateQueueCommand: vi.fn((input) => ({ input, _type: 'CreateQueueCommand' })),
  DeleteQueueCommand: vi.fn((input) => ({ input, _type: 'DeleteQueueCommand' })),
  GetQueueUrlCommand: vi.fn((input) => ({ input, _type: 'GetQueueUrlCommand' })),
  GetQueueAttributesCommand: vi.fn((input) => ({ input, _type: 'GetQueueAttributesCommand' })),
  SetQueueAttributesCommand: vi.fn((input) => ({ input, _type: 'SetQueueAttributesCommand' })),
  ListQueuesCommand: vi.fn((input) => ({ input, _type: 'ListQueuesCommand' })),
  ListQueueTagsCommand: vi.fn((input) => ({ input, _type: 'ListQueueTagsCommand' })),
  TagQueueCommand: vi.fn((input) => ({ input, _type: 'TagQueueCommand' })),
  UntagQueueCommand: vi.fn((input) => ({ input, _type: 'UntagQueueCommand' })),
  PurgeQueueCommand: vi.fn((input) => ({ input, _type: 'PurgeQueueCommand' })),
  SendMessageCommand: vi.fn((input) => ({ input, _type: 'SendMessageCommand' })),
  SendMessageBatchCommand: vi.fn((input) => ({ input, _type: 'SendMessageBatchCommand' })),
  ReceiveMessageCommand: vi.fn((input) => ({ input, _type: 'ReceiveMessageCommand' })),
  DeleteMessageCommand: vi.fn((input) => ({ input, _type: 'DeleteMessageCommand' })),
  DeleteMessageBatchCommand: vi.fn((input) => ({ input, _type: 'DeleteMessageBatchCommand' })),
  ChangeMessageVisibilityCommand: vi.fn((input) => ({ input, _type: 'ChangeMessageVisibilityCommand' })),
  ChangeMessageVisibilityBatchCommand: vi.fn((input) => ({ input, _type: 'ChangeMessageVisibilityBatchCommand' })),
  ListDeadLetterSourceQueuesCommand: vi.fn((input) => ({ input, _type: 'ListDeadLetterSourceQueuesCommand' })),
  StartMessageMoveTaskCommand: vi.fn((input) => ({ input, _type: 'StartMessageMoveTaskCommand' })),
  CancelMessageMoveTaskCommand: vi.fn((input) => ({ input, _type: 'CancelMessageMoveTaskCommand' })),
  ListMessageMoveTasksCommand: vi.fn((input) => ({ input, _type: 'ListMessageMoveTasksCommand' })),
  QueueAttributeName: { All: 'All' },
  MessageSystemAttributeName: {},
}));

describe('SQSManager', () => {
  let manager: SQSManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SQSManager({ region: 'us-east-1' });
  });

  describe('createSQSManager', () => {
    it('should create an SQSManager instance', () => {
      const instance = createSQSManager({ region: 'us-west-2' });
      expect(instance).toBeInstanceOf(SQSManager);
    });

    it('should create with default config', () => {
      const instance = createSQSManager();
      expect(instance).toBeInstanceOf(SQSManager);
    });
  });

  // ===========================================================================
  // Queue Operations
  // ===========================================================================

  describe('Queue Operations', () => {
    describe('createQueue', () => {
      it('should create a standard queue', async () => {
        mockSend.mockResolvedValueOnce({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        });
        // getQueueAttributes for ARN
        mockSend.mockResolvedValueOnce({
          Attributes: { QueueArn: 'arn:aws:sqs:us-east-1:123456789012:test-queue' },
        });

        const result = await manager.createQueue({ queueName: 'test-queue' });
        expect(result.success).toBe(true);
        expect(result.data?.queueUrl).toContain('test-queue');
      });

      it('should create a FIFO queue', async () => {
        mockSend.mockResolvedValueOnce({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue.fifo',
        });
        mockSend.mockResolvedValueOnce({
          Attributes: { QueueArn: 'arn:aws:sqs:us-east-1:123456789012:test-queue.fifo' },
        });

        const result = await manager.createQueue({ queueName: 'test-queue.fifo', queueType: 'fifo' });
        expect(result.success).toBe(true);
      });

      it('should handle creation error', async () => {
        mockSend.mockRejectedValueOnce(new Error('QueueAlreadyExists'));

        const result = await manager.createQueue({ queueName: 'existing-queue' });
        expect(result.success).toBe(false);
      });
    });

    describe('deleteQueue', () => {
      it('should delete a queue', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteQueue('https://sqs.us-east-1.amazonaws.com/123456789012/test-queue');
        expect(result.success).toBe(true);
      });
    });

    describe('getQueueUrl', () => {
      it('should get queue URL by name', async () => {
        mockSend.mockResolvedValueOnce({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue',
        });

        const result = await manager.getQueueUrl('my-queue');
        expect(result.success).toBe(true);
        expect(result.data).toContain('my-queue');
      });
    });

    describe('listQueues', () => {
      it('should list queues', async () => {
        mockSend.mockResolvedValueOnce({
          QueueUrls: [
            'https://sqs.us-east-1.amazonaws.com/123456789012/queue-1',
            'https://sqs.us-east-1.amazonaws.com/123456789012/queue-2',
          ],
        });

        const result = await manager.listQueues();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should handle empty list', async () => {
        mockSend.mockResolvedValueOnce({ QueueUrls: [] });

        const result = await manager.listQueues();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('getQueueMetrics', () => {
      it('should get queue metrics', async () => {
        mockSend.mockResolvedValueOnce({
          Attributes: {
            QueueArn: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
            ApproximateNumberOfMessages: '42',
            ApproximateNumberOfMessagesNotVisible: '5',
            ApproximateNumberOfMessagesDelayed: '0',
            VisibilityTimeout: '30',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600',
          },
        });

        const result = await manager.getQueueMetrics('https://sqs.us-east-1.amazonaws.com/123456789012/test-queue');
        expect(result.success).toBe(true);
        expect(result.data?.approximateNumberOfMessages).toBe(42);
      });
    });

    describe('purgeQueue', () => {
      it('should purge a queue', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.purgeQueue('https://sqs.us-east-1.amazonaws.com/123456789012/test-queue');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  describe('Message Operations', () => {
    describe('sendMessage', () => {
      it('should send a message', async () => {
        mockSend.mockResolvedValueOnce({
          MessageId: 'msg-123',
          MD5OfMessageBody: 'abc123',
        });

        const result = await manager.sendMessage({
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
          messageBody: 'Hello World',
        });
        expect(result.success).toBe(true);
        expect(result.data?.messageId).toBe('msg-123');
      });
    });

    describe('receiveMessages', () => {
      it('should receive messages', async () => {
        mockSend.mockResolvedValueOnce({
          Messages: [
            { MessageId: 'msg-1', Body: 'Message 1', ReceiptHandle: 'handle-1' },
            { MessageId: 'msg-2', Body: 'Message 2', ReceiptHandle: 'handle-2' },
          ],
        });

        const result = await manager.receiveMessages({
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
          maxNumberOfMessages: 10,
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should handle empty receive', async () => {
        mockSend.mockResolvedValueOnce({ Messages: [] });

        const result = await manager.receiveMessages({
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('deleteMessage', () => {
      it('should delete a message', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteMessage(
          'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
          'receipt-handle-123',
        );
        expect(result.success).toBe(true);
      });
    });

    describe('sendMessageBatch', () => {
      it('should send batch messages', async () => {
        mockSend.mockResolvedValueOnce({
          Successful: [
            { Id: '1', MessageId: 'msg-1' },
            { Id: '2', MessageId: 'msg-2' },
          ],
          Failed: [],
        });

        const result = await manager.sendMessageBatch(
          'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
          [{ id: '1', messageBody: 'Msg 1' }, { id: '2', messageBody: 'Msg 2' }],
        );
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // DLQ Operations
  // ===========================================================================

  describe('Dead Letter Queue Operations', () => {
    describe('listDeadLetterSourceQueues', () => {
      it('should list DLQ source queues', async () => {
        mockSend.mockResolvedValueOnce({
          queueUrls: [
            'https://sqs.us-east-1.amazonaws.com/123456789012/source-queue-1',
          ],
        });

        const result = await manager.listDeadLetterSourceQueues(
          'https://sqs.us-east-1.amazonaws.com/123456789012/dlq',
        );
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Tag Operations
  // ===========================================================================

  describe('Tag Operations', () => {
    describe('tagQueue', () => {
      it('should tag a queue', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.tagQueue(
          'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
          { env: 'production' },
        );
        expect(result.success).toBe(true);
      });
    });

    describe('listQueueTags', () => {
      it('should list queue tags', async () => {
        mockSend.mockResolvedValueOnce({
          Tags: { env: 'production', team: 'platform' },
        });

        const result = await manager.listQueueTags(
          'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        );
        expect(result.success).toBe(true);
        expect(result.data?.env).toBe('production');
      });
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle AWS errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDeniedException'));

      const result = await manager.listQueues();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
