/**
 * GitOps Module
 *
 * Provides Git-based infrastructure management with support for
 * GitHub/GitLab/Bitbucket webhooks, PR-based changes, drift detection,
 * and ArgoCD/Flux compatibility.
 */

// Types
export type {
  GitProvider,
  GitCredentials,
  GitRepoSettings,
  GitRepository,
  WebhookEvent,
  WebhookPayload,
  PullRequestInfo,
  InfrastructurePlan,
  PlanOutput,
  PlannedResource,
  CostEstimate,
  PolicyCheckResult,
  DriftDetectionRun,
  DriftedResource,
  GitOpsApplication,
  SyncPolicy,
  PlanComment,
  GitOpsResult,
} from './types.js';

// Repository Management
export {
  RepositoryManager,
  createRepositoryManager,
  type RepositoryStorage,
  type RepositoryManagerConfig,
  type GitProviderClient,
} from './repository.js';

// Webhook Handling
export {
  WebhookHandler,
  PullRequestHandler,
  CommentCommandHandler,
  createWebhookHandler,
  type WebhookStorage,
  type WebhookHandlerConfig,
  type WebhookEventHandler,
  type WebhookContext,
} from './webhook.js';

// Plan Service
export {
  PlanService,
  createPlanService,
  type PlanStorage,
  type PlanServiceConfig,
  type PlanExecutor,
  type PlanExecutionParams,
  type PlanExecutionResult,
} from './plan.js';

// Drift Detection
export {
  DriftService,
  createDriftService,
  type DriftStorage,
  type DriftServiceConfig,
  type DriftDetector,
  type DriftDetectionParams,
} from './drift.js';

// PR Comments
export {
  PRCommentService,
  createPRCommentService,
  type CommentStorage,
  type PRCommentServiceConfig,
} from './comments.js';

// Sync Service (ArgoCD/Flux Compatibility)
export {
  SyncService,
  createSyncService,
  type SyncStorage,
  type SyncServiceConfig,
  type SyncResult,
  type HealthCheckResult,
  type ArgoAppStatus,
  type FluxKustomizationStatus,
} from './sync.js';

// =============================================================================
// Composite GitOps Service
// =============================================================================

import { RepositoryManager, createRepositoryManager, type RepositoryManagerConfig } from './repository.js';
import { WebhookHandler, createWebhookHandler, type WebhookHandlerConfig } from './webhook.js';
import { PlanService, createPlanService, type PlanServiceConfig } from './plan.js';
import { DriftService, createDriftService, type DriftServiceConfig } from './drift.js';
import { PRCommentService, createPRCommentService, type PRCommentServiceConfig } from './comments.js';
import { SyncService, createSyncService, type SyncServiceConfig } from './sync.js';

export interface GitOpsServiceConfig {
  repository?: RepositoryManagerConfig;
  webhook?: WebhookHandlerConfig;
  plan?: PlanServiceConfig;
  drift?: DriftServiceConfig;
  comments?: PRCommentServiceConfig;
  sync?: SyncServiceConfig;
}

export interface GitOpsServices {
  repository: RepositoryManager;
  webhook: WebhookHandler;
  plan: PlanService;
  drift: DriftService;
  comments: PRCommentService;
  sync: SyncService;
  shutdown: () => void;
}

/**
 * Creates all GitOps services with proper dependencies
 */
export function createGitOpsServices(config?: GitOpsServiceConfig): GitOpsServices {
  // Create services in dependency order
  const repository = createRepositoryManager(config?.repository ?? { webhookBaseUrl: '' });
  const plan = createPlanService(repository, config?.plan);
  const webhook = createWebhookHandler(repository, config?.webhook);
  const drift = createDriftService(repository, plan, config?.drift);
  const comments = createPRCommentService(repository, config?.comments);
  const sync = createSyncService(repository, plan, config?.sync);

  // Return composite service object
  return {
    repository,
    webhook,
    plan,
    drift,
    comments,
    sync,
    shutdown: () => {
      // Shutdown services that support it
      if ('shutdown' in drift && typeof drift.shutdown === 'function') {
        drift.shutdown();
      }
      if ('shutdown' in sync && typeof sync.shutdown === 'function') {
        sync.shutdown();
      }
    },
  };
}
