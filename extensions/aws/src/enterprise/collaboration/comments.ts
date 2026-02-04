/**
 * Comments & Discussions Service
 *
 * Threading, mentions, reactions, and inline comments on
 * plans, deployments, and other collaboration objects.
 */

import { randomUUID } from 'node:crypto';
import type {
  Comment,
  Discussion,
  Mention,
  CommentAttachment,
  CommentTargetType,
  DiscussionCategory,
  CollaborationResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface CommentStorage {
  // Comments
  createComment(comment: Comment): Promise<void>;
  getComment(commentId: string): Promise<Comment | null>;
  listComments(options: {
    targetType: CommentTargetType;
    targetId: string;
    parentId?: string | null;
  }): Promise<Comment[]>;
  updateComment(commentId: string, updates: Partial<Comment>): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  
  // Discussions
  createDiscussion(discussion: Discussion): Promise<void>;
  getDiscussion(discussionId: string): Promise<Discussion | null>;
  listDiscussions(options: {
    workspaceId?: string;
    projectId?: string;
    status?: Discussion['status'];
  }): Promise<Discussion[]>;
  updateDiscussion(discussionId: string, updates: Partial<Discussion>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryCommentStorage implements CommentStorage {
  private comments = new Map<string, Comment>();
  private discussions = new Map<string, Discussion>();

  async createComment(comment: Comment): Promise<void> {
    this.comments.set(comment.id, comment);
  }

  async getComment(commentId: string): Promise<Comment | null> {
    return this.comments.get(commentId) ?? null;
  }

  async listComments(options: {
    targetType: CommentTargetType;
    targetId: string;
    parentId?: string | null;
  }): Promise<Comment[]> {
    return Array.from(this.comments.values())
      .filter(c => {
        if (c.targetType !== options.targetType) return false;
        if (c.targetId !== options.targetId) return false;
        if (options.parentId !== undefined) {
          if (options.parentId === null && c.parentId) return false;
          if (options.parentId !== null && c.parentId !== options.parentId) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async updateComment(commentId: string, updates: Partial<Comment>): Promise<void> {
    const comment = this.comments.get(commentId);
    if (comment) {
      this.comments.set(commentId, { ...comment, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteComment(commentId: string): Promise<void> {
    this.comments.delete(commentId);
  }

  async createDiscussion(discussion: Discussion): Promise<void> {
    this.discussions.set(discussion.id, discussion);
  }

  async getDiscussion(discussionId: string): Promise<Discussion | null> {
    return this.discussions.get(discussionId) ?? null;
  }

  async listDiscussions(options: {
    workspaceId?: string;
    projectId?: string;
    status?: Discussion['status'];
  }): Promise<Discussion[]> {
    return Array.from(this.discussions.values())
      .filter(d => {
        if (options.workspaceId && d.workspaceId !== options.workspaceId) return false;
        if (options.projectId && d.projectId !== options.projectId) return false;
        if (options.status && d.status !== options.status) return false;
        return true;
      })
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  }

  async updateDiscussion(discussionId: string, updates: Partial<Discussion>): Promise<void> {
    const discussion = this.discussions.get(discussionId);
    if (discussion) {
      this.discussions.set(discussionId, { 
        ...discussion, 
        ...updates, 
        lastActivityAt: new Date().toISOString(),
      });
    }
  }
}

// =============================================================================
// Mention Parser
// =============================================================================

export interface MentionParser {
  parseMentions(content: string): Mention[];
  formatMentions(content: string, mentions: Mention[]): string;
}

class DefaultMentionParser implements MentionParser {
  private readonly userMentionRegex = /@\[([^\]]+)\]\(user:([^)]+)\)/g;
  private readonly teamMentionRegex = /@\[([^\]]+)\]\(team:([^)]+)\)/g;
  private readonly simpleMentionRegex = /@(\w+)/g;

  parseMentions(content: string): Mention[] {
    const mentions: Mention[] = [];

    // Parse formatted user mentions: @[Name](user:id)
    let match: RegExpExecArray | null;
    while ((match = this.userMentionRegex.exec(content)) !== null) {
      mentions.push({
        type: 'user',
        id: match[2],
        name: match[1],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }

    // Parse formatted team mentions: @[Team](team:id)
    while ((match = this.teamMentionRegex.exec(content)) !== null) {
      mentions.push({
        type: 'team',
        id: match[2],
        name: match[1],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }

    return mentions;
  }

  formatMentions(content: string, mentions: Mention[]): string {
    return content.replace(this.simpleMentionRegex, (match, username) => {
      const mention = mentions.find(m => m.name?.toLowerCase() === username.toLowerCase());
      if (mention) {
        return `@[${mention.name}](${mention.type}:${mention.id ?? ''})`;
      }
      return match;
    });
  }
}

// =============================================================================
// Comment Service
// =============================================================================

export interface MentionNotifier {
  notifyMention(mention: Mention, comment: Comment): Promise<void>;
}

class NoOpMentionNotifier implements MentionNotifier {
  async notifyMention(): Promise<void> {}
}

export interface CommentServiceConfig {
  maxCommentLength?: number;
  maxAttachments?: number;
  allowedReactions?: string[];
}

export class CommentService {
  private storage: CommentStorage;
  private mentionParser: MentionParser;
  private mentionNotifier: MentionNotifier;
  private config: CommentServiceConfig;

  constructor(
    config?: CommentServiceConfig,
    storage?: CommentStorage,
    mentionParser?: MentionParser,
    mentionNotifier?: MentionNotifier,
  ) {
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryCommentStorage();
    this.mentionParser = mentionParser ?? new DefaultMentionParser();
    this.mentionNotifier = mentionNotifier ?? new NoOpMentionNotifier();
  }

  // ===========================================================================
  // Comment Operations
  // ===========================================================================

  async createComment(
    tenantId: string,
    authorId: string,
    authorName: string,
    target: {
      type: CommentTargetType;
      id: string;
    },
    content: string,
    options?: {
      parentId?: string;
      threadId?: string;
      attachments?: CommentAttachment[];
    },
  ): Promise<CollaborationResult<Comment>> {
    // Validate content length
    if (this.config.maxCommentLength && content.length > this.config.maxCommentLength) {
      return { success: false, errors: [`Comment exceeds maximum length of ${this.config.maxCommentLength}`] };
    }

    // Validate attachments
    if (options?.attachments && this.config.maxAttachments && options.attachments.length > this.config.maxAttachments) {
      return { success: false, errors: [`Maximum ${this.config.maxAttachments} attachments allowed`] };
    }

    // Parse mentions
    const mentions = this.mentionParser.parseMentions(content);

    // Validate parent if reply
    if (options?.parentId) {
      const parent = await this.storage.getComment(options.parentId);
      if (!parent) {
        return { success: false, errors: ['Parent comment not found'] };
      }
      if (parent.targetType !== target.type || parent.targetId !== target.id) {
        return { success: false, errors: ['Parent comment is not on the same target'] };
      }
    }

    const now = new Date().toISOString();
    const commentId = `cmt_${randomUUID()}`;
    const comment: Comment = {
      id: commentId,
      tenantId,
      targetType: target.type,
      targetId: target.id,
      parentId: options?.parentId,
      threadId: options?.threadId ?? options?.parentId ?? commentId, // Self if root
      content,
      contentFormat: 'markdown',
      mentions,
      attachments: options?.attachments ?? [],
      reactions: [],
      authorId,
      authorName,
      resolved: false,
      edited: false,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.createComment(comment);

    // Notify mentioned users
    for (const mention of mentions) {
      await this.mentionNotifier.notifyMention(mention, comment);
    }

    return { success: true, data: comment };
  }

  async getComment(commentId: string): Promise<CollaborationResult<Comment>> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }
    return { success: true, data: comment };
  }

  async listComments(
    targetType: CommentTargetType,
    targetId: string,
    options?: { threaded?: boolean },
  ): Promise<CollaborationResult<Comment[]>> {
    if (options?.threaded) {
      // Get root comments only
      const rootComments = await this.storage.listComments({
        targetType,
        targetId,
        parentId: null,
      });

      // Fetch replies for each root comment
      for (const comment of rootComments) {
        const replies = await this.storage.listComments({
          targetType,
          targetId,
          parentId: comment.id,
        });
        (comment as Comment & { replies?: Comment[] }).replies = replies;
      }

      return { success: true, data: rootComments };
    }

    const comments = await this.storage.listComments({ targetType, targetId });
    return { success: true, data: comments };
  }

  async updateComment(
    commentId: string,
    userId: string,
    content: string,
  ): Promise<CollaborationResult<Comment>> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }

    if (comment.authorId !== userId) {
      return { success: false, errors: ['Only the author can edit this comment'] };
    }

    // Validate content length
    if (this.config.maxCommentLength && content.length > this.config.maxCommentLength) {
      return { success: false, errors: [`Comment exceeds maximum length of ${this.config.maxCommentLength}`] };
    }

    // Re-parse mentions
    const mentions = this.mentionParser.parseMentions(content);

    // Find new mentions to notify
    const existingMentionIds = new Set(comment.mentions.map(m => m.id));
    const newMentions = mentions.filter(m => !existingMentionIds.has(m.id));

    await this.storage.updateComment(commentId, {
      content,
      mentions,
      edited: true,
      editedAt: new Date().toISOString(),
    });

    // Notify new mentions
    const updatedComment = await this.storage.getComment(commentId);
    for (const mention of newMentions) {
      await this.mentionNotifier.notifyMention(mention, updatedComment!);
    }

    return { success: true, data: updatedComment! };
  }

  async deleteComment(commentId: string, userId: string): Promise<CollaborationResult> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }

    if (comment.authorId !== userId) {
      return { success: false, errors: ['Only the author can delete this comment'] };
    }

    // Check for replies
    const replies = await this.storage.listComments({
      targetType: comment.targetType,
      targetId: comment.targetId,
      parentId: commentId,
    });

    if (replies.length > 0) {
      // Soft delete - replace content
      await this.storage.updateComment(commentId, {
        content: '[deleted]',
        mentions: [],
        attachments: [],
        deleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: userId,
      });
    } else {
      await this.storage.deleteComment(commentId);
    }

    return { success: true, message: 'Comment deleted' };
  }

  // ===========================================================================
  // Reactions
  // ===========================================================================

  async addReaction(
    commentId: string,
    userId: string,
    emoji: string,
  ): Promise<CollaborationResult<Comment>> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }

    // Validate emoji if configured
    if (this.config.allowedReactions && !this.config.allowedReactions.includes(emoji)) {
      return { success: false, errors: ['Reaction not allowed'] };
    }

    // Find existing reaction with this emoji
    const existingReaction = comment.reactions.find(r => r.emoji === emoji);
    
    if (existingReaction) {
      if (existingReaction.users.includes(userId)) {
        return { success: false, errors: ['Already reacted with this emoji'] };
      }
      existingReaction.users.push(userId);
      existingReaction.count++;
    } else {
      comment.reactions.push({
        emoji,
        users: [userId],
        count: 1,
      });
    }

    await this.storage.updateComment(commentId, { reactions: comment.reactions });
    const updated = await this.storage.getComment(commentId);
    return { success: true, data: updated! };
  }

  async removeReaction(
    commentId: string,
    userId: string,
    emoji: string,
  ): Promise<CollaborationResult<Comment>> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }

    const reaction = comment.reactions.find(r => r.emoji === emoji);
    if (!reaction || !reaction.users.includes(userId)) {
      return { success: false, errors: ['Reaction not found'] };
    }

    reaction.users = reaction.users.filter(u => u !== userId);
    reaction.count--;

    // Remove reaction entirely if no users left
    if (reaction.count === 0) {
      const reactionIndex = comment.reactions.indexOf(reaction);
      comment.reactions.splice(reactionIndex, 1);
    }

    await this.storage.updateComment(commentId, { reactions: comment.reactions });
    const updated = await this.storage.getComment(commentId);
    return { success: true, data: updated! };
  }

  // ===========================================================================
  // Resolution
  // ===========================================================================

  async resolveComment(
    commentId: string,
    userId: string,
  ): Promise<CollaborationResult<Comment>> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }

    await this.storage.updateComment(commentId, {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy: userId,
    });

    const updated = await this.storage.getComment(commentId);
    return { success: true, data: updated! };
  }

  async unresolveComment(commentId: string): Promise<CollaborationResult<Comment>> {
    const comment = await this.storage.getComment(commentId);
    if (!comment) {
      return { success: false, errors: ['Comment not found'] };
    }

    await this.storage.updateComment(commentId, {
      resolved: false,
      resolvedAt: undefined,
      resolvedBy: undefined,
    });

    const updated = await this.storage.getComment(commentId);
    return { success: true, data: updated! };
  }

  // ===========================================================================
  // Discussions
  // ===========================================================================

  async createDiscussion(
    tenantId: string,
    createdBy: string,
    workspaceId: string,
    title: string,
    content: string,
    options?: {
      projectId?: string;
      category?: DiscussionCategory;
      labels?: string[];
      pinned?: boolean;
    },
  ): Promise<CollaborationResult<Discussion>> {
    const now = new Date().toISOString();
    const rootCommentId = `cmt_${randomUUID()}`;
    const discussionId = `disc_${randomUUID()}`;

    // Create the discussion
    const discussion: Discussion = {
      id: discussionId,
      tenantId,
      workspaceId,
      projectId: options?.projectId,
      title,
      category: options?.category ?? 'general',
      rootCommentId,
      commentCount: 1,
      participantCount: 1,
      lastActivityAt: now,
      status: 'open',
      pinned: options?.pinned ?? false,
      labels: options?.labels ?? [],
      createdAt: now,
      createdBy,
    };

    await this.storage.createDiscussion(discussion);

    // Create initial comment
    const mentions = this.mentionParser.parseMentions(content);
    const comment: Comment = {
      id: rootCommentId,
      tenantId,
      targetType: 'workspace', // Discussions are workspace-level
      targetId: discussionId,
      threadId: rootCommentId,
      content,
      contentFormat: 'markdown',
      mentions,
      attachments: [],
      reactions: [],
      authorId: createdBy,
      authorName: '', // Will be resolved by caller
      resolved: false,
      edited: false,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.createComment(comment);

    return { success: true, data: discussion };
  }

  async getDiscussion(discussionId: string): Promise<CollaborationResult<Discussion>> {
    const discussion = await this.storage.getDiscussion(discussionId);
    if (!discussion) {
      return { success: false, errors: ['Discussion not found'] };
    }
    return { success: true, data: discussion };
  }

  async listDiscussions(options: {
    workspaceId?: string;
    projectId?: string;
    status?: Discussion['status'];
  }): Promise<CollaborationResult<Discussion[]>> {
    const discussions = await this.storage.listDiscussions(options);
    return { success: true, data: discussions };
  }

  async closeDiscussion(
    discussionId: string,
    userId: string,
    reason?: string,
  ): Promise<CollaborationResult<Discussion>> {
    const discussion = await this.storage.getDiscussion(discussionId);
    if (!discussion) {
      return { success: false, errors: ['Discussion not found'] };
    }

    await this.storage.updateDiscussion(discussionId, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: userId,
      closeReason: reason,
    });

    const updated = await this.storage.getDiscussion(discussionId);
    return { success: true, data: updated! };
  }

  async lockDiscussion(discussionId: string): Promise<CollaborationResult<Discussion>> {
    const discussion = await this.storage.getDiscussion(discussionId);
    if (!discussion) {
      return { success: false, errors: ['Discussion not found'] };
    }

    await this.storage.updateDiscussion(discussionId, {
      status: 'locked',
    });

    const updated = await this.storage.getDiscussion(discussionId);
    return { success: true, data: updated! };
  }

  async pinDiscussion(
    discussionId: string,
    userId: string,
  ): Promise<CollaborationResult<Discussion>> {
    await this.storage.updateDiscussion(discussionId, { 
      pinned: true,
      pinnedAt: new Date().toISOString(),
      pinnedBy: userId,
    });
    const updated = await this.storage.getDiscussion(discussionId);
    if (!updated) {
      return { success: false, errors: ['Discussion not found'] };
    }
    return { success: true, data: updated };
  }

  async unpinDiscussion(discussionId: string): Promise<CollaborationResult<Discussion>> {
    await this.storage.updateDiscussion(discussionId, { 
      pinned: false,
      pinnedAt: undefined,
      pinnedBy: undefined,
    });
    const updated = await this.storage.getDiscussion(discussionId);
    if (!updated) {
      return { success: false, errors: ['Discussion not found'] };
    }
    return { success: true, data: updated };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCommentService(
  config?: CommentServiceConfig,
  storage?: CommentStorage,
  mentionParser?: MentionParser,
  mentionNotifier?: MentionNotifier,
): CommentService {
  return new CommentService(config, storage, mentionParser, mentionNotifier);
}
