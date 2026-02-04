/**
 * Shared Templates Library
 *
 * Version-controlled infrastructure templates with sharing,
 * ratings, and usage tracking.
 */

import { randomUUID } from 'node:crypto';
import type {
  SharedTemplate,
  TemplateVersion,
  TemplateParameter,
  TemplateShare,
  TemplateCategory,
  TemplateContent,
  CollaborationResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface TemplateStorage {
  // Templates
  createTemplate(template: SharedTemplate): Promise<void>;
  getTemplate(templateId: string): Promise<SharedTemplate | null>;
  listTemplates(options: {
    tenantId?: string;
    category?: TemplateCategory;
    visibility?: SharedTemplate['visibility'];
    ownerId?: string;
    tags?: string[];
    search?: string;
    sortBy?: 'name' | 'usage' | 'rating' | 'updated';
    limit?: number;
    offset?: number;
  }): Promise<SharedTemplate[]>;
  updateTemplate(templateId: string, updates: Partial<SharedTemplate>): Promise<void>;
  deleteTemplate(templateId: string): Promise<void>;
  
  // Ratings
  addRating(templateId: string, userId: string, rating: number, review?: string): Promise<void>;
  getUserRating(templateId: string, userId: string): Promise<{ rating: number; review?: string } | null>;
  
  // Usage
  incrementUsage(templateId: string): Promise<void>;
  trackUsage(templateId: string, projectId?: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryTemplateStorage implements TemplateStorage {
  private templates = new Map<string, SharedTemplate>();
  private ratings = new Map<string, Map<string, { rating: number; review?: string }>>();
  private usage = new Map<string, { projectId?: string; usedAt: string }[]>();

  async createTemplate(template: SharedTemplate): Promise<void> {
    this.templates.set(template.id, template);
  }

  async getTemplate(templateId: string): Promise<SharedTemplate | null> {
    return this.templates.get(templateId) ?? null;
  }

  async listTemplates(options: {
    tenantId?: string;
    category?: TemplateCategory;
    visibility?: SharedTemplate['visibility'];
    ownerId?: string;
    tags?: string[];
    search?: string;
    sortBy?: 'name' | 'usage' | 'rating' | 'updated';
    limit?: number;
    offset?: number;
  }): Promise<SharedTemplate[]> {
    let results = Array.from(this.templates.values()).filter(t => {
      if (options.tenantId && t.tenantId !== options.tenantId && t.visibility !== 'public') {
        return false;
      }
      if (options.category && t.category !== options.category) return false;
      if (options.visibility && t.visibility !== options.visibility) return false;
      if (options.ownerId && t.ownerId !== options.ownerId) return false;
      if (options.tags?.length && !options.tags.some(tag => t.tags.includes(tag))) return false;
      if (options.search) {
        const searchLower = options.search.toLowerCase();
        if (!t.name.toLowerCase().includes(searchLower) && 
            !t.description?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      return true;
    });

    // Sort
    switch (options.sortBy) {
      case 'name':
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'usage':
        results.sort((a, b) => b.usageCount - a.usageCount);
        break;
      case 'rating':
        results.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        break;
      case 'updated':
      default:
        results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async updateTemplate(templateId: string, updates: Partial<SharedTemplate>): Promise<void> {
    const template = this.templates.get(templateId);
    if (template) {
      this.templates.set(templateId, { ...template, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteTemplate(templateId: string): Promise<void> {
    this.templates.delete(templateId);
  }

  async addRating(templateId: string, userId: string, rating: number, review?: string): Promise<void> {
    if (!this.ratings.has(templateId)) {
      this.ratings.set(templateId, new Map());
    }
    this.ratings.get(templateId)!.set(userId, { rating, review });
    
    // Update average rating
    const ratings = Array.from(this.ratings.get(templateId)!.values());
    const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
    await this.updateTemplate(templateId, {
      rating: Math.round(avg * 10) / 10,
      ratingCount: ratings.length,
    });
  }

  async getUserRating(templateId: string, userId: string): Promise<{ rating: number; review?: string } | null> {
    return this.ratings.get(templateId)?.get(userId) ?? null;
  }

  async incrementUsage(templateId: string): Promise<void> {
    const template = this.templates.get(templateId);
    if (template) {
      template.usageCount = (template.usageCount ?? 0) + 1;
      template.lastUsedAt = new Date().toISOString();
    }
  }

  async trackUsage(templateId: string, projectId?: string): Promise<void> {
    if (!this.usage.has(templateId)) {
      this.usage.set(templateId, []);
    }
    this.usage.get(templateId)!.push({
      projectId,
      usedAt: new Date().toISOString(),
    });
    await this.incrementUsage(templateId);
  }
}

// =============================================================================
// Template Service
// =============================================================================

export interface TemplateServiceConfig {
  maxVersions?: number;
}

export class TemplateService {
  private storage: TemplateStorage;
  private config: TemplateServiceConfig;

  constructor(config?: TemplateServiceConfig, storage?: TemplateStorage) {
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryTemplateStorage();
  }

  // ===========================================================================
  // Template CRUD
  // ===========================================================================

  async createTemplate(
    tenantId: string,
    ownerId: string,
    name: string,
    category: TemplateCategory,
    templateType: SharedTemplate['type'],
    content: TemplateContent,
    options?: {
      description?: string;
      tags?: string[];
      parameters?: TemplateParameter[];
      visibility?: SharedTemplate['visibility'];
      ownerType?: SharedTemplate['ownerType'];
    },
  ): Promise<CollaborationResult<SharedTemplate>> {
    const now = new Date().toISOString();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const initialVersion: TemplateVersion = {
      version: '1.0.0',
      changelog: 'Initial version',
      content,
      createdAt: now,
      createdBy: ownerId,
    };

    const template: SharedTemplate = {
      id: `tpl_${randomUUID()}`,
      tenantId,
      name,
      slug,
      description: options?.description ?? '',
      category,
      tags: options?.tags ?? [],
      version: '1.0.0',
      versions: [initialVersion],
      type: templateType,
      content,
      parameters: options?.parameters ?? [],
      usageCount: 0,
      visibility: options?.visibility ?? 'private',
      sharedWith: [],
      rating: 0,
      ratingCount: 0,
      ownerId,
      ownerType: options?.ownerType ?? 'user',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
    };

    await this.storage.createTemplate(template);
    return { success: true, data: template };
  }

  async getTemplate(templateId: string): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }
    return { success: true, data: template };
  }

  async listTemplates(
    tenantId: string,
    options?: {
      category?: TemplateCategory;
      visibility?: SharedTemplate['visibility'];
      ownerId?: string;
      tags?: string[];
      search?: string;
      sortBy?: 'name' | 'usage' | 'rating' | 'updated';
      limit?: number;
      offset?: number;
    },
  ): Promise<CollaborationResult<SharedTemplate[]>> {
    const templates = await this.storage.listTemplates({
      tenantId,
      ...options,
    });
    return { success: true, data: templates };
  }

  async updateTemplate(
    templateId: string,
    updates: Partial<Pick<SharedTemplate, 'name' | 'description' | 'tags' | 'visibility' | 'category'>>,
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    await this.storage.updateTemplate(templateId, updates);
    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  async deleteTemplate(templateId: string): Promise<CollaborationResult> {
    await this.storage.deleteTemplate(templateId);
    return { success: true, message: 'Template deleted' };
  }

  // ===========================================================================
  // Version Management
  // ===========================================================================

  async publishVersion(
    templateId: string,
    userId: string,
    newVersion: string,
    changelog: string,
    content: TemplateContent,
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    const now = new Date().toISOString();
    const version: TemplateVersion = {
      version: newVersion,
      changelog,
      content,
      createdAt: now,
      createdBy: userId,
    };

    // Add version to versions array
    const versions = [...template.versions, version];
    
    // Limit versions if configured
    const maxVersions = this.config.maxVersions ?? 50;
    const trimmedVersions = versions.slice(-maxVersions);

    await this.storage.updateTemplate(templateId, {
      version: newVersion,
      versions: trimmedVersions,
      content,
      status: 'published',
      publishedAt: template.publishedAt ?? now,
    });

    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  async listVersions(templateId: string): Promise<CollaborationResult<TemplateVersion[]>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }
    return { success: true, data: template.versions };
  }

  async deprecateVersion(
    templateId: string,
    version: string,
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    const versions = template.versions.map(v => 
      v.version === version ? { ...v, deprecated: true } : v
    );

    await this.storage.updateTemplate(templateId, { versions });
    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  // ===========================================================================
  // Sharing
  // ===========================================================================

  async shareTemplate(
    templateId: string,
    userId: string,
    shareTarget: { type: TemplateShare['type']; id: string },
    permission: TemplateShare['permission'],
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    const share: TemplateShare = {
      type: shareTarget.type,
      id: shareTarget.id,
      permission,
      sharedAt: new Date().toISOString(),
      sharedBy: userId,
    };

    const sharedWith = [...template.sharedWith, share];
    await this.storage.updateTemplate(templateId, { sharedWith });

    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  async revokeShare(
    templateId: string,
    targetId: string,
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    const sharedWith = template.sharedWith.filter(s => s.id !== targetId);
    await this.storage.updateTemplate(templateId, { sharedWith });

    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  // ===========================================================================
  // Ratings
  // ===========================================================================

  async rateTemplate(
    templateId: string,
    userId: string,
    rating: number,
    review?: string,
  ): Promise<CollaborationResult> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    if (rating < 1 || rating > 5) {
      return { success: false, errors: ['Rating must be between 1 and 5'] };
    }

    await this.storage.addRating(templateId, userId, rating, review);
    return { success: true, message: 'Rating submitted' };
  }

  async getUserRating(
    templateId: string,
    userId: string,
  ): Promise<CollaborationResult<{ rating: number; review?: string } | null>> {
    const rating = await this.storage.getUserRating(templateId, userId);
    return { success: true, data: rating };
  }

  // ===========================================================================
  // Usage Tracking
  // ===========================================================================

  async useTemplate(
    templateId: string,
    projectId?: string,
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    await this.storage.trackUsage(templateId, projectId);
    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  // ===========================================================================
  // Status Management
  // ===========================================================================

  async publishTemplate(templateId: string): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    await this.storage.updateTemplate(templateId, {
      status: 'published',
      publishedAt: new Date().toISOString(),
    });

    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  async deprecateTemplate(
    templateId: string,
    message?: string,
  ): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    await this.storage.updateTemplate(templateId, {
      status: 'deprecated',
      deprecatedAt: new Date().toISOString(),
      deprecationMessage: message,
    });

    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }

  async archiveTemplate(templateId: string): Promise<CollaborationResult<SharedTemplate>> {
    const template = await this.storage.getTemplate(templateId);
    if (!template) {
      return { success: false, errors: ['Template not found'] };
    }

    await this.storage.updateTemplate(templateId, {
      status: 'archived',
    });

    const updated = await this.storage.getTemplate(templateId);
    return { success: true, data: updated! };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTemplateService(
  config?: TemplateServiceConfig,
  storage?: TemplateStorage,
): TemplateService {
  return new TemplateService(config, storage);
}
