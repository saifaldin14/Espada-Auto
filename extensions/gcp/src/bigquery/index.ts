/**
 * GCP Extension — BigQuery Manager
 *
 * Manages BigQuery datasets, tables, queries, and jobs.
 * Uses BigQuery REST API v2 via shared helpers.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList } from "../api.js";

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
// Internal API response shapes
// =============================================================================

type DatasetRaw = {
  datasetReference?: { datasetId?: string };
  location?: string;
  defaultTableExpirationMs?: string;
  labels?: Record<string, string>;
  creationTime?: string;
};

type TableRaw = {
  tableReference?: { tableId?: string; datasetId?: string };
  type?: string;
  numRows?: string;
  numBytes?: string;
  schema?: { fields?: Array<{ name: string; type: string; mode?: string; description?: string }> };
  creationTime?: string;
};

type QueryResponseRaw = {
  rows?: Array<{ f: Array<{ v: unknown }> }>;
  totalRows?: string;
  schema?: { fields?: Array<{ name: string; type: string }> };
  jobReference?: { jobId?: string };
  totalBytesProcessed?: string;
  cacheHit?: boolean;
};

type JobRaw = {
  jobReference?: { jobId?: string };
  status?: { state?: string; errorResult?: { reason: string; message: string } };
  statistics?: Record<string, unknown> & { creationTime?: string };
};

// =============================================================================
// Helpers
// =============================================================================

const BQ_BASE = "https://bigquery.googleapis.com/bigquery/v2";

function msToIso(ms: string | undefined): string {
  if (!ms) return "";
  return new Date(Number(ms)).toISOString();
}

function mapDataset(raw: DatasetRaw): GcpBQDataset {
  const expMs = raw.defaultTableExpirationMs;
  return {
    id: raw.datasetReference?.datasetId ?? "",
    location: raw.location ?? "",
    defaultTableExpiration: expMs ? Number(expMs) : null,
    labels: raw.labels ?? {},
    createdAt: msToIso(raw.creationTime),
  };
}

function mapTable(raw: TableRaw): GcpBQTable {
  return {
    id: raw.tableReference?.tableId ?? "",
    datasetId: raw.tableReference?.datasetId ?? "",
    type: raw.type ?? "",
    numRows: raw.numRows ? Number(raw.numRows) : 0,
    numBytes: raw.numBytes ? Number(raw.numBytes) : 0,
    schema: raw.schema?.fields ?? [],
    createdAt: msToIso(raw.creationTime),
  };
}

function mapJob(raw: JobRaw): GcpBQJob {
  return {
    id: raw.jobReference?.jobId ?? "",
    state: raw.status?.state ?? "",
    statistics: raw.statistics ?? {},
    errorResult: raw.status?.errorResult ?? null,
    createdAt: msToIso(raw.statistics?.creationTime as string | undefined),
  };
}

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
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all datasets in the project. */
  async listDatasets(): Promise<GcpBQDataset[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BQ_BASE}/projects/${this.projectId}/datasets`;
      const items = await gcpList<DatasetRaw>(url, token, "datasets");
      return items.map(mapDataset);
    }, this.retryOptions);
  }

  /** Get a single dataset by ID. */
  async getDataset(id: string): Promise<GcpBQDataset> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BQ_BASE}/projects/${this.projectId}/datasets/${encodeURIComponent(id)}`;
      const raw = await gcpRequest<DatasetRaw>(url, token);
      return mapDataset(raw);
    }, this.retryOptions);
  }

  /** List tables in a dataset. */
  async listTables(datasetId: string): Promise<GcpBQTable[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BQ_BASE}/projects/${this.projectId}/datasets/${encodeURIComponent(datasetId)}/tables`;
      const items = await gcpList<TableRaw>(url, token, "tables");
      return items.map(mapTable);
    }, this.retryOptions);
  }

  /** Get a single table by dataset and table ID. */
  async getTable(datasetId: string, tableId: string): Promise<GcpBQTable> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BQ_BASE}/projects/${this.projectId}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}`;
      const raw = await gcpRequest<TableRaw>(url, token);
      return mapTable(raw);
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
      const token = await this.getAccessToken();
      const url = `${BQ_BASE}/projects/${this.projectId}/queries`;
      const body: Record<string, unknown> = {
        query,
        useLegacySql: false,
      };
      if (opts?.dryRun) body.dryRun = true;
      if (opts?.maxResults != null) body.maxResults = opts.maxResults;

      const raw = await gcpRequest<QueryResponseRaw>(url, token, { method: "POST", body });

      // Convert BQ row format ({f:[{v:...}]}) to named objects using schema
      const schemaFields = raw.schema?.fields ?? [];
      const rows: Array<Record<string, unknown>> = (raw.rows ?? []).map((row) => {
        const obj: Record<string, unknown> = {};
        row.f.forEach((cell, i) => {
          const fieldName = schemaFields[i]?.name ?? `col_${i}`;
          obj[fieldName] = cell.v;
        });
        return obj;
      });

      return {
        rows,
        totalRows: raw.totalRows ? Number(raw.totalRows) : 0,
        schema: schemaFields,
        jobId: raw.jobReference?.jobId ?? "",
        totalBytesProcessed: raw.totalBytesProcessed ? Number(raw.totalBytesProcessed) : 0,
        cacheHit: raw.cacheHit ?? false,
      };
    }, this.retryOptions);
  }

  /** List BigQuery jobs, optionally filtered by state. */
  async listJobs(opts?: { stateFilter?: string }): Promise<GcpBQJob[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = opts?.stateFilter ? `?stateFilter=${encodeURIComponent(opts.stateFilter)}` : "";
      const url = `${BQ_BASE}/projects/${this.projectId}/jobs${params}`;
      const items = await gcpList<JobRaw>(url, token, "jobs");
      return items.map(mapJob);
    }, this.retryOptions);
  }
}

/** Factory: create a GcpBigQueryManager instance. */
export function createBigQueryManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpBigQueryManager {
  return new GcpBigQueryManager(projectId, getAccessToken, retryOptions);
}
