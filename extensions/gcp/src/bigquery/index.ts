/**
 * GCP Extension — BigQuery Manager
 *
 * Manages BigQuery datasets, tables, queries, and jobs.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** A BigQuery dataset. */
export type GcpBQDataset = {
  id: string;
  location: string;
  defaultTableExpiration: number | null;
  labels: Record<string, string>;
  createdAt: string;
};

/** A BigQuery table. */
export type GcpBQTable = {
  id: string;
  datasetId: string;
  type: string;
  numRows: number;
  numBytes: number;
  schema: Array<{ name: string; type: string; mode?: string; description?: string }>;
  createdAt: string;
};

/** Result of a BigQuery query execution. */
export type GcpBQQueryResult = {
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  schema: Array<{ name: string; type: string }>;
  jobId: string;
  totalBytesProcessed: number;
  cacheHit: boolean;
};

/** A BigQuery job. */
export type GcpBQJob = {
  id: string;
  state: string;
  statistics: Record<string, unknown>;
  errorResult: { reason: string; message: string } | null;
  createdAt: string;
};

// =============================================================================
// GcpBigQueryManager
// =============================================================================

/**
 * Manages GCP BigQuery resources.
 *
 * Provides methods for listing datasets and tables, running queries,
 * and inspecting jobs.
 */
export class GcpBigQueryManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all datasets in the project. */
  async listDatasets(): Promise<GcpBQDataset[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call bigquery.datasets.list
      const _endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets`;

      return [] as GcpBQDataset[];
    }, this.retryOptions);
  }

  /** Get a single dataset by ID. */
  async getDataset(id: string): Promise<GcpBQDataset> {
    return withGcpRetry(async () => {
      // Placeholder: would call bigquery.datasets.get
      const _endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${id}`;

      throw new Error(`BigQuery dataset ${id} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List tables in a dataset. */
  async listTables(datasetId: string): Promise<GcpBQTable[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call bigquery.tables.list
      const _endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${datasetId}/tables`;

      return [] as GcpBQTable[];
    }, this.retryOptions);
  }

  /** Get a single table by dataset and table ID. */
  async getTable(datasetId: string, tableId: string): Promise<GcpBQTable> {
    return withGcpRetry(async () => {
      // Placeholder: would call bigquery.tables.get
      const _endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${datasetId}/tables/${tableId}`;

      throw new Error(`BigQuery table ${datasetId}.${tableId} not found (placeholder)`);
    }, this.retryOptions);
  }

  /**
   * Run a BigQuery SQL query.
   *
   * @param query - The SQL query string.
   * @param opts  - Optional settings: dryRun (estimate only), maxResults.
   */
  async runQuery(query: string, opts?: { dryRun?: boolean; maxResults?: number }): Promise<GcpBQQueryResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call bigquery.jobs.query
      const _endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/queries`;
      void query;
      void opts;

      return {
        rows: [],
        totalRows: 0,
        schema: [],
        jobId: `job-${Date.now()}`,
        totalBytesProcessed: 0,
        cacheHit: false,
      } satisfies GcpBQQueryResult;
    }, this.retryOptions);
  }

  /** List BigQuery jobs, optionally filtered by state. */
  async listJobs(opts?: { stateFilter?: string }): Promise<GcpBQJob[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call bigquery.jobs.list
      const params = opts?.stateFilter ? `?stateFilter=${opts.stateFilter}` : "";
      const _endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/jobs${params}`;

      return [] as GcpBQJob[];
    }, this.retryOptions);
  }
}

/** Factory: create a GcpBigQueryManager instance. */
export function createBigQueryManager(projectId: string, retryOptions?: GcpRetryOptions): GcpBigQueryManager {
  return new GcpBigQueryManager(projectId, retryOptions);
}
