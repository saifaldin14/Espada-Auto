/**
 * Git Repository Manager
 *
 * Manages connections to Git repositories across multiple providers
 * (GitHub, GitLab, Bitbucket, CodeCommit, Azure DevOps).
 */

import { randomUUID } from 'node:crypto';
import type {
  GitRepository,
  GitProvider,
  GitCredentials,
  GitRepoSettings,
  WorkspaceMapping,
  GitOpsResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface RepositoryStorage {
  create(repo: GitRepository): Promise<void>;
  get(repoId: string): Promise<GitRepository | null>;
  getByProviderRepoId(provider: GitProvider, providerRepoId: string): Promise<GitRepository | null>;
  list(options: {
    tenantId?: string;
    workspaceId?: string;
    provider?: GitProvider;
    status?: GitRepository['status'];
  }): Promise<GitRepository[]>;
  update(repoId: string, updates: Partial<GitRepository>): Promise<void>;
  delete(repoId: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryRepositoryStorage implements RepositoryStorage {
  private repos = new Map<string, GitRepository>();

  async create(repo: GitRepository): Promise<void> {
    this.repos.set(repo.id, repo);
  }

  async get(repoId: string): Promise<GitRepository | null> {
    return this.repos.get(repoId) ?? null;
  }

  async getByProviderRepoId(provider: GitProvider, providerRepoId: string): Promise<GitRepository | null> {
    for (const repo of this.repos.values()) {
      if (repo.provider === provider && repo.providerRepoId === providerRepoId) {
        return repo;
      }
    }
    return null;
  }

  async list(options: {
    tenantId?: string;
    workspaceId?: string;
    provider?: GitProvider;
    status?: GitRepository['status'];
  }): Promise<GitRepository[]> {
    return Array.from(this.repos.values()).filter(r => {
      if (options.tenantId && r.tenantId !== options.tenantId) return false;
      if (options.workspaceId && r.workspaceId !== options.workspaceId) return false;
      if (options.provider && r.provider !== options.provider) return false;
      if (options.status && r.status !== options.status) return false;
      return true;
    });
  }

  async update(repoId: string, updates: Partial<GitRepository>): Promise<void> {
    const repo = this.repos.get(repoId);
    if (repo) {
      this.repos.set(repoId, { ...repo, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async delete(repoId: string): Promise<void> {
    this.repos.delete(repoId);
  }
}

// =============================================================================
// Git Provider Clients
// =============================================================================

export interface GitProviderClient {
  provider: GitProvider;
  
  // Repository operations
  getRepository(owner: string, name: string): Promise<RepositoryInfo>;
  listBranches(owner: string, name: string): Promise<BranchInfo[]>;
  getBranch(owner: string, name: string, branch: string): Promise<BranchInfo>;
  
  // File operations
  getFileContent(owner: string, name: string, path: string, ref?: string): Promise<FileContent>;
  listFiles(owner: string, name: string, path: string, ref?: string): Promise<FileInfo[]>;
  
  // Webhook operations
  createWebhook(owner: string, name: string, url: string, secret: string, events: string[]): Promise<string>;
  deleteWebhook(owner: string, name: string, webhookId: string): Promise<void>;
  
  // PR operations
  createPullRequest(owner: string, name: string, pr: CreatePRParams): Promise<PullRequestResponse>;
  updatePullRequest(owner: string, name: string, prNumber: number, updates: UpdatePRParams): Promise<void>;
  mergePullRequest(owner: string, name: string, prNumber: number, method?: 'merge' | 'squash' | 'rebase'): Promise<void>;
  
  // Comment operations
  createComment(owner: string, name: string, prNumber: number, body: string): Promise<CommentResponse>;
  updateComment(owner: string, name: string, commentId: string, body: string): Promise<void>;
  deleteComment(owner: string, name: string, commentId: string): Promise<void>;
  
  // Check/Status operations
  createCheckRun(owner: string, name: string, params: CreateCheckParams): Promise<string>;
  updateCheckRun(owner: string, name: string, checkId: string, params: UpdateCheckParams): Promise<void>;
  
  // Label operations
  addLabels(owner: string, name: string, prNumber: number, labels: string[]): Promise<void>;
  removeLabels(owner: string, name: string, prNumber: number, labels: string[]): Promise<void>;
}

export interface RepositoryInfo {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  url: string;
  cloneUrl: string;
  private: boolean;
}

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  sha: string;
  encoding: 'base64' | 'utf-8';
}

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sha?: string;
  size?: number;
}

export interface CreatePRParams {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface UpdatePRParams {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

export interface PullRequestResponse {
  id: string;
  number: number;
  url: string;
}

export interface CommentResponse {
  id: string;
  url: string;
}

export interface CreateCheckParams {
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
  title?: string;
  summary?: string;
  text?: string;
  detailsUrl?: string;
}

export interface UpdateCheckParams {
  status?: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
  title?: string;
  summary?: string;
  text?: string;
  completedAt?: string;
}

// =============================================================================
// Repository Manager
// =============================================================================

export interface RepositoryManagerConfig {
  webhookBaseUrl: string;
  encryptionKey?: string;
}

export class RepositoryManager {
  private storage: RepositoryStorage;
  private config: RepositoryManagerConfig;
  private clients = new Map<GitProvider, GitProviderClient>();

  constructor(config: RepositoryManagerConfig, storage?: RepositoryStorage) {
    this.config = config;
    this.storage = storage ?? new InMemoryRepositoryStorage();
  }

  // ===========================================================================
  // Provider Client Management
  // ===========================================================================

  registerClient(client: GitProviderClient): void {
    this.clients.set(client.provider, client);
  }

  getClient(provider: GitProvider): GitProviderClient | undefined {
    return this.clients.get(provider);
  }

  // ===========================================================================
  // Repository Connection
  // ===========================================================================

  async connectRepository(
    tenantId: string,
    workspaceId: string,
    userId: string,
    provider: GitProvider,
    owner: string,
    name: string,
    credentials: GitCredentials,
    options?: {
      iacPath?: string;
      iacFormat?: GitRepository['iacFormat'];
      settings?: Partial<GitRepoSettings>;
    },
  ): Promise<GitOpsResult<GitRepository>> {
    const client = this.clients.get(provider);
    if (!client) {
      return { success: false, errors: [`Provider ${provider} not configured`] };
    }

    try {
      // Fetch repository info from provider
      const repoInfo = await client.getRepository(owner, name);
      
      // Check if already connected
      const existing = await this.storage.getByProviderRepoId(provider, repoInfo.id);
      if (existing) {
        return { success: false, errors: ['Repository already connected'] };
      }

      const now = new Date().toISOString();
      const webhookSecret = this.generateWebhookSecret();
      
      // Create webhook
      const webhookUrl = `${this.config.webhookBaseUrl}/webhooks/${provider}`;
      let webhookId: string | undefined;
      
      try {
        webhookId = await client.createWebhook(
          owner,
          name,
          webhookUrl,
          webhookSecret,
          this.getWebhookEvents(provider),
        );
      } catch (error) {
        // Webhook creation failed, but we can still connect
        console.warn(`Failed to create webhook: ${error}`);
      }

      const defaultSettings: GitRepoSettings = {
        autoPlanOnPR: true,
        autoPlanBranches: [repoInfo.defaultBranch, 'main', 'master'],
        autoApplyEnabled: false,
        autoApplyBranches: [],
        requireApprovalForAutoApply: true,
        commentOnPlan: true,
        commentOnApply: true,
        collapseLargePlans: true,
        planCommentThreshold: 50,
        driftDetectionEnabled: false,
        driftDetectionSchedule: '0 0 * * *', // Daily at midnight
        driftAutoCreatePR: false,
        protectedEnvironments: {},
        workspaceMappings: [],
        planLabelPrefix: 'plan:',
        applyLabelPrefix: 'apply:',
        ...options?.settings,
      };

      const repo: GitRepository = {
        id: `repo_${randomUUID()}`,
        tenantId,
        workspaceId,
        provider,
        providerRepoId: repoInfo.id,
        owner,
        name,
        fullName: repoInfo.fullName,
        defaultBranch: repoInfo.defaultBranch,
        url: repoInfo.url,
        cloneUrl: repoInfo.cloneUrl,
        iacPath: options?.iacPath ?? 'terraform/',
        iacFormat: options?.iacFormat ?? 'terraform',
        credentials: this.encryptCredentials(credentials),
        webhookId,
        webhookSecret,
        webhookUrl,
        settings: defaultSettings,
        status: 'active',
        lastSyncAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      };

      await this.storage.create(repo);
      return { success: true, data: this.sanitizeRepository(repo) };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to connect repository: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async disconnectRepository(repoId: string): Promise<GitOpsResult> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    // Try to delete webhook
    if (repo.webhookId) {
      const client = this.clients.get(repo.provider);
      if (client) {
        try {
          await client.deleteWebhook(repo.owner, repo.name, repo.webhookId);
        } catch {
          // Ignore webhook deletion errors
        }
      }
    }

    await this.storage.delete(repoId);
    return { success: true, message: 'Repository disconnected' };
  }

  // ===========================================================================
  // Repository Operations
  // ===========================================================================

  async getRepository(repoId: string): Promise<GitOpsResult<GitRepository>> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }
    return { success: true, data: this.sanitizeRepository(repo) };
  }

  async listRepositories(options: {
    tenantId?: string;
    workspaceId?: string;
    provider?: GitProvider;
    status?: GitRepository['status'];
  }): Promise<GitOpsResult<GitRepository[]>> {
    const repos = await this.storage.list(options);
    return { success: true, data: repos.map(r => this.sanitizeRepository(r)) };
  }

  async updateSettings(
    repoId: string,
    settings: Partial<GitRepoSettings>,
  ): Promise<GitOpsResult<GitRepository>> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    const updatedSettings = { ...repo.settings, ...settings };
    await this.storage.update(repoId, { settings: updatedSettings });
    
    const updated = await this.storage.get(repoId);
    return { success: true, data: this.sanitizeRepository(updated!) };
  }

  async updateCredentials(
    repoId: string,
    credentials: GitCredentials,
  ): Promise<GitOpsResult> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    await this.storage.update(repoId, {
      credentials: this.encryptCredentials(credentials),
    });
    
    return { success: true, message: 'Credentials updated' };
  }

  // ===========================================================================
  // Workspace Mappings
  // ===========================================================================

  async addWorkspaceMapping(
    repoId: string,
    mapping: WorkspaceMapping,
  ): Promise<GitOpsResult<GitRepository>> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    // Check for duplicate path
    if (repo.settings.workspaceMappings.some(m => m.path === mapping.path)) {
      return { success: false, errors: ['Mapping for this path already exists'] };
    }

    const mappings = [...repo.settings.workspaceMappings, mapping];
    await this.storage.update(repoId, {
      settings: { ...repo.settings, workspaceMappings: mappings },
    });

    const updated = await this.storage.get(repoId);
    return { success: true, data: this.sanitizeRepository(updated!) };
  }

  async removeWorkspaceMapping(
    repoId: string,
    path: string,
  ): Promise<GitOpsResult<GitRepository>> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    const mappings = repo.settings.workspaceMappings.filter(m => m.path !== path);
    await this.storage.update(repoId, {
      settings: { ...repo.settings, workspaceMappings: mappings },
    });

    const updated = await this.storage.get(repoId);
    return { success: true, data: this.sanitizeRepository(updated!) };
  }

  // ===========================================================================
  // Sync Operations
  // ===========================================================================

  async syncRepository(repoId: string): Promise<GitOpsResult> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    const client = this.clients.get(repo.provider);
    if (!client) {
      return { success: false, errors: ['Provider client not configured'] };
    }

    try {
      // Verify repository access
      const repoInfo = await client.getRepository(repo.owner, repo.name);
      
      await this.storage.update(repoId, {
        defaultBranch: repoInfo.defaultBranch,
        status: 'active',
        lastSyncAt: new Date().toISOString(),
        lastError: undefined,
      });

      return { success: true, message: 'Repository synced' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.storage.update(repoId, {
        status: 'error',
        lastError: errorMsg,
      });
      return { success: false, errors: [`Sync failed: ${errorMsg}`] };
    }
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  async getFileContent(
    repoId: string,
    path: string,
    ref?: string,
  ): Promise<GitOpsResult<string>> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    const client = this.clients.get(repo.provider);
    if (!client) {
      return { success: false, errors: ['Provider client not configured'] };
    }

    try {
      const file = await client.getFileContent(repo.owner, repo.name, path, ref);
      const content = file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64').toString('utf-8')
        : file.content;
      return { success: true, data: content };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to get file: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async listIaCFiles(repoId: string, ref?: string): Promise<GitOpsResult<FileInfo[]>> {
    const repo = await this.storage.get(repoId);
    if (!repo) {
      return { success: false, errors: ['Repository not found'] };
    }

    const client = this.clients.get(repo.provider);
    if (!client) {
      return { success: false, errors: ['Provider client not configured'] };
    }

    try {
      const files = await client.listFiles(repo.owner, repo.name, repo.iacPath, ref);
      return { success: true, data: files };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private generateWebhookSecret(): string {
    return randomUUID().replace(/-/g, '');
  }

  private getWebhookEvents(provider: GitProvider): string[] {
    switch (provider) {
      case 'github':
        return ['push', 'pull_request', 'issue_comment', 'check_run'];
      case 'gitlab':
        return ['push_events', 'merge_request_events', 'note_events'];
      case 'bitbucket':
        return ['repo:push', 'pullrequest:created', 'pullrequest:updated'];
      case 'azure_devops':
        return ['git.push', 'git.pullrequest.created', 'git.pullrequest.updated'];
      default:
        return ['push', 'pull_request'];
    }
  }

  private encryptCredentials(credentials: GitCredentials): GitCredentials {
    // In production, encrypt sensitive fields using config.encryptionKey
    // For now, return as-is (should be encrypted in storage layer)
    return credentials;
  }

  private sanitizeRepository(repo: GitRepository): GitRepository {
    // Remove sensitive data from credentials
    return {
      ...repo,
      credentials: {
        type: repo.credentials.type,
        // Don't expose actual tokens/keys
      },
      webhookSecret: undefined,
    } as GitRepository;
  }

  // ===========================================================================
  // Internal Credential Access (for use by other services)
  // ===========================================================================

  async getDecryptedCredentials(repoId: string): Promise<GitCredentials | null> {
    const repo = await this.storage.get(repoId);
    if (!repo) return null;
    // In production, decrypt here
    return repo.credentials;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createRepositoryManager(
  config: RepositoryManagerConfig,
  storage?: RepositoryStorage,
): RepositoryManager {
  return new RepositoryManager(config, storage);
}
