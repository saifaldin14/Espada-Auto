/**
 * Notification Service
 *
 * Multi-channel notification system with templates and user preferences.
 */

import { randomUUID } from 'node:crypto';
import type {
  Notification,
  NotificationChannel,
  NotificationType,
  NotificationPreferences,
  CollaborationResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface NotificationStorage {
  // Notifications
  createNotification(notification: Notification): Promise<void>;
  getNotification(notificationId: string): Promise<Notification | null>;
  listNotifications(options: {
    userId?: string;
    channels?: NotificationChannel[];
    read?: boolean;
  }): Promise<Notification[]>;
  markAsRead(notificationId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  
  // Preferences
  getPreferences(userId: string, tenantId: string): Promise<NotificationPreferences | null>;
  savePreferences(preferences: NotificationPreferences): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryNotificationStorage implements NotificationStorage {
  private notifications = new Map<string, Notification>();
  private preferences = new Map<string, NotificationPreferences>();

  async createNotification(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  async getNotification(notificationId: string): Promise<Notification | null> {
    return this.notifications.get(notificationId) ?? null;
  }

  async listNotifications(options: {
    userId?: string;
    channels?: NotificationChannel[];
    read?: boolean;
  }): Promise<Notification[]> {
    return Array.from(this.notifications.values()).filter(n => {
      if (options.userId && n.userId !== options.userId) return false;
      if (options.channels && !options.channels.some(ch => n.channels.includes(ch))) return false;
      if (options.read !== undefined && n.read !== options.read) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async markAsRead(notificationId: string): Promise<void> {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.read = true;
      notification.readAt = new Date().toISOString();
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const notification of this.notifications.values()) {
      if (notification.userId === userId && !notification.read) {
        notification.read = true;
        notification.readAt = now;
      }
    }
  }

  async getPreferences(userId: string, tenantId: string): Promise<NotificationPreferences | null> {
    return this.preferences.get(`${tenantId}:${userId}`) ?? null;
  }

  async savePreferences(preferences: NotificationPreferences): Promise<void> {
    this.preferences.set(`${preferences.tenantId}:${preferences.userId}`, preferences);
  }
}

// =============================================================================
// Notification Service
// =============================================================================

export interface NotificationServiceConfig {
  defaultChannels?: NotificationChannel[];
}

export class NotificationService {
  private storage: NotificationStorage;
  private config: NotificationServiceConfig;

  constructor(config?: NotificationServiceConfig, storage?: NotificationStorage) {
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryNotificationStorage();
  }

  // ===========================================================================
  // Send Notifications
  // ===========================================================================

  async send(
    tenantId: string,
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    options?: {
      channels?: NotificationChannel[];
      targetType?: string;
      targetId?: string;
      targetUrl?: string;
      actorId?: string;
      actorName?: string;
      actorAvatar?: string;
      metadata?: Record<string, unknown>;
      expiresAt?: string;
    },
  ): Promise<CollaborationResult<Notification>> {
    // Get user preferences
    const preferences = await this.storage.getPreferences(userId, tenantId);
    
    // Check if user wants this type of notification
    if (preferences) {
      const typePrefs = preferences.typePreferences[type];
      if (typePrefs && !typePrefs.enabled) {
        return { success: false, errors: ['User has disabled this notification type'] };
      }
    }

    const now = new Date().toISOString();
    const channels = options?.channels ?? this.config.defaultChannels ?? ['in_app'];

    const notification: Notification = {
      id: `notif_${randomUUID()}`,
      tenantId,
      userId,
      type,
      title,
      body,
      channels,
      deliveredVia: [],
      targetType: options?.targetType,
      targetId: options?.targetId,
      targetUrl: options?.targetUrl,
      actorId: options?.actorId,
      actorName: options?.actorName,
      actorAvatar: options?.actorAvatar,
      metadata: options?.metadata,
      read: false,
      createdAt: now,
      expiresAt: options?.expiresAt,
    };

    await this.storage.createNotification(notification);
    
    // Deliver via channels
    await this.deliver(notification);

    return { success: true, data: notification };
  }

  private async deliver(notification: Notification): Promise<void> {
    for (const channel of notification.channels) {
      switch (channel) {
        case 'email':
          await this.deliverEmail(notification);
          break;
        case 'slack':
          await this.deliverSlack(notification);
          break;
        case 'teams':
          await this.deliverTeams(notification);
          break;
        case 'webhook':
          await this.deliverWebhook(notification);
          break;
        case 'in_app':
        default:
          // In-app notifications are stored only
          break;
      }
      notification.deliveredVia.push(channel);
    }
  }

  private async deliverEmail(_notification: Notification): Promise<void> {
    // Email delivery implementation
    // Would integrate with SES, SendGrid, etc.
  }

  private async deliverSlack(_notification: Notification): Promise<void> {
    // Slack delivery implementation
    // Would use Slack API or webhook
  }

  private async deliverTeams(_notification: Notification): Promise<void> {
    // Teams delivery implementation
    // Would use Teams webhook or Graph API
  }

  private async deliverWebhook(_notification: Notification): Promise<void> {
    // Generic webhook delivery
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  async sendBatch(
    notifications: Array<{
      tenantId: string;
      userId: string;
      type: NotificationType;
      title: string;
      body: string;
      channels?: NotificationChannel[];
    }>,
  ): Promise<CollaborationResult<{ sent: number; failed: number }>> {
    let sent = 0;
    let failed = 0;

    for (const notif of notifications) {
      const result = await this.send(
        notif.tenantId,
        notif.userId,
        notif.type,
        notif.title,
        notif.body,
        { channels: notif.channels },
      );
      if (result.success) {
        sent++;
      } else {
        failed++;
      }
    }

    return { success: true, data: { sent, failed } };
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  async listForUser(
    userId: string,
    options?: {
      unreadOnly?: boolean;
      channels?: NotificationChannel[];
      limit?: number;
    },
  ): Promise<CollaborationResult<Notification[]>> {
    let notifications = await this.storage.listNotifications({
      userId,
      channels: options?.channels,
      read: options?.unreadOnly ? false : undefined,
    });

    if (options?.limit) {
      notifications = notifications.slice(0, options.limit);
    }

    return { success: true, data: notifications };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const notifications = await this.storage.listNotifications({
      userId,
      read: false,
    });
    return notifications.length;
  }

  async markAsRead(notificationId: string): Promise<CollaborationResult> {
    await this.storage.markAsRead(notificationId);
    return { success: true, message: 'Notification marked as read' };
  }

  async markAllAsRead(userId: string): Promise<CollaborationResult> {
    await this.storage.markAllAsRead(userId);
    return { success: true, message: 'All notifications marked as read' };
  }

  // ===========================================================================
  // Preferences
  // ===========================================================================

  async getPreferences(userId: string, tenantId: string): Promise<NotificationPreferences | null> {
    return this.storage.getPreferences(userId, tenantId);
  }

  async savePreferences(
    userId: string,
    tenantId: string,
    channels: NotificationPreferences['channels'],
    typePreferences: NotificationPreferences['typePreferences'],
    options?: {
      enabled?: boolean;
      timezone?: string;
      quietHoursStart?: string;
      quietHoursEnd?: string;
    },
  ): Promise<CollaborationResult<NotificationPreferences>> {
    const preferences: NotificationPreferences = {
      tenantId,
      userId,
      enabled: options?.enabled ?? true,
      timezone: options?.timezone ?? 'UTC',
      quietHoursStart: options?.quietHoursStart,
      quietHoursEnd: options?.quietHoursEnd,
      channels,
      typePreferences,
      workspaceOverrides: {},
    };

    await this.storage.savePreferences(preferences);
    return { success: true, data: preferences };
  }

  // ===========================================================================
  // High-Level Notification Helpers
  // ===========================================================================

  async notifyApprovalRequest(
    tenantId: string,
    approverIds: string[],
    requestTitle: string,
    requesterId: string,
    requestId: string,
  ): Promise<void> {
    for (const approverId of approverIds) {
      await this.send(
        tenantId,
        approverId,
        'approval_request',
        'Approval Required',
        `You have a new approval request: ${requestTitle}`,
        {
          targetType: 'approval_request',
          targetId: requestId,
          metadata: { requesterId },
        },
      );
    }
  }

  async notifyApprovalResolution(
    tenantId: string,
    requesterId: string,
    requestTitle: string,
    resolution: 'approved' | 'rejected',
    resolvedBy: string,
    requestId: string,
  ): Promise<void> {
    const title = resolution === 'approved' ? 'Request Approved' : 'Request Rejected';
    const body = `Your request "${requestTitle}" has been ${resolution}`;

    await this.send(tenantId, requesterId, 'approval_decision', title, body, {
      targetType: 'approval_request',
      targetId: requestId,
      metadata: { resolvedBy, resolution },
    });
  }

  async notifyMention(
    tenantId: string,
    mentionedUserId: string,
    mentionedByName: string,
    contextType: string,
    contextId: string,
    snippet: string,
  ): Promise<void> {
    await this.send(
      tenantId,
      mentionedUserId,
      'mention',
      `${mentionedByName} mentioned you`,
      snippet,
      {
        targetType: contextType,
        targetId: contextId,
      },
    );
  }

  async notifyComment(
    tenantId: string,
    userId: string,
    authorName: string,
    targetType: string,
    targetId: string,
    snippet: string,
  ): Promise<void> {
    await this.send(
      tenantId,
      userId,
      'comment',
      `${authorName} commented`,
      snippet,
      {
        targetType,
        targetId,
      },
    );
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createNotificationService(
  config?: NotificationServiceConfig,
  storage?: NotificationStorage,
): NotificationService {
  return new NotificationService(config, storage);
}
