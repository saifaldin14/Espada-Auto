/**
 * Webhook Handler Service
 *
 * Processes incoming webhooks from Git providers and triggers
 * appropriate actions (plans, applies, notifications).
 */

import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  GitProvider,
  WebhookEvent,
  WebhookEventType,
  WebhookPayload,
  WebhookAction,
  PullRequestInfo,
  GitOpsResult,
} from './types.js';
import type { RepositoryManager } from './repository.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface WebhookStorage {
  create(event: WebhookEvent): Promise<void>;
  get(eventId: string): Promise<WebhookEvent | null>;
  getByDeliveryId(provider: GitProvider, deliveryId: string): Promise<WebhookEvent | null>;
  list(options: {
    repositoryId?: string;
    eventType?: WebhookEventType;
    status?: WebhookEvent['status'];
    limit?: number;
    offset?: number;
  }): Promise<WebhookEvent[]>;
  update(eventId: string, updates: Partial<WebhookEvent>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryWebhookStorage implements WebhookStorage {
  private events = new Map<string, WebhookEvent>();

  async create(event: WebhookEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async get(eventId: string): Promise<WebhookEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async getByDeliveryId(provider: GitProvider, deliveryId: string): Promise<WebhookEvent | null> {
    for (const event of this.events.values()) {
      if (event.provider === provider && event.deliveryId === deliveryId) {
        return event;
      }
    }
    return null;
  }

  async list(options: {
    repositoryId?: string;
    eventType?: WebhookEventType;
    status?: WebhookEvent['status'];
    limit?: number;
    offset?: number;
  }): Promise<WebhookEvent[]> {
    let results = Array.from(this.events.values()).filter(e => {
      if (options.repositoryId && e.repositoryId !== options.repositoryId) return false;
      if (options.eventType && e.eventType !== options.eventType) return false;
      if (options.status && e.status !== options.status) return false;
      return true;
    });

    results.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async update(eventId: string, updates: Partial<WebhookEvent>): Promise<void> {
    const event = this.events.get(eventId);
    if (event) {
      this.events.set(eventId, { ...event, ...updates });
    }
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

export interface WebhookEventHandler {
  eventTypes: WebhookEventType[];
  handle(event: WebhookEvent, context: WebhookContext): Promise<WebhookAction[]>;
}

export interface WebhookContext {
  repositoryManager: RepositoryManager;
  // Add other services as needed
}

// =============================================================================
// Webhook Handler Service
// =============================================================================

export interface WebhookHandlerConfig {
  maxRetries?: number;
  retryDelayMs?: number;
}

export class WebhookHandler {
  private storage: WebhookStorage;
  private config: WebhookHandlerConfig;
  private handlers: WebhookEventHandler[] = [];
  private repositoryManager: RepositoryManager;

  constructor(
    repositoryManager: RepositoryManager,
    config?: WebhookHandlerConfig,
    storage?: WebhookStorage,
  ) {
    this.repositoryManager = repositoryManager;
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryWebhookStorage();
  }

  // ===========================================================================
  // Handler Registration
  // ===========================================================================

  registerHandler(handler: WebhookEventHandler): void {
    this.handlers.push(handler);
  }

  // ===========================================================================
  // Webhook Processing
  // ===========================================================================

  async handleWebhook(
    provider: GitProvider,
    headers: Record<string, string>,
    body: string,
    signature?: string,
  ): Promise<GitOpsResult<WebhookEvent>> {
    const now = new Date().toISOString();
    
    // Parse payload
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return { success: false, errors: ['Invalid JSON payload'] };
    }

    // Extract delivery ID and event type
    const deliveryId = this.extractDeliveryId(provider, headers);
    const eventType = this.extractEventType(provider, headers, payload);

    if (!deliveryId || !eventType) {
      return { success: false, errors: ['Missing delivery ID or event type'] };
    }

    // Check for duplicate delivery
    const existingEvent = await this.storage.getByDeliveryId(provider, deliveryId);
    if (existingEvent) {
      return { success: true, data: existingEvent, message: 'Duplicate delivery ignored' };
    }

    // Get repository info from payload
    const repoInfo = this.extractRepositoryInfo(provider, payload);
    if (!repoInfo) {
      return { success: false, errors: ['Could not extract repository info'] };
    }

    // Find connected repository
    const repoResult = await this.repositoryManager.listRepositories({
      provider,
    });
    
    const repo = repoResult.data?.find(
      r => r.owner === repoInfo.owner && r.name === repoInfo.name,
    );

    if (!repo) {
      // Repository not connected, ignore webhook
      return { success: true, message: 'Repository not connected, ignoring' };
    }

    // Verify signature if webhook secret is configured
    if (repo.webhookSecret && signature) {
      const isValid = this.verifySignature(provider, body, signature, repo.webhookSecret);
      if (!isValid) {
        return { success: false, errors: ['Invalid webhook signature'] };
      }
    }

    // Create webhook event record
    const event: WebhookEvent = {
      id: `wh_${randomUUID()}`,
      tenantId: repo.tenantId,
      repositoryId: repo.id,
      provider,
      eventType,
      deliveryId,
      payload,
      headers,
      signature,
      status: 'pending',
      actions: [],
      receivedAt: now,
    };

    await this.storage.create(event);

    // Process event asynchronously
    this.processEvent(event).catch(console.error);

    return { success: true, data: event };
  }

  private async processEvent(event: WebhookEvent): Promise<void> {
    await this.storage.update(event.id, { status: 'processing' });

    const context: WebhookContext = {
      repositoryManager: this.repositoryManager,
    };

    const actions: WebhookAction[] = [];

    try {
      // Find and run matching handlers
      for (const handler of this.handlers) {
        if (handler.eventTypes.includes(event.eventType)) {
          const handlerActions = await handler.handle(event, context);
          actions.push(...handlerActions);
        }
      }

      await this.storage.update(event.id, {
        status: 'completed',
        processedAt: new Date().toISOString(),
        actions,
      });
    } catch (error) {
      await this.storage.update(event.id, {
        status: 'failed',
        processedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        actions,
      });
    }
  }

  // ===========================================================================
  // Provider-Specific Extraction
  // ===========================================================================

  private extractDeliveryId(provider: GitProvider, headers: Record<string, string>): string | null {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === this.getDeliveryIdHeader(provider));
    return headerKey ? headers[headerKey] : null;
  }

  private getDeliveryIdHeader(provider: GitProvider): string {
    switch (provider) {
      case 'github':
        return 'x-github-delivery';
      case 'gitlab':
        return 'x-gitlab-event-uuid';
      case 'bitbucket':
        return 'x-request-uuid';
      case 'azure_devops':
        return 'x-vss-subscriptionid';
      default:
        return 'x-delivery-id';
    }
  }

  private extractEventType(
    provider: GitProvider,
    headers: Record<string, string>,
    payload: WebhookPayload,
  ): WebhookEventType | null {
    switch (provider) {
      case 'github':
        return this.parseGitHubEventType(headers);
      case 'gitlab':
        return this.parseGitLabEventType(headers, payload);
      case 'bitbucket':
        return this.parseBitbucketEventType(headers);
      case 'azure_devops':
        return this.parseAzureDevOpsEventType(payload);
      default:
        return null;
    }
  }

  private parseGitHubEventType(headers: Record<string, string>): WebhookEventType | null {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === 'x-github-event');
    const eventHeader = headerKey ? headers[headerKey] : null;
    
    switch (eventHeader) {
      case 'push':
        return 'push';
      case 'pull_request':
        return 'pull_request';
      case 'pull_request_review':
        return 'pull_request_review';
      case 'issue_comment':
        return 'issue_comment';
      case 'check_run':
        return 'check_run';
      case 'check_suite':
        return 'check_suite';
      case 'deployment':
        return 'deployment';
      case 'deployment_status':
        return 'deployment_status';
      case 'ping':
        return 'ping';
      default:
        return null;
    }
  }

  private parseGitLabEventType(headers: Record<string, string>, payload: WebhookPayload): WebhookEventType | null {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === 'x-gitlab-event');
    const eventHeader = headerKey ? headers[headerKey] : null;
    
    if (eventHeader === 'Push Hook') return 'push';
    if (eventHeader === 'Merge Request Hook') return 'pull_request';
    if (eventHeader === 'Note Hook' && payload.pullRequest) return 'issue_comment';
    if (eventHeader === 'Pipeline Hook') return 'check_run';
    return null;
  }

  private parseBitbucketEventType(headers: Record<string, string>): WebhookEventType | null {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === 'x-event-key');
    const eventHeader = headerKey ? headers[headerKey] : null;
    
    if (eventHeader?.startsWith('repo:push')) return 'push';
    if (eventHeader?.startsWith('pullrequest:')) return 'pull_request';
    if (eventHeader?.startsWith('pullrequest:comment')) return 'issue_comment';
    return null;
  }

  private parseAzureDevOpsEventType(payload: WebhookPayload): WebhookEventType | null {
    const eventType = (payload as Record<string, unknown>).eventType as string | undefined;
    if (eventType === 'git.push') return 'push';
    if (eventType?.startsWith('git.pullrequest')) return 'pull_request';
    return null;
  }

  private extractRepositoryInfo(
    provider: GitProvider,
    payload: WebhookPayload,
  ): { owner: string; name: string } | null {
    if (payload.repository) {
      const fullName = payload.repository.fullName;
      const parts = fullName.split('/');
      if (parts.length >= 2) {
        return { owner: parts[0], name: parts[1] };
      }
    }
    return null;
  }

  // ===========================================================================
  // Signature Verification
  // ===========================================================================

  private verifySignature(
    provider: GitProvider,
    body: string,
    signature: string,
    secret: string,
  ): boolean {
    switch (provider) {
      case 'github':
        return this.verifyGitHubSignature(body, signature, secret);
      case 'gitlab':
        return this.verifyGitLabSignature(signature, secret);
      case 'bitbucket':
        // Bitbucket uses IP allowlisting rather than signatures
        return true;
      default:
        return true;
    }
  }

  private verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
    const expectedSignature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    
    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch {
      return false;
    }
  }

  private verifyGitLabSignature(tokenHeader: string, secret: string): boolean {
    return tokenHeader === secret;
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  async getEvent(eventId: string): Promise<GitOpsResult<WebhookEvent>> {
    const event = await this.storage.get(eventId);
    if (!event) {
      return { success: false, errors: ['Event not found'] };
    }
    return { success: true, data: event };
  }

  async listEvents(options: {
    repositoryId?: string;
    eventType?: WebhookEventType;
    status?: WebhookEvent['status'];
    limit?: number;
    offset?: number;
  }): Promise<GitOpsResult<WebhookEvent[]>> {
    const events = await this.storage.list(options);
    return { success: true, data: events };
  }

  // ===========================================================================
  // Payload Helpers
  // ===========================================================================

  extractPullRequestInfo(payload: WebhookPayload): PullRequestInfo | null {
    return payload.pullRequest ?? null;
  }

  hasIaCChanges(payload: WebhookPayload, iacPath: string): boolean {
    const normalizedPath = iacPath.endsWith('/') ? iacPath : `${iacPath}/`;
    
    // Check commits for push events
    if (payload.commits) {
      for (const commit of payload.commits) {
        const allFiles = [...commit.added, ...commit.modified, ...commit.removed];
        if (allFiles.some(f => f.startsWith(normalizedPath) || f.startsWith(iacPath))) {
          return true;
        }
      }
    }
    
    return false;
  }

  isPlanCommand(payload: WebhookPayload): boolean {
    const comment = payload.comment?.body?.toLowerCase() ?? '';
    return (
      comment.includes('/plan') ||
      comment.includes('terraform plan') ||
      comment.includes('idio plan')
    );
  }

  isApplyCommand(payload: WebhookPayload): boolean {
    const comment = payload.comment?.body?.toLowerCase() ?? '';
    return (
      comment.includes('/apply') ||
      comment.includes('terraform apply') ||
      comment.includes('idio apply')
    );
  }
}

// =============================================================================
// Built-in Event Handlers
// =============================================================================

export class PullRequestHandler implements WebhookEventHandler {
  eventTypes: WebhookEventType[] = ['pull_request'];

  async handle(event: WebhookEvent, context: WebhookContext): Promise<WebhookAction[]> {
    const actions: WebhookAction[] = [];
    const pr = event.payload.pullRequest;
    
    if (!pr) return actions;

    const action = event.payload.action;
    
    // Get repository settings
    const repoResult = await context.repositoryManager.getRepository(event.repositoryId);
    if (!repoResult.success || !repoResult.data) return actions;
    
    const repo = repoResult.data;
    const settings = repo.settings;

    // Trigger plan on PR open/sync if auto-plan enabled
    if (
      settings.autoPlanOnPR &&
      (action === 'opened' || action === 'synchronize' || action === 'reopened')
    ) {
      // Check if base branch matches configured branches
      const baseBranch = pr.baseRef;
      const shouldPlan = settings.autoPlanBranches.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
          return regex.test(baseBranch);
        }
        return pattern === baseBranch;
      });

      if (shouldPlan) {
        actions.push({
          type: 'plan',
          status: 'pending',
          details: {
            prNumber: pr.number,
            headSha: pr.headSha,
            baseBranch,
            headBranch: pr.headRef,
          },
        });
      }
    }

    return actions;
  }
}

export class CommentCommandHandler implements WebhookEventHandler {
  eventTypes: WebhookEventType[] = ['issue_comment'];

  async handle(event: WebhookEvent, _context: WebhookContext): Promise<WebhookAction[]> {
    const actions: WebhookAction[] = [];
    const comment = event.payload.comment;
    
    if (!comment) return actions;

    const body = comment.body.toLowerCase();

    // Plan command
    if (body.includes('/plan') || body.includes('idio plan')) {
      actions.push({
        type: 'plan',
        status: 'pending',
        details: {
          triggeredBy: comment.user.login,
          commentId: comment.id,
        },
      });
    }

    // Apply command
    if (body.includes('/apply') || body.includes('idio apply')) {
      actions.push({
        type: 'apply',
        status: 'pending',
        details: {
          triggeredBy: comment.user.login,
          commentId: comment.id,
        },
      });
    }

    return actions;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createWebhookHandler(
  repositoryManager: RepositoryManager,
  config?: WebhookHandlerConfig,
  storage?: WebhookStorage,
): WebhookHandler {
  const handler = new WebhookHandler(repositoryManager, config, storage);
  
  // Register built-in handlers
  handler.registerHandler(new PullRequestHandler());
  handler.registerHandler(new CommentCommandHandler());
  
  return handler;
}
