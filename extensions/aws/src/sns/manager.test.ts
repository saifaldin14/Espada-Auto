/**
 * SNS Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SNSManager, createSNSManager } from './manager.js';

// Mock SNS Client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSend })),
  CreateTopicCommand: vi.fn((input) => ({ input, _type: 'CreateTopicCommand' })),
  DeleteTopicCommand: vi.fn((input) => ({ input, _type: 'DeleteTopicCommand' })),
  GetTopicAttributesCommand: vi.fn((input) => ({ input, _type: 'GetTopicAttributesCommand' })),
  SetTopicAttributesCommand: vi.fn((input) => ({ input, _type: 'SetTopicAttributesCommand' })),
  ListTopicsCommand: vi.fn((input) => ({ input, _type: 'ListTopicsCommand' })),
  ListTagsForResourceCommand: vi.fn((input) => ({ input, _type: 'ListTagsForResourceCommand' })),
  TagResourceCommand: vi.fn((input) => ({ input, _type: 'TagResourceCommand' })),
  UntagResourceCommand: vi.fn((input) => ({ input, _type: 'UntagResourceCommand' })),
  SubscribeCommand: vi.fn((input) => ({ input, _type: 'SubscribeCommand' })),
  UnsubscribeCommand: vi.fn((input) => ({ input, _type: 'UnsubscribeCommand' })),
  ConfirmSubscriptionCommand: vi.fn((input) => ({ input, _type: 'ConfirmSubscriptionCommand' })),
  GetSubscriptionAttributesCommand: vi.fn((input) => ({ input, _type: 'GetSubscriptionAttributesCommand' })),
  SetSubscriptionAttributesCommand: vi.fn((input) => ({ input, _type: 'SetSubscriptionAttributesCommand' })),
  ListSubscriptionsCommand: vi.fn((input) => ({ input, _type: 'ListSubscriptionsCommand' })),
  ListSubscriptionsByTopicCommand: vi.fn((input) => ({ input, _type: 'ListSubscriptionsByTopicCommand' })),
  PublishCommand: vi.fn((input) => ({ input, _type: 'PublishCommand' })),
  PublishBatchCommand: vi.fn((input) => ({ input, _type: 'PublishBatchCommand' })),
  CreatePlatformApplicationCommand: vi.fn((input) => ({ input, _type: 'CreatePlatformApplicationCommand' })),
  DeletePlatformApplicationCommand: vi.fn((input) => ({ input, _type: 'DeletePlatformApplicationCommand' })),
  GetPlatformApplicationAttributesCommand: vi.fn((input) => ({ input, _type: 'GetPlatformApplicationAttributesCommand' })),
  SetPlatformApplicationAttributesCommand: vi.fn((input) => ({ input, _type: 'SetPlatformApplicationAttributesCommand' })),
  ListPlatformApplicationsCommand: vi.fn((input) => ({ input, _type: 'ListPlatformApplicationsCommand' })),
  CreatePlatformEndpointCommand: vi.fn((input) => ({ input, _type: 'CreatePlatformEndpointCommand' })),
  DeleteEndpointCommand: vi.fn((input) => ({ input, _type: 'DeleteEndpointCommand' })),
  GetEndpointAttributesCommand: vi.fn((input) => ({ input, _type: 'GetEndpointAttributesCommand' })),
  SetEndpointAttributesCommand: vi.fn((input) => ({ input, _type: 'SetEndpointAttributesCommand' })),
  ListEndpointsByPlatformApplicationCommand: vi.fn((input) => ({ input, _type: 'ListEndpointsByPlatformApplicationCommand' })),
  CreateSMSSandboxPhoneNumberCommand: vi.fn((input) => ({ input, _type: 'CreateSMSSandboxPhoneNumberCommand' })),
  DeleteSMSSandboxPhoneNumberCommand: vi.fn((input) => ({ input, _type: 'DeleteSMSSandboxPhoneNumberCommand' })),
  ListSMSSandboxPhoneNumbersCommand: vi.fn((input) => ({ input, _type: 'ListSMSSandboxPhoneNumbersCommand' })),
  VerifySMSSandboxPhoneNumberCommand: vi.fn((input) => ({ input, _type: 'VerifySMSSandboxPhoneNumberCommand' })),
  GetSMSAttributesCommand: vi.fn((input) => ({ input, _type: 'GetSMSAttributesCommand' })),
  SetSMSAttributesCommand: vi.fn((input) => ({ input, _type: 'SetSMSAttributesCommand' })),
  GetSMSSandboxAccountStatusCommand: vi.fn((input) => ({ input, _type: 'GetSMSSandboxAccountStatusCommand' })),
  CheckIfPhoneNumberIsOptedOutCommand: vi.fn((input) => ({ input, _type: 'CheckIfPhoneNumberIsOptedOutCommand' })),
  ListPhoneNumbersOptedOutCommand: vi.fn((input) => ({ input, _type: 'ListPhoneNumbersOptedOutCommand' })),
  OptInPhoneNumberCommand: vi.fn((input) => ({ input, _type: 'OptInPhoneNumberCommand' })),
  GetDataProtectionPolicyCommand: vi.fn((input) => ({ input, _type: 'GetDataProtectionPolicyCommand' })),
  PutDataProtectionPolicyCommand: vi.fn((input) => ({ input, _type: 'PutDataProtectionPolicyCommand' })),
}));

describe('SNSManager', () => {
  let manager: SNSManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SNSManager({ region: 'us-east-1' });
  });

  describe('createSNSManager', () => {
    it('should create an SNSManager instance', () => {
      const instance = createSNSManager({ region: 'us-west-2' });
      expect(instance).toBeInstanceOf(SNSManager);
    });

    it('should create with default config', () => {
      const instance = createSNSManager();
      expect(instance).toBeInstanceOf(SNSManager);
    });
  });

  // ===========================================================================
  // Topic Operations
  // ===========================================================================

  describe('Topic Operations', () => {
    describe('listTopics', () => {
      it('should list topics', async () => {
        mockSend.mockResolvedValueOnce({
          Topics: [
            { TopicArn: 'arn:aws:sns:us-east-1:123456789012:topic-1' },
            { TopicArn: 'arn:aws:sns:us-east-1:123456789012:topic-2' },
          ],
        });

        const result = await manager.listTopics();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should handle empty list', async () => {
        mockSend.mockResolvedValueOnce({ Topics: [] });

        const result = await manager.listTopics();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });

    describe('createTopic', () => {
      it('should create a standard topic', async () => {
        mockSend.mockResolvedValueOnce({
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:new-topic',
        });

        const result = await manager.createTopic({ name: 'new-topic' });
        expect(result.success).toBe(true);
        expect(result.data?.topicArn).toContain('new-topic');
      });

      it('should create a FIFO topic', async () => {
        mockSend.mockResolvedValueOnce({
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:new-topic.fifo',
        });

        const result = await manager.createTopic({ name: 'new-topic.fifo', fifo: true });
        expect(result.success).toBe(true);
      });

      it('should handle creation error', async () => {
        mockSend.mockRejectedValueOnce(new Error('TopicLimitExceededException'));

        const result = await manager.createTopic({ name: 'another-topic' });
        expect(result.success).toBe(false);
      });
    });

    describe('deleteTopic', () => {
      it('should delete a topic', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deleteTopic('arn:aws:sns:us-east-1:123456789012:test-topic');
        expect(result.success).toBe(true);
      });
    });

    describe('getTopic', () => {
      it('should get topic details', async () => {
        mockSend
          .mockResolvedValueOnce({
            Attributes: {
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              DisplayName: 'Test Topic',
              SubscriptionsConfirmed: '3',
              SubscriptionsPending: '1',
            },
          })
          .mockResolvedValueOnce({ Tags: [] });

        const result = await manager.getTopic('arn:aws:sns:us-east-1:123456789012:test-topic');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Subscription Operations
  // ===========================================================================

  describe('Subscription Operations', () => {
    describe('subscribe', () => {
      it('should create a subscription', async () => {
        mockSend.mockResolvedValueOnce({
          SubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic:sub-123',
        });

        const result = await manager.subscribe({
          topicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
          protocol: 'email',
          endpoint: 'user@example.com',
        });
        expect(result.success).toBe(true);
        expect(result.data?.subscriptionArn).toBeDefined();
      });
    });

    describe('unsubscribe', () => {
      it('should unsubscribe', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.unsubscribe('arn:aws:sns:us-east-1:123456789012:test-topic:sub-123');
        expect(result.success).toBe(true);
      });
    });

    describe('listSubscriptions', () => {
      it('should list all subscriptions', async () => {
        mockSend.mockResolvedValueOnce({
          Subscriptions: [
            { SubscriptionArn: 'arn:sub-1', TopicArn: 'arn:topic-1', Protocol: 'email', Endpoint: 'a@b.com' },
            { SubscriptionArn: 'arn:sub-2', TopicArn: 'arn:topic-1', Protocol: 'sqs', Endpoint: 'arn:sqs:q' },
          ],
        });

        const result = await manager.listSubscriptions();
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });
    });

    describe('listSubscriptionsByTopic', () => {
      it('should list subscriptions for a topic', async () => {
        mockSend.mockResolvedValueOnce({
          Subscriptions: [
            { SubscriptionArn: 'arn:sub-1', Protocol: 'email', Endpoint: 'a@b.com' },
          ],
        });

        const result = await manager.listSubscriptionsByTopic('arn:aws:sns:us-east-1:123456789012:test-topic');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  // Publish Operations
  // ===========================================================================

  describe('Publish Operations', () => {
    describe('publish', () => {
      it('should publish a message to a topic', async () => {
        mockSend.mockResolvedValueOnce({
          MessageId: 'msg-123',
        });

        const result = await manager.publish({
          topicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
          message: 'Hello World',
        });
        expect(result.success).toBe(true);
        expect(result.data?.messageId).toBe('msg-123');
      });

      it('should publish with subject', async () => {
        mockSend.mockResolvedValueOnce({ MessageId: 'msg-456' });

        const result = await manager.publish({
          topicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
          message: 'Hello World',
          subject: 'Alert',
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Platform Application Operations
  // ===========================================================================

  describe('Platform Application Operations', () => {
    describe('listPlatformApplications', () => {
      it('should list platform applications', async () => {
        mockSend.mockResolvedValueOnce({
          PlatformApplications: [
            { PlatformApplicationArn: 'arn:app-1', Attributes: { Enabled: 'true' } },
          ],
        });

        const result = await manager.listPlatformApplications();
        expect(result.success).toBe(true);
      });
    });

    describe('deletePlatformApplication', () => {
      it('should delete a platform application', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.deletePlatformApplication('arn:app-1');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // SMS Operations
  // ===========================================================================

  describe('SMS Operations', () => {
    describe('getSMSAttributes', () => {
      it('should get SMS attributes', async () => {
        mockSend.mockResolvedValueOnce({
          attributes: { DefaultSMSType: 'Transactional' },
        });

        const result = await manager.getSMSAttributes();
        expect(result.success).toBe(true);
      });
    });

    describe('getSMSSandboxStatus', () => {
      it('should get SMS sandbox status', async () => {
        mockSend.mockResolvedValueOnce({ IsInSandbox: true });

        const result = await manager.getSMSSandboxStatus();
        expect(result.success).toBe(true);
        expect(result.data?.isInSandbox).toBe(true);
      });
    });

    describe('checkPhoneNumberOptOut', () => {
      it('should check phone number opt out', async () => {
        mockSend.mockResolvedValueOnce({ isOptedOut: false });

        const result = await manager.checkPhoneNumberOptOut('+15551234567');
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Tagging Operations
  // ===========================================================================

  describe('Tagging Operations', () => {
    describe('tagResource', () => {
      it('should tag a resource', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.tagResource(
          'arn:aws:sns:us-east-1:123456789012:test-topic',
          { env: 'production' },
        );
        expect(result.success).toBe(true);
      });
    });

    describe('untagResource', () => {
      it('should untag a resource', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await manager.untagResource(
          'arn:aws:sns:us-east-1:123456789012:test-topic',
          ['env'],
        );
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle AWS errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('AuthorizationError'));

      const result = await manager.listTopics();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
