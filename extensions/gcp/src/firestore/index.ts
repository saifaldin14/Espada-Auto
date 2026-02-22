/**
 * GCP Extension — Firestore Manager
 *
 * Manages Firestore databases, collections, indexes, and import/export ops.
 * Uses Firestore REST API v1 via shared helpers.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate, shortName } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Firestore database. */
export type GcpFirestoreDatabase = {
  name: string;
  type: string;
  locationId: string;
  concurrencyMode: string;
  status: string;
};

/** A Firestore collection. */
export type GcpFirestoreCollection = {
  name: string;
  documentCount: number;
};

/** A Firestore composite index. */
export type GcpFirestoreIndex = {
  name: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
  state: string;
};

// =============================================================================
// Internal API response shapes
// =============================================================================

type DatabaseRaw = {
  name: string;
  type?: string;
  locationId?: string;
  concurrencyMode?: string;
};

type IndexRaw = {
  name: string;
  fields?: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
  state?: string;
};

// =============================================================================
// Helpers
// =============================================================================

const FS_BASE = "https://firestore.googleapis.com/v1";

function mapDatabase(raw: DatabaseRaw): GcpFirestoreDatabase {
  return {
    name: shortName(raw.name),
    type: raw.type ?? "",
    locationId: raw.locationId ?? "",
    concurrencyMode: raw.concurrencyMode ?? "",
    status: "ACTIVE",
  };
}

function mapIndex(raw: IndexRaw): GcpFirestoreIndex {
  return {
    name: shortName(raw.name),
    fields: raw.fields ?? [],
    state: raw.state ?? "",
  };
}

// =============================================================================
// GcpFirestoreManager
// =============================================================================

/**
 * Manages GCP Firestore resources.
 *
 * Provides methods for listing databases, collections, indexes, and
 * triggering import/export operations.
 */
export class GcpFirestoreManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all Firestore databases in the project. */
  async listDatabases(): Promise<GcpFirestoreDatabase[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${FS_BASE}/projects/${this.projectId}/databases`;
      const items = await gcpList<DatabaseRaw>(url, token, "databases");
      return items.map(mapDatabase);
    }, this.retryOptions);
  }

  /** Get a single Firestore database by name. */
  async getDatabase(name: string): Promise<GcpFirestoreDatabase> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${FS_BASE}/projects/${this.projectId}/databases/${encodeURIComponent(name)}`;
      const raw = await gcpRequest<DatabaseRaw>(url, token);
      return mapDatabase(raw);
    }, this.retryOptions);
  }

  /** List collections in a Firestore database. */
  async listCollections(database: string): Promise<GcpFirestoreCollection[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${FS_BASE}/projects/${this.projectId}/databases/${encodeURIComponent(database)}/documents:listCollectionIds`;
      const data = await gcpRequest<{ collectionIds?: string[] }>(url, token, { method: "POST", body: {} });
      const ids = data.collectionIds ?? [];
      return ids.map((id) => ({ name: id, documentCount: 0 }));
    }, this.retryOptions);
  }

  /** Export documents from a Firestore database to a Cloud Storage URI. */
  async exportDocuments(database: string, outputUri: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${FS_BASE}/projects/${this.projectId}/databases/${encodeURIComponent(database)}:exportDocuments`;
      return gcpMutate(url, token, { outputUriPrefix: outputUri });
    }, this.retryOptions);
  }

  /** Import documents into a Firestore database from a Cloud Storage URI. */
  async importDocuments(database: string, inputUri: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${FS_BASE}/projects/${this.projectId}/databases/${encodeURIComponent(database)}:importDocuments`;
      return gcpMutate(url, token, { inputUriPrefix: inputUri });
    }, this.retryOptions);
  }

  /** List composite indexes for a collection in a Firestore database. */
  async listIndexes(database: string, collection: string): Promise<GcpFirestoreIndex[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${FS_BASE}/projects/${this.projectId}/databases/${encodeURIComponent(database)}/collectionGroups/${encodeURIComponent(collection)}/indexes`;
      const items = await gcpList<IndexRaw>(url, token, "indexes");
      return items.map(mapIndex);
    }, this.retryOptions);
  }
}

/** Factory: create a GcpFirestoreManager instance. */
export function createFirestoreManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpFirestoreManager {
  return new GcpFirestoreManager(projectId, getAccessToken, retryOptions);
}
