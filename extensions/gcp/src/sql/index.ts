/**
 * GCP Extension — Cloud SQL Manager
 *
 * Manages Cloud SQL instances, databases, users, and backups.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** A Cloud SQL instance. */
export type GcpSQLInstance = {
  name: string;
  databaseVersion: string;
  tier: string;
  region: string;
  state: string;
  ipAddresses: Array<{ type: string; ipAddress: string }>;
  settings: Record<string, unknown>;
  labels: Record<string, string>;
};

/** A database within a Cloud SQL instance. */
export type GcpSQLDatabase = {
  name: string;
  charset: string;
  collation: string;
};

/** A user within a Cloud SQL instance. */
export type GcpSQLUser = {
  name: string;
  host: string;
  type: string;
};

/** A backup run for a Cloud SQL instance. */
export type GcpSQLBackup = {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  type: string;
};

// =============================================================================
// GcpCloudSQLManager
// =============================================================================

/**
 * Manages GCP Cloud SQL resources.
 *
 * Provides methods for listing and inspecting Cloud SQL instances,
 * databases, users, and backups.
 */
export class GcpCloudSQLManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all Cloud SQL instances in the project. */
  async listInstances(): Promise<GcpSQLInstance[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call sqladmin.instances.list
      const _endpoint = `https://sqladmin.googleapis.com/v1/projects/${this.projectId}/instances`;

      return [] as GcpSQLInstance[];
    }, this.retryOptions);
  }

  /** Get a single Cloud SQL instance by name. */
  async getInstance(name: string): Promise<GcpSQLInstance> {
    return withGcpRetry(async () => {
      // Placeholder: would call sqladmin.instances.get
      const _endpoint = `https://sqladmin.googleapis.com/v1/projects/${this.projectId}/instances/${name}`;

      throw new Error(`Cloud SQL instance ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List databases belonging to a Cloud SQL instance. */
  async listDatabases(instance: string): Promise<GcpSQLDatabase[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call sqladmin.databases.list
      const _endpoint = `https://sqladmin.googleapis.com/v1/projects/${this.projectId}/instances/${instance}/databases`;

      return [] as GcpSQLDatabase[];
    }, this.retryOptions);
  }

  /** List users belonging to a Cloud SQL instance. */
  async listUsers(instance: string): Promise<GcpSQLUser[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call sqladmin.users.list
      const _endpoint = `https://sqladmin.googleapis.com/v1/projects/${this.projectId}/instances/${instance}/users`;

      return [] as GcpSQLUser[];
    }, this.retryOptions);
  }

  /** Restart a Cloud SQL instance. */
  async restartInstance(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call sqladmin.instances.restart
      const _endpoint = `https://sqladmin.googleapis.com/v1/projects/${this.projectId}/instances/${name}/restart`;

      return {
        success: true,
        message: `Cloud SQL instance ${name} restart initiated`,
        operationId: `op-restart-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /** List backup runs for a Cloud SQL instance. */
  async listBackups(instance: string): Promise<GcpSQLBackup[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call sqladmin.backupRuns.list
      const _endpoint = `https://sqladmin.googleapis.com/v1/projects/${this.projectId}/instances/${instance}/backupRuns`;

      return [] as GcpSQLBackup[];
    }, this.retryOptions);
  }
}

/** Factory: create a GcpCloudSQLManager instance. */
export function createCloudSQLManager(projectId: string, retryOptions?: GcpRetryOptions): GcpCloudSQLManager {
  return new GcpCloudSQLManager(projectId, retryOptions);
}
