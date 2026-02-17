/**
 * GCP Extension — Cloud Storage Manager
 *
 * Manages Cloud Storage buckets and objects.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** Lifecycle rule condition for a Cloud Storage bucket. */
export type GcpBucketLifecycleRule = {
  action: { type: string; storageClass?: string };
  condition: {
    age?: number;
    matchesStorageClass?: string[];
    isLive?: boolean;
    numNewerVersions?: number;
  };
};

/** A Cloud Storage bucket. */
export type GcpBucket = {
  name: string;
  location: string;
  storageClass: string;
  labels: Record<string, string>;
  createdAt: string;
  versioning: boolean;
  lifecycle: GcpBucketLifecycleRule[];
};

/** An object stored in Cloud Storage. */
export type GcpStorageObject = {
  name: string;
  bucket: string;
  size: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string>;
};

// =============================================================================
// GcpStorageManager
// =============================================================================

/**
 * Manages GCP Cloud Storage buckets and objects.
 *
 * Provides methods for listing, creating, and deleting buckets,
 * listing and managing objects, and generating signed URLs.
 */
export class GcpStorageManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List all Cloud Storage buckets in the project.
   */
  async listBuckets(): Promise<GcpBucket[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.buckets.list
      const _endpoint = `https://storage.googleapis.com/storage/v1/b?project=${this.projectId}`;

      return [] as GcpBucket[];
    }, this.retryOptions);
  }

  /**
   * Get metadata for a specific Cloud Storage bucket.
   *
   * @param name - The bucket name.
   */
  async getBucket(name: string): Promise<GcpBucket> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.buckets.get
      const _endpoint = `https://storage.googleapis.com/storage/v1/b/${name}`;

      throw new Error(`Bucket ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /**
   * Create a new Cloud Storage bucket.
   *
   * @param name - The bucket name (must be globally unique).
   * @param opts - Bucket creation options: location and optional storage class.
   */
  async createBucket(
    name: string,
    opts: { location: string; storageClass?: string },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.buckets.insert
      const _endpoint = `https://storage.googleapis.com/storage/v1/b?project=${this.projectId}`;
      const _body = {
        name,
        location: opts.location,
        storageClass: opts.storageClass ?? "STANDARD",
      };

      return {
        success: true,
        message: `Bucket ${name} created in ${opts.location}`,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a Cloud Storage bucket.
   *
   * @param name - The bucket name. The bucket must be empty.
   */
  async deleteBucket(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.buckets.delete
      const _endpoint = `https://storage.googleapis.com/storage/v1/b/${name}`;

      return {
        success: true,
        message: `Bucket ${name} deleted`,
      };
    }, this.retryOptions);
  }

  /**
   * List objects in a Cloud Storage bucket.
   *
   * @param bucket - The bucket name.
   * @param opts   - Optional filter with `prefix` for path-based listing.
   */
  async listObjects(bucket: string, opts?: { prefix?: string }): Promise<GcpStorageObject[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.objects.list
      const params = new URLSearchParams();
      if (opts?.prefix) params.set("prefix", opts.prefix);
      const _endpoint = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?${params}`;

      return [] as GcpStorageObject[];
    }, this.retryOptions);
  }

  /**
   * Get metadata for a specific object in a bucket.
   *
   * @param bucket - The bucket name.
   * @param object - The object name (path within the bucket).
   */
  async getObjectMetadata(bucket: string, object: string): Promise<GcpStorageObject> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.objects.get
      const _endpoint = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`;

      throw new Error(`Object ${object} not found in bucket ${bucket} (placeholder)`);
    }, this.retryOptions);
  }

  /**
   * Delete an object from a Cloud Storage bucket.
   *
   * @param bucket - The bucket name.
   * @param object - The object name.
   */
  async deleteObject(bucket: string, object: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call storage.objects.delete
      const _endpoint = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`;

      return {
        success: true,
        message: `Object ${object} deleted from bucket ${bucket}`,
      };
    }, this.retryOptions);
  }

  /**
   * Generate a signed URL for temporary access to an object.
   *
   * @param bucket - The bucket name.
   * @param object - The object name.
   * @param opts   - Options; `expiration` is seconds from now (default 3600).
   */
  async generateSignedUrl(
    bucket: string,
    object: string,
    opts?: { expiration?: number },
  ): Promise<string> {
    return withGcpRetry(async () => {
      // Placeholder: would use IAM signBlob or service account key to sign
      const expiration = opts?.expiration ?? 3600;
      const expiresAt = Math.floor(Date.now() / 1000) + expiration;

      // Placeholder signed URL
      return `https://storage.googleapis.com/${bucket}/${encodeURIComponent(object)}?X-Goog-Expires=${expiration}&X-Goog-Date=${new Date().toISOString()}&X-Goog-Expiration=${expiresAt}&X-Goog-Signature=placeholder`;
    }, this.retryOptions);
  }
}

/** Factory: create a GcpStorageManager instance. */
export function createStorageManager(projectId: string, retryOptions?: GcpRetryOptions): GcpStorageManager {
  return new GcpStorageManager(projectId, retryOptions);
}
