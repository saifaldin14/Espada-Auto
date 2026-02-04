/**
 * Drift Detection Service
 *
 * Detects and reports infrastructure drift between the actual
 * state and the desired state defined in Git.
 */

import { randomUUID } from 'node:crypto';
import type {
  DriftDetectionRun,
  DriftedResource,
  GitOpsResult,
} from './types.js';
import type { RepositoryManager, GitProviderClient } from './repository.js';
import type { PlanService, PlanExecutor } from './plan.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface DriftStorage {
  create(run: DriftDetectionRun): Promise<void>;
  get(runId: string): Promise<DriftDetectionRun | null>;
  getLatest(repositoryId: string, environment: string): Promise<DriftDetectionRun | null>;
  list(options: {
    tenantId?: string;
    workspaceId?: string;
    repositoryId?: string;
    environment?: string;
    hasDrift?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<DriftDetectionRun[]>;
  update(runId: string, updates: Partial<DriftDetectionRun>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryDriftStorage implements DriftStorage {
  private runs = new Map<string, DriftDetectionRun>();

  async create(run: DriftDetectionRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async get(runId: string): Promise<DriftDetectionRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async getLatest(repositoryId: string, environment: string): Promise<DriftDetectionRun | null> {
    const runs = Array.from(this.runs.values())
      .filter(r => r.repositoryId === repositoryId && r.environment === environment)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return runs[0] ?? null;
  }

  async list(options: {
    tenantId?: string;
    workspaceId?: string;
    repositoryId?: string;
    environment?: string;
    hasDrift?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<DriftDetectionRun[]> {
    let results = Array.from(this.runs.values()).filter(r => {
      if (options.tenantId && r.tenantId !== options.tenantId) return false;
      if (options.workspaceId && r.workspaceId !== options.workspaceId) return false;
      if (options.repositoryId && r.repositoryId !== options.repositoryId) return false;
      if (options.environment && r.environment !== options.environment) return false;
      if (options.hasDrift !== undefined && r.hasDrift !== options.hasDrift) return false;
      return true;
    });

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async update(runId: string, updates: Partial<DriftDetectionRun>): Promise<void> {
    const run = this.runs.get(runId);
    if (run) {
      this.runs.set(runId, { ...run, ...updates });
    }
  }
}

// =============================================================================
// Drift Detector Interface
// =============================================================================

export interface DriftDetector {
  format: string;
  
  detectDrift(params: DriftDetectionParams): Promise<DriftDetectionResult>;
}

export interface DriftDetectionParams {
  workingDir: string;
  environment: string;
  variables?: Record<string, string>;
}

export interface DriftDetectionResult {
  success: boolean;
  hasDrift: boolean;
  driftedResources: DriftedResource[];
  logs: string;
  errorLogs?: string;
}

// =============================================================================
// Drift Detection Service
// =============================================================================

export interface DriftServiceConfig {
  workDir?: string;
  detectionTimeout?: number;
  autoCreatePREnabled?: boolean;
}

export class DriftService {
  private storage: DriftStorage;
  private config: DriftServiceConfig;
  private repositoryManager: RepositoryManager;
  private planService: PlanService;
  private detectors = new Map<string, DriftDetector>();
  private schedules = new Map<string, NodeJS.Timeout>();

  constructor(
    repositoryManager: RepositoryManager,
    planService: PlanService,
    config?: DriftServiceConfig,
    storage?: DriftStorage,
  ) {
    this.repositoryManager = repositoryManager;
    this.planService = planService;
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryDriftStorage();
  }

  // ===========================================================================
  // Detector Registration
  // ===========================================================================

  registerDetector(detector: DriftDetector): void {
    this.detectors.set(detector.format, detector);
  }

  // ===========================================================================
  // Manual Drift Detection
  // ===========================================================================

  async runDriftDetection(
    repositoryId: string,
    environment: string,
    triggeredBy?: string,
  ): Promise<GitOpsResult<DriftDetectionRun>> {
    // Get repository
    const repoResult = await this.repositoryManager.getRepository(repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    // Check if drift detection is enabled
    if (!repo.settings.driftDetectionEnabled) {
      return { success: false, errors: ['Drift detection is not enabled for this repository'] };
    }

    // Get detector for the IaC format
    const detector = this.detectors.get(repo.iacFormat);
    if (!detector) {
      return { success: false, errors: [`No detector configured for format: ${repo.iacFormat}`] };
    }

    const now = new Date().toISOString();

    // Get workspace mapping
    const mapping = repo.settings.workspaceMappings.find(
      m => m.environment === environment,
    );

    if (!mapping) {
      return { success: false, errors: [`No workspace mapping for environment: ${environment}`] };
    }

    // Create drift detection run
    const run: DriftDetectionRun = {
      id: `drift_${randomUUID()}`,
      tenantId: repo.tenantId,
      workspaceId: repo.workspaceId,
      repositoryId,
      environment,
      iacPath: mapping.path,
      triggerType: triggeredBy ? 'manual' : 'scheduled',
      triggeredBy,
      status: 'pending',
      hasDrift: false,
      driftedResources: [],
      createdAt: now,
    };

    await this.storage.create(run);

    // Execute drift detection asynchronously
    this.executeDriftDetection(run, repo, detector, mapping).catch(console.error);

    return { success: true, data: run };
  }

  private async executeDriftDetection(
    run: DriftDetectionRun,
    repo: { iacFormat: string; owner: string; name: string; defaultBranch: string; settings: { driftAutoCreatePR: boolean } },
    detector: DriftDetector,
    mapping: { path: string; variables?: Record<string, string>; awsRegion?: string },
  ): Promise<void> {
    await this.storage.update(run.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    try {
      const workingDir = `${this.config.workDir ?? '/tmp/drift'}/${run.id}`;
      
      const variables = {
        ...mapping.variables,
        AWS_REGION: mapping.awsRegion ?? 'us-east-1',
      };

      const result = await detector.detectDrift({
        workingDir: `${workingDir}/${mapping.path}`,
        environment: run.environment,
        variables,
      });

      await this.storage.update(run.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        hasDrift: result.hasDrift,
        driftedResources: result.driftedResources,
      });

      // Create PR if drift detected and auto-create enabled
      if (result.hasDrift && repo.settings.driftAutoCreatePR && this.config.autoCreatePREnabled) {
        await this.createDriftPR(run, repo, result.driftedResources);
      }
    } catch (error) {
      await this.storage.update(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      });
    }
  }

  private async createDriftPR(
    run: DriftDetectionRun,
    repo: { owner: string; name: string; defaultBranch: string },
    driftedResources: DriftedResource[],
  ): Promise<void> {
    // Get provider client
    const repoResult = await this.repositoryManager.getRepository(run.repositoryId);
    if (!repoResult.success || !repoResult.data) return;

    const client = this.repositoryManager.getClient(repoResult.data.provider);
    if (!client) return;

    const branchName = `drift-fix/${run.environment}/${run.id.slice(0, 8)}`;
    const title = `[Drift] Infrastructure drift detected in ${run.environment}`;
    
    const body = this.buildDriftPRBody(run, driftedResources);

    try {
      const pr = await client.createPullRequest(repo.owner, repo.name, {
        title,
        body,
        head: branchName,
        base: repo.defaultBranch,
      });

      await this.storage.update(run.id, {
        pullRequestCreated: true,
        pullRequestNumber: pr.number,
        pullRequestUrl: pr.url,
      });
    } catch {
      // PR creation failed, but detection succeeded
    }
  }

  private buildDriftPRBody(run: DriftDetectionRun, driftedResources: DriftedResource[]): string {
    const resourceList = driftedResources.map(r => {
      const changes = r.changedAttributes.map(c =>
        `  - \`${c.path}\`: \`${JSON.stringify(c.expected)}\` → \`${JSON.stringify(c.actual)}\``,
      ).join('\n');
      return `### ${r.address}\n**Type:** ${r.driftType}\n${changes}`;
    }).join('\n\n');

    return `## Infrastructure Drift Detected

**Environment:** ${run.environment}
**Path:** ${run.iacPath}
**Detected At:** ${run.createdAt}
**Resources Affected:** ${driftedResources.length}

## Drifted Resources

${resourceList}

---

This PR was automatically created by IDIO drift detection.

### Next Steps

1. Review the changes above
2. If the drift is intentional, update the infrastructure code to match
3. If the drift is unintended, apply the infrastructure code to restore desired state

/cc @infrastructure-team`;
  }

  // ===========================================================================
  // Scheduled Detection
  // ===========================================================================

  async enableScheduledDetection(
    repositoryId: string,
    environment: string,
    schedule: string, // Cron expression
  ): Promise<GitOpsResult> {
    const key = `${repositoryId}:${environment}`;
    
    // Clear existing schedule
    if (this.schedules.has(key)) {
      clearInterval(this.schedules.get(key)!);
    }

    // Parse cron and set up interval (simplified - in production use node-cron)
    const intervalMs = this.cronToMs(schedule);
    if (intervalMs <= 0) {
      return { success: false, errors: ['Invalid schedule'] };
    }

    const timer = setInterval(() => {
      this.runDriftDetection(repositoryId, environment).catch(console.error);
    }, intervalMs);

    this.schedules.set(key, timer);
    
    return { success: true, message: 'Scheduled detection enabled' };
  }

  async disableScheduledDetection(
    repositoryId: string,
    environment: string,
  ): Promise<GitOpsResult> {
    const key = `${repositoryId}:${environment}`;
    
    if (this.schedules.has(key)) {
      clearInterval(this.schedules.get(key)!);
      this.schedules.delete(key);
    }

    return { success: true, message: 'Scheduled detection disabled' };
  }

  private cronToMs(schedule: string): number {
    // Simplified cron parsing - in production use a proper cron library
    // This handles common cases like "0 0 * * *" (daily) and "0 * * * *" (hourly)
    
    const parts = schedule.split(' ');
    if (parts.length !== 5) return -1;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Daily at specific time
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return 24 * 60 * 60 * 1000; // 24 hours
    }

    // Hourly
    if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return 60 * 60 * 1000; // 1 hour
    }

    // Every N hours (simplified)
    if (hour.includes('/')) {
      const interval = parseInt(hour.split('/')[1], 10);
      if (!isNaN(interval)) {
        return interval * 60 * 60 * 1000;
      }
    }

    // Default to daily
    return 24 * 60 * 60 * 1000;
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  async getDriftRun(runId: string): Promise<GitOpsResult<DriftDetectionRun>> {
    const run = await this.storage.get(runId);
    if (!run) {
      return { success: false, errors: ['Drift detection run not found'] };
    }
    return { success: true, data: run };
  }

  async getLatestDrift(
    repositoryId: string,
    environment: string,
  ): Promise<GitOpsResult<DriftDetectionRun | null>> {
    const run = await this.storage.getLatest(repositoryId, environment);
    return { success: true, data: run };
  }

  async listDriftRuns(options: {
    tenantId?: string;
    workspaceId?: string;
    repositoryId?: string;
    environment?: string;
    hasDrift?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<GitOpsResult<DriftDetectionRun[]>> {
    const runs = await this.storage.list(options);
    return { success: true, data: runs };
  }

  // ===========================================================================
  // Drift Summary
  // ===========================================================================

  async getDriftSummary(tenantId: string): Promise<GitOpsResult<DriftSummary>> {
    const allRuns = await this.storage.list({ tenantId });
    
    // Group by repository and environment, get latest
    const latestByEnv = new Map<string, DriftDetectionRun>();
    for (const run of allRuns) {
      const key = `${run.repositoryId}:${run.environment}`;
      const existing = latestByEnv.get(key);
      if (!existing || new Date(run.createdAt) > new Date(existing.createdAt)) {
        latestByEnv.set(key, run);
      }
    }

    const latest = Array.from(latestByEnv.values());
    
    const summary: DriftSummary = {
      totalEnvironments: latest.length,
      environmentsWithDrift: latest.filter(r => r.hasDrift).length,
      totalDriftedResources: latest.reduce((sum, r) => sum + r.driftedResources.length, 0),
      lastCheckedAt: latest.length > 0
        ? latest.reduce((max, r) => 
            new Date(r.createdAt) > new Date(max) ? r.createdAt : max, 
            latest[0].createdAt,
          )
        : undefined,
      byEnvironment: latest.map(r => ({
        repositoryId: r.repositoryId,
        environment: r.environment,
        hasDrift: r.hasDrift,
        driftedResourceCount: r.driftedResources.length,
        lastCheckedAt: r.createdAt,
        status: r.status,
      })),
    };

    return { success: true, data: summary };
  }
}

export interface DriftSummary {
  totalEnvironments: number;
  environmentsWithDrift: number;
  totalDriftedResources: number;
  lastCheckedAt?: string;
  byEnvironment: Array<{
    repositoryId: string;
    environment: string;
    hasDrift: boolean;
    driftedResourceCount: number;
    lastCheckedAt: string;
    status: DriftDetectionRun['status'];
  }>;
}

// =============================================================================
// Factory
// =============================================================================

export function createDriftService(
  repositoryManager: RepositoryManager,
  planService: PlanService,
  config?: DriftServiceConfig,
  storage?: DriftStorage,
): DriftService {
  return new DriftService(repositoryManager, planService, config, storage);
}
