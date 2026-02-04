/**
 * Slack Integration Service
 *
 * Enables Slack notifications for approvals, comments, and other
 * collaboration events.
 */

import type {
  ApprovalRequest,
  Notification,
  SlackIntegration,
  CollaborationResult,
} from '../types.js';

// =============================================================================
// Slack Client Interface
// =============================================================================

export interface SlackClient {
  postMessage(channel: string, blocks: SlackBlock[], text?: string): Promise<{ ts: string }>;
  updateMessage(channel: string, ts: string, blocks: SlackBlock[], text?: string): Promise<void>;
  openModal(triggerId: string, view: SlackView): Promise<void>;
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: { type: string; text: string; emoji?: boolean };
    action_id?: string;
    value?: string;
    style?: string;
    url?: string;
  }>;
  accessory?: {
    type: string;
    text?: { type: string; text: string };
    action_id?: string;
    value?: string;
    style?: string;
  };
  fields?: Array<{ type: string; text: string }>;
}

export interface SlackView {
  type: 'modal';
  title: { type: string; text: string };
  submit?: { type: string; text: string };
  close?: { type: string; text: string };
  blocks: SlackBlock[];
  private_metadata?: string;
  callback_id?: string;
}

// =============================================================================
// Slack Integration Service
// =============================================================================

export interface SlackIntegrationConfig {
  defaultChannel?: string;
  botName?: string;
  iconEmoji?: string;
}

// Alias for backward compatibility
export type SlackServiceConfig = SlackIntegrationConfig;

export class SlackIntegrationService {
  private client: SlackClient;
  private config: SlackIntegrationConfig;
  private integrations = new Map<string, SlackIntegration>();

  constructor(client: SlackClient, config?: SlackIntegrationConfig) {
    this.client = client;
    this.config = config ?? {};
  }

  // ===========================================================================
  // Integration Management
  // ===========================================================================

  async registerIntegration(workspaceId: string, integration: SlackIntegration): Promise<CollaborationResult> {
    this.integrations.set(workspaceId, integration);
    return { success: true, message: 'Integration registered' };
  }

  async getIntegration(workspaceId: string): Promise<SlackIntegration | null> {
    return this.integrations.get(workspaceId) ?? null;
  }

  async removeIntegration(workspaceId: string): Promise<CollaborationResult> {
    this.integrations.delete(workspaceId);
    return { success: true, message: 'Integration removed' };
  }

  // ===========================================================================
  // Approval Notifications
  // ===========================================================================

  async sendApprovalRequest(
    request: ApprovalRequest,
    channel?: string,
  ): Promise<CollaborationResult<{ messageTs: string }>> {
    const targetChannel = channel ?? this.config.defaultChannel;
    if (!targetChannel) {
      return { success: false, errors: ['No channel specified'] };
    }

    const blocks = this.buildApprovalRequestBlocks(request);
    const text = `Approval requested: ${request.title}`;

    try {
      const result = await this.client.postMessage(targetChannel, blocks, text);
      return { success: true, data: { messageTs: result.ts } };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to send Slack message: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async updateApprovalMessage(
    channel: string,
    messageTs: string,
    request: ApprovalRequest,
  ): Promise<CollaborationResult> {
    const blocks = this.buildApprovalRequestBlocks(request);
    const text = `Approval ${request.status}: ${request.title}`;

    try {
      await this.client.updateMessage(channel, messageTs, blocks, text);
      return { success: true, message: 'Message updated' };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to update Slack message: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private buildApprovalRequestBlocks(request: ApprovalRequest): SlackBlock[] {
    const statusEmoji = this.getStatusEmoji(request.status);
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji} ${request.title}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Type:*\n${request.targetType}` },
          { type: 'mrkdwn', text: `*Target:*\n${request.targetName}` },
          { type: 'mrkdwn', text: `*Requested by:*\n${request.requestedBy}` },
          { type: 'mrkdwn', text: `*Status:*\n${request.status}` },
        ],
      },
    ];

    if (request.description) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: request.description,
        },
      });
    }

    // Add changes summary from highlights
    if (request.changes && request.changes.highlights.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Changes:* ${request.changes.highlights.join(', ')}`,
        },
      });
    }

    // Add action buttons if pending
    if (request.status === 'pending' || request.status === 'in_review') {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve', emoji: true },
            action_id: `approve_${request.id}`,
            value: request.id,
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject', emoji: true },
            action_id: `reject_${request.id}`,
            value: request.id,
            style: 'danger',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📋 View Details', emoji: true },
            action_id: `view_${request.id}`,
            value: request.id,
          },
        ],
      });
    }

    return blocks;
  }

  private getStatusEmoji(status: ApprovalRequest['status']): string {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'in_review':
        return '👀';
      case 'approved':
        return '✅';
      case 'rejected':
        return '❌';
      case 'cancelled':
        return '🚫';
      case 'expired':
        return '⏰';
      default:
        return '📋';
    }
  }

  // ===========================================================================
  // General Notifications
  // ===========================================================================

  async sendNotification(
    notification: Notification,
    channel?: string,
  ): Promise<CollaborationResult<{ messageTs: string }>> {
    const targetChannel = channel ?? this.config.defaultChannel;
    if (!targetChannel) {
      return { success: false, errors: ['No channel specified'] };
    }

    const blocks = this.buildNotificationBlocks(notification);
    const text = notification.title;

    try {
      const result = await this.client.postMessage(targetChannel, blocks, text);
      return { success: true, data: { messageTs: result.ts } };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to send notification: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private buildNotificationBlocks(notification: Notification): SlackBlock[] {
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📣 *${notification.title}*\n${notification.body}`,
        },
      },
    ];

    if (notification.targetUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View',
              emoji: true,
            },
            url: notification.targetUrl,
          },
        ],
      });
    }

    return blocks;
  }

  // ===========================================================================
  // Comment Notifications
  // ===========================================================================

  async sendCommentNotification(
    channel: string,
    authorName: string,
    content: string,
    targetName: string,
    actionUrl?: string,
  ): Promise<CollaborationResult<{ messageTs: string }>> {
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 *${authorName}* commented on *${targetName}*:\n> ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`,
        },
      },
    ];

    if (actionUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Comment', emoji: true },
            url: actionUrl,
          },
        ],
      });
    }

    try {
      const result = await this.client.postMessage(channel, blocks);
      return { success: true, data: { messageTs: result.ts } };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to send comment notification: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

// Default no-op client for when no real client is provided
const noOpSlackClient: SlackClient = {
  postMessage: async () => ({ ts: '' }),
  updateMessage: async () => {},
  openModal: async () => {},
};

export function createSlackIntegrationService(
  configOrClient?: SlackIntegrationConfig | SlackClient,
  config?: SlackIntegrationConfig,
): SlackIntegrationService {
  // If first arg has the client methods, it's a SlackClient
  if (configOrClient && 'postMessage' in configOrClient) {
    return new SlackIntegrationService(configOrClient, config);
  }
  // Otherwise it's config-only, use no-op client
  return new SlackIntegrationService(noOpSlackClient, configOrClient);
}
