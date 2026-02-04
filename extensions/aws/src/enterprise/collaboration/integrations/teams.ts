/**
 * Microsoft Teams Integration Service
 *
 * Enables Teams notifications for approvals, comments, and other
 * collaboration events using Adaptive Cards.
 */

import type {
  ApprovalRequest,
  Notification,
  TeamsIntegration,
  CollaborationResult,
} from '../types.js';

// =============================================================================
// Teams Client Interface
// =============================================================================

export interface TeamsClient {
  sendAdaptiveCard(webhookUrl: string, card: AdaptiveCard): Promise<{ messageId: string }>;
  updateAdaptiveCard(webhookUrl: string, messageId: string, card: AdaptiveCard): Promise<void>;
}

export interface AdaptiveCard {
  type: 'AdaptiveCard';
  $schema: string;
  version: string;
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
}

export interface AdaptiveCardElement {
  type: string;
  text?: string;
  size?: string;
  weight?: string;
  color?: string;
  wrap?: boolean;
  spacing?: string;
  columns?: Array<{
    type: string;
    width?: string | number;
    items?: AdaptiveCardElement[];
  }>;
  items?: AdaptiveCardElement[];
  facts?: Array<{ title: string; value: string }>;
  style?: string;
}

export interface AdaptiveCardAction {
  type: string;
  title: string;
  url?: string;
  data?: Record<string, unknown>;
  style?: string;
}

// =============================================================================
// Teams Integration Service
// =============================================================================

export interface TeamsIntegrationConfig {
  defaultWebhookUrl?: string;
}

// Alias for backward compatibility
export type TeamsServiceConfig = TeamsIntegrationConfig;

export class TeamsIntegrationService {
  private client: TeamsClient;
  private config: TeamsIntegrationConfig;
  private integrations = new Map<string, TeamsIntegration>();

  constructor(client: TeamsClient, config?: TeamsIntegrationConfig) {
    this.client = client;
    this.config = config ?? {};
  }

  // ===========================================================================
  // Integration Management
  // ===========================================================================

  async registerIntegration(workspaceId: string, integration: TeamsIntegration): Promise<CollaborationResult> {
    this.integrations.set(workspaceId, integration);
    return { success: true, message: 'Integration registered' };
  }

  async getIntegration(workspaceId: string): Promise<TeamsIntegration | null> {
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
    webhookUrl?: string,
  ): Promise<CollaborationResult<{ messageId: string }>> {
    const targetWebhook = webhookUrl ?? this.config.defaultWebhookUrl;
    if (!targetWebhook) {
      return { success: false, errors: ['No webhook URL specified'] };
    }

    const card = this.buildApprovalCard(request);

    try {
      const result = await this.client.sendAdaptiveCard(targetWebhook, card);
      return { success: true, data: { messageId: result.messageId } };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to send Teams message: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async updateApprovalMessage(
    webhookUrl: string,
    messageId: string,
    request: ApprovalRequest,
  ): Promise<CollaborationResult> {
    const card = this.buildApprovalCard(request);

    try {
      await this.client.updateAdaptiveCard(webhookUrl, messageId, card);
      return { success: true, message: 'Message updated' };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to update Teams message: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private buildApprovalCard(request: ApprovalRequest): AdaptiveCard {
    const statusColor = this.getStatusColor(request.status);
    const statusText = this.getStatusText(request.status);

    const card: AdaptiveCard = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'Container',
          style: 'emphasis',
          items: [
            {
              type: 'TextBlock',
              text: `📋 ${request.title}`,
              size: 'Large',
              weight: 'Bolder',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: statusText,
              color: statusColor,
              spacing: 'Small',
            },
          ],
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'Type', value: request.targetType },
            { title: 'Target', value: request.targetName },
            { title: 'Requested by', value: request.requestedBy },
            { title: 'Status', value: request.status },
          ],
        },
      ],
      actions: [],
    };

    if (request.description) {
      card.body.push({
        type: 'TextBlock',
        text: request.description,
        wrap: true,
        spacing: 'Medium',
      });
    }

    if (request.changes && request.changes.highlights.length > 0) {
      card.body.push({
        type: 'TextBlock',
        text: `**Changes:** ${request.changes.highlights.join(', ')}`,
        wrap: true,
        spacing: 'Small',
      });
    }

    // Add actions if pending
    if (request.status === 'pending' || request.status === 'in_review') {
      card.actions = [
        {
          type: 'Action.Submit',
          title: '✅ Approve',
          style: 'positive',
          data: { action: 'approve', requestId: request.id },
        },
        {
          type: 'Action.Submit',
          title: '❌ Reject',
          style: 'destructive',
          data: { action: 'reject', requestId: request.id },
        },
        {
          type: 'Action.OpenUrl',
          title: '📋 View Details',
          url: `https://example.com/approvals/${request.id}`,
        },
      ];
    }

    return card;
  }

  private getStatusColor(status: ApprovalRequest['status']): string {
    switch (status) {
      case 'pending':
      case 'in_review':
        return 'Warning';
      case 'approved':
        return 'Good';
      case 'rejected':
      case 'cancelled':
      case 'expired':
        return 'Attention';
      default:
        return 'Default';
    }
  }

  private getStatusText(status: ApprovalRequest['status']): string {
    switch (status) {
      case 'pending':
        return '⏳ Pending Approval';
      case 'in_review':
        return '👀 In Review';
      case 'approved':
        return '✅ Approved';
      case 'rejected':
        return '❌ Rejected';
      case 'cancelled':
        return '🚫 Cancelled';
      case 'expired':
        return '⏰ Expired';
      default:
        return status;
    }
  }

  // ===========================================================================
  // General Notifications
  // ===========================================================================

  async sendNotification(
    notification: Notification,
    webhookUrl?: string,
  ): Promise<CollaborationResult<{ messageId: string }>> {
    const targetWebhook = webhookUrl ?? this.config.defaultWebhookUrl;
    if (!targetWebhook) {
      return { success: false, errors: ['No webhook URL specified'] };
    }

    const card = this.buildNotificationCard(notification);

    try {
      const result = await this.client.sendAdaptiveCard(targetWebhook, card);
      return { success: true, data: { messageId: result.messageId } };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to send notification: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private buildNotificationCard(notification: Notification): AdaptiveCard {
    const card: AdaptiveCard = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: `📣 ${notification.title}`,
          size: 'Large',
          weight: 'Bolder',
          wrap: true,
        },
        {
          type: 'TextBlock',
          text: notification.body,
          wrap: true,
        },
      ],
      actions: [],
    };

    if (notification.targetUrl) {
      card.actions = [
        {
          type: 'Action.OpenUrl',
          title: 'View',
          url: notification.targetUrl,
        },
      ];
    }

    return card;
  }

  // ===========================================================================
  // Comment Notifications
  // ===========================================================================

  async sendCommentNotification(
    webhookUrl: string,
    authorName: string,
    content: string,
    targetName: string,
    actionUrl?: string,
  ): Promise<CollaborationResult<{ messageId: string }>> {
    const card: AdaptiveCard = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: `💬 ${authorName} commented on ${targetName}`,
          weight: 'Bolder',
          wrap: true,
        },
        {
          type: 'TextBlock',
          text: content.length > 200 ? `${content.slice(0, 200)}...` : content,
          wrap: true,
        },
      ],
      actions: actionUrl ? [
        {
          type: 'Action.OpenUrl',
          title: 'View Comment',
          url: actionUrl,
        },
      ] : [],
    };

    try {
      const result = await this.client.sendAdaptiveCard(webhookUrl, card);
      return { success: true, data: { messageId: result.messageId } };
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
const noOpTeamsClient: TeamsClient = {
  sendAdaptiveCard: async () => ({ messageId: '' }),
  updateAdaptiveCard: async () => {},
};

export function createTeamsIntegrationService(
  configOrClient?: TeamsIntegrationConfig | TeamsClient,
  config?: TeamsIntegrationConfig,
): TeamsIntegrationService {
  // If first arg has the client methods, it's a TeamsClient
  if (configOrClient && 'sendAdaptiveCard' in configOrClient) {
    return new TeamsIntegrationService(configOrClient, config);
  }
  // Otherwise it's config-only, use no-op client
  return new TeamsIntegrationService(noOpTeamsClient, configOrClient);
}
