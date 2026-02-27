/**
 * AWS Adapter — Shared Context Interface
 *
 * Defines the dependency surface that domain modules need from the main
 * AwsDiscoveryAdapter class. This enables the adapter's domain-specific
 * logic (compute, database, security, etc.) to live in separate modules
 * while sharing access to configuration, SDK clients, and manager instances.
 *
 * The main AwsDiscoveryAdapter creates a context object that binds its
 * private methods and state, then passes it to each domain module function.
 */

import type { GraphResourceType } from "../../types.js";
import type { AwsAdapterConfig, AwsClient } from "./types.js";

/**
 * Shared context passed to domain module functions.
 *
 * Provides access to adapter configuration, AWS SDK client creation,
 * cost estimation, and lazy-loaded @espada/aws manager instances.
 */
export interface AwsAdapterContext {
  /** AWS account ID from adapter config. */
  readonly accountId: string;

  /** Full adapter configuration (read-only). */
  readonly config: AwsAdapterConfig;

  // ---------------------------------------------------------------------------
  // AWS SDK Access
  // ---------------------------------------------------------------------------

  /** Create an AWS SDK v3 client for the given service and region. */
  createClient(service: string, region: string): Promise<AwsClient | null>;

  /** Build an SDK v3 command for the given service method. */
  buildCommand(service: string, method: string): Promise<unknown | null>;

  // ---------------------------------------------------------------------------
  // Cost Estimation
  // ---------------------------------------------------------------------------

  /** Static cost estimation fallback using resource metadata. */
  estimateCostStatic(
    resourceType: GraphResourceType,
    metadata: Record<string, unknown>,
  ): number | null;

  // ---------------------------------------------------------------------------
  // @espada/aws Manager Getters (lazy-loaded, return null if unavailable)
  // ---------------------------------------------------------------------------

  getEC2Manager(): Promise<unknown | null>;
  getRDSManager(): Promise<unknown | null>;
  getElastiCacheManager(): Promise<unknown | null>;
  getOrganizationManager(): Promise<unknown | null>;
  getBackupManager(): Promise<unknown | null>;
  getComplianceManager(): Promise<unknown | null>;
  getAutomationManager(): Promise<unknown | null>;
  getCICDManager(): Promise<unknown | null>;
  getCognitoManager(): Promise<unknown | null>;
  getTaggingManager(): Promise<unknown | null>;
  getLambdaManager(): Promise<unknown | null>;
  getObservabilityManager(): Promise<unknown | null>;
  getS3Manager(): Promise<unknown | null>;
  getSecurityManager(): Promise<unknown | null>;
  getCostManagerInstance(): Promise<unknown | null>;
  getCloudTrailManager(): Promise<unknown | null>;
  getContainerManager(): Promise<unknown | null>;
  getNetworkManager(): Promise<unknown | null>;
  getDynamoDBManager(): Promise<unknown | null>;
  getAPIGatewayManager(): Promise<unknown | null>;
  getSQSManager(): Promise<unknown | null>;
  getSNSManager(): Promise<unknown | null>;
  getRoute53Manager(): Promise<unknown | null>;
}
