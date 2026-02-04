/**
 * GitOps Sync Service
 *
 * Provides ArgoCD/Flux compatibility layer for synchronization
 * of infrastructure state with Git repositories.
 */

import type {
  GitOpsApplication,
  SyncPolicy,
  GitOpsResult,
  GitRepository,
} from './types.js';
import type { RepositoryManager } from './repository.js';
import type { PlanService } from './plan.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface SyncStorage {
  createApplication(app: GitOpsApplication): Promise<void>;
  getApplication(appId: string): Promise<GitOpsApplication | null>;
  getByRepository(repositoryId: string): Promise<GitOpsApplication[]>;
  listApplications(tenantId?: string): Promise<GitOpsApplication[]>;
  updateApplication(appId: string, updates: Partial<GitOpsApplication>): Promise<void>;
  deleteApplication(appId: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemorySyncStorage implements SyncStorage {
  private applications = new Map<string, GitOpsApplication>();

  async createApplication(app: GitOpsApplication): Promise<void> {
    this.applications.set(app.id, app);
  }

  async getApplication(appId: string): Promise<GitOpsApplication | null> {
    return this.applications.get(appId) ?? null;
  }

  async getByRepository(repositoryId: string): Promise<GitOpsApplication[]> {
    return Array.from(this.applications.values()).filter(
      a => a.repositoryId === repositoryId,
    );
  }

  async listApplications(tenantId?: string): Promise<GitOpsApplication[]> {
    const apps = Array.from(this.applications.values());
    if (tenantId) {
      return apps.filter(a => a.tenantId === tenantId);
    }
    return apps;
  }

  async updateApplication(appId: string, updates: Partial<GitOpsApplication>): Promise<void> {
    const app = this.applications.get(appId);
    if (app) {
      this.applications.set(appId, { ...app, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteApplication(appId: string): Promise<void> {
    this.applications.delete(appId);
  }
}

// =============================================================================
// Sync Service
// =============================================================================

export interface SyncServiceConfig {
  defaultSyncPolicy?: Partial<SyncPolicy>;
  healthCheckInterval?: number;
  maxConcurrentSyncs?: number;
  syncTimeout?: number;
  reconciliationInterval?: number;
}

export class SyncService {
  private storage: SyncStorage;
  private config: SyncServiceConfig;
  private repositoryManager: RepositoryManager;
  private planService: PlanService;
  private syncTimers = new Map<string, NodeJS.Timer>();

  constructor(
    repositoryManager: RepositoryManager,
    planService: PlanService,
    config?: SyncServiceConfig,
    storage?: SyncStorage,
  ) {
    this.repositoryManager = repositoryManager;
    this.planService = planService;
    this.config = {
      healthCheckInterval: 60000, // 1 minute
      maxConcurrentSyncs: 5,
      syncTimeout: 600000, // 10 minutes
      reconciliationInterval: 300000, // 5 minutes
      ...config,
    };
    this.storage = storage ?? new InMemorySyncStorage();
  }

  // ===========================================================================
  // Application Management
  // ===========================================================================

  async createApplication(
    params: {
      name: string;
      repositoryId: string;
      tenantId: string;
      path: string;
      targetEnvironment: string;
      syncPolicy?: SyncPolicy;
      metadata?: Record<string, string>;
    },
  ): Promise<GitOpsResult<GitOpsApplication>> {
    // Validate repository exists
    const repoResult = await this.repositoryManager.getRepository(params.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }

    const appId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    const syncPolicy: SyncPolicy = {
      automated: false,
      prune: false,
      selfHeal: false,
      allowEmpty: false,
      retryLimit: 3,
      retryBackoff: 60,
      ...this.config.defaultSyncPolicy,
      ...params.syncPolicy,
    };

    const application: GitOpsApplication = {
      id: appId,
      name: params.name,
      repositoryId: params.repositoryId,
      tenantId: params.tenantId,
      path: params.path,
      targetEnvironment: params.targetEnvironment,
      targetBranch: repoResult.data.settings.defaultBranch,
      syncPolicy,
      status: {
        health: 'unknown',
        sync: 'unknown',
        operationState: 'idle',
      },
      metadata: params.metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.storage.createApplication(application);

    // Start automated sync if enabled
    if (syncPolicy.automated) {
      this.startAutomatedSync(appId);
    }

    return { success: true, data: application };
  }

  async getApplication(appId: string): Promise<GitOpsResult<GitOpsApplication>> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }
    return { success: true, data: app };
  }

  async listApplications(tenantId?: string): Promise<GitOpsResult<GitOpsApplication[]>> {
    const apps = await this.storage.listApplications(tenantId);
    return { success: true, data: apps };
  }

  async updateApplication(
    appId: string,
    updates: {
      name?: string;
      path?: string;
      targetEnvironment?: string;
      targetBranch?: string;
      syncPolicy?: Partial<SyncPolicy>;
      metadata?: Record<string, string>;
    },
  ): Promise<GitOpsResult<GitOpsApplication>> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    const syncPolicy = updates.syncPolicy
      ? { ...app.syncPolicy, ...updates.syncPolicy }
      : app.syncPolicy;

    await this.storage.updateApplication(appId, {
      ...updates,
      syncPolicy,
    });

    // Update automated sync
    if (updates.syncPolicy !== undefined) {
      if (syncPolicy.automated && !this.syncTimers.has(appId)) {
        this.startAutomatedSync(appId);
      } else if (!syncPolicy.automated && this.syncTimers.has(appId)) {
        this.stopAutomatedSync(appId);
      }
    }

    const updated = await this.storage.getApplication(appId);
    return { success: true, data: updated! };
  }

  async deleteApplication(appId: string): Promise<GitOpsResult> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    // Stop automated sync
    this.stopAutomatedSync(appId);

    await this.storage.deleteApplication(appId);
    return { success: true };
  }

  // ===========================================================================
  // Sync Operations
  // ===========================================================================

  async sync(
    appId: string,
    options?: {
      revision?: string;
      prune?: boolean;
      dryRun?: boolean;
      force?: boolean;
    },
  ): Promise<GitOpsResult<SyncResult>> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    // Update status to syncing
    await this.storage.updateApplication(appId, {
      status: {
        ...app.status,
        sync: 'syncing',
        operationState: 'running',
      },
    });

    try {
      // Get repository
      const repoResult = await this.repositoryManager.getRepository(app.repositoryId);
      if (!repoResult.success || !repoResult.data) {
        throw new Error('Repository not found');
      }
      const repo = repoResult.data;

      // Create a plan for the sync
      const revision = options?.revision ?? app.targetBranch;
      const planResult = await this.planService.createPlan({
        repositoryId: app.repositoryId,
        branch: revision,
        commitSha: await this.resolveRevision(repo, revision),
        iacPath: app.path,
        environment: app.targetEnvironment,
        tenantId: app.tenantId,
        autoApprove: app.syncPolicy.automated && !options?.dryRun,
        triggeredBy: 'sync',
      });

      if (!planResult.success || !planResult.data) {
        throw new Error(planResult.errors?.[0] ?? 'Failed to create plan');
      }

      const plan = planResult.data;

      // Execute the plan
      const execResult = await this.planService.executePlan(plan.id);
      if (!execResult.success) {
        throw new Error(execResult.errors?.[0] ?? 'Failed to execute plan');
      }

      // Wait for plan to complete
      const finalPlan = await this.waitForPlanCompletion(plan.id);
      
      // Determine sync status
      const syncStatus = this.determineSyncStatus(finalPlan.status);
      const healthStatus = this.determineHealthStatus(finalPlan);

      // Update application status
      await this.storage.updateApplication(appId, {
        status: {
          health: healthStatus,
          sync: syncStatus,
          operationState: 'completed',
          lastSyncedAt: new Date().toISOString(),
          lastSyncedRevision: finalPlan.commitSha,
        },
        lastSuccessfulSync: syncStatus === 'synced' 
          ? new Date().toISOString() 
          : app.lastSuccessfulSync,
      });

      return {
        success: true,
        data: {
          appId,
          planId: plan.id,
          status: syncStatus,
          health: healthStatus,
          revision: finalPlan.commitSha,
          message: this.getSyncResultMessage(finalPlan.status),
        },
      };
    } catch (error) {
      // Update status to failed
      await this.storage.updateApplication(appId, {
        status: {
          ...app.status,
          sync: 'failed',
          operationState: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      return {
        success: false,
        errors: [`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async hardRefresh(appId: string): Promise<GitOpsResult> {
    // Force a full reconciliation by clearing cached state
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    await this.storage.updateApplication(appId, {
      status: {
        health: 'unknown',
        sync: 'unknown',
        operationState: 'idle',
      },
    });

    // Trigger a new sync
    return this.sync(appId, { force: true });
  }

  async terminate(appId: string): Promise<GitOpsResult> {
    // Stop any running operations
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    // Cancel any pending plans
    // Note: This would need to integrate with plan service to cancel running plans

    await this.storage.updateApplication(appId, {
      status: {
        ...app.status,
        operationState: 'terminated',
      },
    });

    return { success: true };
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  async checkHealth(appId: string): Promise<GitOpsResult<HealthCheckResult>> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    // Get repository
    const repoResult = await this.repositoryManager.getRepository(app.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return {
        success: true,
        data: {
          appId,
          health: 'degraded',
          issues: ['Repository not found or inaccessible'],
        },
      };
    }

    const issues: string[] = [];

    // Check if we have a recent sync
    if (!app.status.lastSyncedAt) {
      issues.push('Application has never been synced');
    } else {
      const lastSync = new Date(app.status.lastSyncedAt);
      const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSync > 24) {
        issues.push(`Last sync was ${Math.floor(hoursSinceSync)} hours ago`);
      }
    }

    // Check sync status
    if (app.status.sync === 'out_of_sync') {
      issues.push('Application is out of sync with repository');
    } else if (app.status.sync === 'failed') {
      issues.push('Last sync failed');
    }

    // Check for errors
    if (app.status.error) {
      issues.push(`Error: ${app.status.error}`);
    }

    // Determine overall health
    let health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    if (issues.length === 0 && app.status.sync === 'synced') {
      health = 'healthy';
    } else if (app.status.sync === 'failed' || issues.some(i => i.includes('Error'))) {
      health = 'unhealthy';
    } else if (issues.length > 0) {
      health = 'degraded';
    } else {
      health = 'unknown';
    }

    // Update application health
    await this.storage.updateApplication(appId, {
      status: {
        ...app.status,
        health,
      },
    });

    return {
      success: true,
      data: {
        appId,
        health,
        issues,
        lastCheckedAt: new Date().toISOString(),
      },
    };
  }

  // ===========================================================================
  // ArgoCD Compatibility
  // ===========================================================================

  async getArgoCompatibleStatus(appId: string): Promise<GitOpsResult<ArgoAppStatus>> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    // Convert to ArgoCD-compatible status format
    const argoStatus: ArgoAppStatus = {
      sync: {
        status: this.mapSyncStatusToArgo(app.status.sync),
        revision: app.status.lastSyncedRevision ?? '',
        comparedTo: {
          source: {
            repoURL: '', // Would be populated from repository
            path: app.path,
            targetRevision: app.targetBranch,
          },
          destination: {
            server: 'https://kubernetes.default.svc', // Placeholder
            namespace: app.targetEnvironment,
          },
        },
      },
      health: {
        status: this.mapHealthStatusToArgo(app.status.health),
        message: app.status.error ?? '',
      },
      operationState: app.status.operationState 
        ? {
            operation: {
              sync: {
                revision: app.status.lastSyncedRevision ?? '',
                prune: app.syncPolicy.prune,
              },
            },
            phase: this.mapOperationPhaseToArgo(app.status.operationState),
            message: '',
            startedAt: app.status.lastSyncedAt ?? '',
            finishedAt: app.status.lastSyncedAt ?? '',
          }
        : undefined,
      conditions: [],
      resources: [],
    };

    return { success: true, data: argoStatus };
  }

  // ===========================================================================
  // Flux Compatibility
  // ===========================================================================

  async getFluxCompatibleStatus(appId: string): Promise<GitOpsResult<FluxKustomizationStatus>> {
    const app = await this.storage.getApplication(appId);
    if (!app) {
      return { success: false, errors: ['Application not found'] };
    }

    // Convert to Flux-compatible status format
    const fluxStatus: FluxKustomizationStatus = {
      observedGeneration: 1,
      conditions: [
        {
          type: 'Ready',
          status: app.status.health === 'healthy' ? 'True' : 'False',
          reason: app.status.sync === 'synced' ? 'ReconciliationSucceeded' : 'ReconciliationFailed',
          message: app.status.error ?? 'Reconciliation successful',
          lastTransitionTime: app.status.lastSyncedAt ?? new Date().toISOString(),
        },
        {
          type: 'Healthy',
          status: app.status.health === 'healthy' ? 'True' : 'False',
          reason: app.status.health === 'healthy' ? 'HealthCheckPassed' : 'HealthCheckFailed',
          message: '',
          lastTransitionTime: new Date().toISOString(),
        },
      ],
      lastAppliedRevision: app.status.lastSyncedRevision ?? '',
      lastAttemptedRevision: app.status.lastSyncedRevision ?? '',
      inventory: {
        entries: [],
      },
    };

    return { success: true, data: fluxStatus };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async resolveRevision(repo: GitRepository, revision: string): Promise<string> {
    // In a real implementation, this would resolve branch/tag to commit SHA
    // For now, return the revision as-is
    return revision;
  }

  private async waitForPlanCompletion(
    planId: string,
    timeout = this.config.syncTimeout,
  ): Promise<{ status: string; commitSha: string }> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout!) {
      const planResult = await this.planService.getPlan(planId);
      if (!planResult.success || !planResult.data) {
        throw new Error('Plan not found');
      }

      const plan = planResult.data;
      const terminalStatuses = ['planned', 'applied', 'plan_failed', 'apply_failed', 'rejected', 'cancelled'];
      
      if (terminalStatuses.includes(plan.status)) {
        return { status: plan.status, commitSha: plan.commitSha };
      }

      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error('Sync timeout');
  }

  private determineSyncStatus(planStatus: string): 'synced' | 'out_of_sync' | 'syncing' | 'failed' | 'unknown' {
    switch (planStatus) {
      case 'applied':
        return 'synced';
      case 'planned':
        return 'out_of_sync';
      case 'planning':
      case 'applying':
        return 'syncing';
      case 'plan_failed':
      case 'apply_failed':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  private determineHealthStatus(plan: { status: string }): 'healthy' | 'degraded' | 'unhealthy' | 'unknown' {
    switch (plan.status) {
      case 'applied':
        return 'healthy';
      case 'planned':
        return 'degraded';
      case 'plan_failed':
      case 'apply_failed':
        return 'unhealthy';
      default:
        return 'unknown';
    }
  }

  private getSyncResultMessage(status: string): string {
    switch (status) {
      case 'applied':
        return 'Successfully synced';
      case 'planned':
        return 'Changes detected, waiting for approval';
      case 'plan_failed':
        return 'Failed to generate plan';
      case 'apply_failed':
        return 'Failed to apply changes';
      default:
        return `Sync completed with status: ${status}`;
    }
  }

  private startAutomatedSync(appId: string): void {
    if (this.syncTimers.has(appId)) {
      return;
    }

    const timer = setInterval(() => {
      this.sync(appId).catch(console.error);
    }, this.config.reconciliationInterval);

    this.syncTimers.set(appId, timer);
  }

  private stopAutomatedSync(appId: string): void {
    const timer = this.syncTimers.get(appId);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(appId);
    }
  }

  private mapSyncStatusToArgo(status: string): 'Synced' | 'OutOfSync' | 'Unknown' {
    switch (status) {
      case 'synced':
        return 'Synced';
      case 'out_of_sync':
      case 'failed':
        return 'OutOfSync';
      default:
        return 'Unknown';
    }
  }

  private mapHealthStatusToArgo(health: string): 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown' {
    switch (health) {
      case 'healthy':
        return 'Healthy';
      case 'degraded':
        return 'Degraded';
      case 'unhealthy':
        return 'Degraded';
      default:
        return 'Unknown';
    }
  }

  private mapOperationPhaseToArgo(state: string): 'Running' | 'Terminating' | 'Failed' | 'Error' | 'Succeeded' {
    switch (state) {
      case 'running':
        return 'Running';
      case 'completed':
        return 'Succeeded';
      case 'failed':
        return 'Failed';
      case 'terminated':
        return 'Terminating';
      default:
        return 'Running';
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  shutdown(): void {
    // Stop all automated syncs
    for (const [appId] of this.syncTimers) {
      this.stopAutomatedSync(appId);
    }
  }
}

// =============================================================================
// Types for Sync Results
// =============================================================================

export interface SyncResult {
  appId: string;
  planId: string;
  status: 'synced' | 'out_of_sync' | 'syncing' | 'failed' | 'unknown';
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  revision: string;
  message: string;
}

export interface HealthCheckResult {
  appId: string;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  issues: string[];
  lastCheckedAt?: string;
}

// ArgoCD Compatibility Types
export interface ArgoAppStatus {
  sync: {
    status: 'Synced' | 'OutOfSync' | 'Unknown';
    revision: string;
    comparedTo: {
      source: {
        repoURL: string;
        path: string;
        targetRevision: string;
      };
      destination: {
        server: string;
        namespace: string;
      };
    };
  };
  health: {
    status: 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown';
    message: string;
  };
  operationState?: {
    operation: {
      sync: {
        revision: string;
        prune: boolean;
      };
    };
    phase: 'Running' | 'Terminating' | 'Failed' | 'Error' | 'Succeeded';
    message: string;
    startedAt: string;
    finishedAt: string;
  };
  conditions: Array<{
    type: string;
    message: string;
    lastTransitionTime: string;
  }>;
  resources: Array<{
    group: string;
    kind: string;
    namespace: string;
    name: string;
    status: string;
    health?: {
      status: string;
      message: string;
    };
  }>;
}

// Flux Compatibility Types
export interface FluxKustomizationStatus {
  observedGeneration: number;
  conditions: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    reason: string;
    message: string;
    lastTransitionTime: string;
  }>;
  lastAppliedRevision: string;
  lastAttemptedRevision: string;
  inventory: {
    entries: Array<{
      id: string;
      v: string;
    }>;
  };
}

// =============================================================================
// Factory
// =============================================================================

export function createSyncService(
  repositoryManager: RepositoryManager,
  planService: PlanService,
  config?: SyncServiceConfig,
  storage?: SyncStorage,
): SyncService {
  return new SyncService(repositoryManager, planService, config, storage);
}
