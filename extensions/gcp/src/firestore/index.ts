/**
 * GCP Extension — Firestore Manager
 *
 * Manages Firestore databases, collections, indexes, and import/export ops.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all Firestore databases in the project. */
  async listDatabases(): Promise<GcpFirestoreDatabase[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call firestore.projects.databases.list
      const _endpoint = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases`;

      return [] as GcpFirestoreDatabase[];
    }, this.retryOptions);
  }

  /** Get a single Firestore database by name. */
  async getDatabase(name: string): Promise<GcpFirestoreDatabase> {
    return withGcpRetry(async () => {
      // Placeholder: would call firestore.projects.databases.get
      const _endpoint = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${name}`;

      throw new Error(`Firestore database ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List collections in a Firestore database. */
  async listCollections(database: string): Promise<GcpFirestoreCollection[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call firestore listCollectionIds
      const _endpoint = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${database}/documents:listCollectionIds`;

      return [] as GcpFirestoreCollection[];
    }, this.retryOptions);
  }

  /** Export documents from a Firestore database to a Cloud Storage URI. */
  async exportDocuments(database: string, outputUri: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call firestore.projects.databases.exportDocuments
      const _endpoint = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${database}:exportDocuments`;
      void outputUri;

      return {
        success: true,
        message: `Export initiated for database ${database} to ${outputUri}`,
        operationId: `op-export-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /** Import documents into a Firestore database from a Cloud Storage URI. */
  async importDocuments(database: string, inputUri: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call firestore.projects.databases.importDocuments
      const _endpoint = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${database}:importDocuments`;
      void inputUri;

      return {
        success: true,
        message: `Import initiated for database ${database} from ${inputUri}`,
        operationId: `op-import-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /** List composite indexes for a collection in a Firestore database. */
  async listIndexes(database: string, collection: string): Promise<GcpFirestoreIndex[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call firestore.projects.databases.collectionGroups.indexes.list
      const _endpoint = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${database}/collectionGroups/${collection}/indexes`;

      return [] as GcpFirestoreIndex[];
    }, this.retryOptions);
  }
}

/** Factory: create a GcpFirestoreManager instance. */
export function createFirestoreManager(projectId: string, retryOptions?: GcpRetryOptions): GcpFirestoreManager {
  return new GcpFirestoreManager(projectId, retryOptions);
}
