/**
 * GCP Extension — Cloud SQL Manager
 *
 * Manages Cloud SQL instances, databases, users, and backups.
 * Uses GCP Cloud SQL Admin REST API via shared helpers.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

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
// Internal API response shapes
// =============================================================================

type SqlInstanceRaw = {
  name: string;
  databaseVersion: string;
  region: string;
  state: string;
  ipAddresses?: Array<{ type: string; ipAddress: string }>;
  settings?: {
    tier?: string;
    userLabels?: Record<string, string>;
    [k: string]: unknown;
  };
};

// =============================================================================
// GcpCloudSQLManager
// =============================================================================

const SQL_BASE = "https://sqladmin.googleapis.com/v1";

function mapInstance(raw: SqlInstanceRaw): GcpSQLInstance {
  return {
    name: raw.name,
    databaseVersion: raw.databaseVersion,
    tier: raw.settings?.tier ?? "",
    region: raw.region,
    state: raw.state,
    ipAddresses: raw.ipAddresses ?? [],
    settings: (raw.settings ?? {}) as Record<string, unknown>,
    labels: raw.settings?.userLabels ?? {},
  };
}

/**
 * Manages GCP Cloud SQL resources.
 *
 * Provides methods for listing and inspecting Cloud SQL instances,
 * databases, users, and backups.
 */
export class GcpCloudSQLManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all Cloud SQL instances in the project. */
  async listInstances(): Promise<GcpSQLInstance[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SQL_BASE}/projects/${this.projectId}/instances`;
      const items = await gcpList<SqlInstanceRaw>(url, token, "items");
      return items.map(mapInstance);
    }, this.retryOptions);
  }

  /** Get a single Cloud SQL instance by name. */
  async getInstance(name: string): Promise<GcpSQLInstance> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SQL_BASE}/projects/${this.projectId}/instances/${encodeURIComponent(name)}`;
      const raw = await gcpRequest<SqlInstanceRaw>(url, token);
      return mapInstance(raw);
    }, this.retryOptions);
  }

  /** List databases belonging to a Cloud SQL instance. */
  async listDatabases(instance: string): Promise<GcpSQLDatabase[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SQL_BASE}/projects/${this.projectId}/instances/${encodeURIComponent(instance)}/databases`;
      const items = await gcpList<{ name: string; charset: string; collation: string }>(url, token, "items");
      return items.map((d) => ({ name: d.name, charset: d.charset, collation: d.collation }));
    }, this.retryOptions);
  }

  /** List users belonging to a Cloud SQL instance. */
  async listUsers(instance: string): Promise<GcpSQLUser[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SQL_BASE}/projects/${this.projectId}/instances/${encodeURIComponent(instance)}/users`;
      const items = await gcpList<{ name: string; host: string; type: string }>(url, token, "items");
      return items.map((u) => ({ name: u.name, host: u.host ?? "", type: u.type ?? "" }));
    }, this.retryOptions);
  }

  /** Restart a Cloud SQL instance. */
  async restartInstance(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SQL_BASE}/projects/${this.projectId}/instances/${encodeURIComponent(name)}/restart`;
      return gcpMutate(url, token, {});
    }, this.retryOptions);
  }

  /** List backup runs for a Cloud SQL instance. */
  async listBackups(instance: string): Promise<GcpSQLBackup[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SQL_BASE}/projects/${this.projectId}/instances/${encodeURIComponent(instance)}/backupRuns`;
      const items = await gcpList<{ id: string; status: string; startTime: string; endTime: string; type: string }>(url, token, "items");
      return items.map((b) => ({
        id: String(b.id),
        status: b.status,
        startTime: b.startTime ?? "",
        endTime: b.endTime ?? "",
        type: b.type ?? "",
      }));
    }, this.retryOptions);
  }
}

/** Factory: create a GcpCloudSQLManager instance. */
export function createCloudSQLManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpCloudSQLManager {
  return new GcpCloudSQLManager(projectId, getAccessToken, retryOptions);
}
