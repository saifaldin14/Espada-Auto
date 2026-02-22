/**
 * GCP Extension — Cloud Storage Manager
 *
 * Manages Cloud Storage buckets and objects.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

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
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List all Cloud Storage buckets in the project.
   */
  async listBuckets(): Promise<GcpBucket[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://storage.googleapis.com/storage/v1/b?project=${this.projectId}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "items");
      return items.map((b) => this.mapBucket(b));
    }, this.retryOptions);
  }

  /**
   * Get metadata for a specific Cloud Storage bucket.
   *
   * @param name - The bucket name.
   */
  async getBucket(name: string): Promise<GcpBucket> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapBucket(raw);
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
      const token = await this.getAccessToken();
      const url = `https://storage.googleapis.com/storage/v1/b?project=${this.projectId}`;
      const body = {
        name,
        location: opts.location,
        storageClass: opts.storageClass ?? "STANDARD",
      };
      return gcpMutate(url, token, body, "POST");
    }, this.retryOptions);
  }

  /**
   * Delete a Cloud Storage bucket.
   *
   * @param name - The bucket name. The bucket must be empty.
   */
  async deleteBucket(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${name}`;
      return gcpMutate(url, token, {}, "DELETE");
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
      const token = await this.getAccessToken();
      const params = new URLSearchParams();
      if (opts?.prefix) params.set("prefix", opts.prefix);
      const qs = params.toString();
      const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o${qs ? `?${qs}` : ""}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "items");
      return items.map((o) => this.mapObject(o));
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
      const token = await this.getAccessToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapObject(raw);
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
      const token = await this.getAccessToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`;
      return gcpMutate(url, token, {}, "DELETE");
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
    opts?: { expiration?: number; serviceAccountEmail?: string },
  ): Promise<string> {
    return withGcpRetry(async () => {
      const email = opts?.serviceAccountEmail;
      if (!email) {
        throw new Error(
          "serviceAccountEmail is required to generate a signed URL via IAM signBlob. " +
          "Pass it in opts or configure a default service account.",
        );
      }
      const token = await this.getAccessToken();
      const expiration = opts?.expiration ?? 3600;
      const expireTime = Math.floor(Date.now() / 1000) + expiration;

      // Build the string-to-sign for a V2 signed URL
      const stringToSign = `GET\n\n\n${expireTime}\n/${bucket}/${object}`;
      const encodedPayload = Buffer.from(stringToSign).toString("base64");

      // Use IAM signBlob to sign
      const signUrl = `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${email}:signBlob`;
      const signResponse = await gcpRequest<{ signedBytes: string }>(signUrl, token, {
        method: "POST",
        body: { bytesToSign: encodedPayload },
      });

      const signature = encodeURIComponent(signResponse.signedBytes);
      return `https://storage.googleapis.com/${bucket}/${encodeURIComponent(object)}?GoogleAccessId=${encodeURIComponent(email)}&Expires=${expireTime}&Signature=${signature}`;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapBucket(raw: Record<string, unknown>): GcpBucket {
    const versioning = raw.versioning as Record<string, unknown> | undefined;
    const lifecycle = raw.lifecycle as Record<string, unknown> | undefined;
    const rules = (lifecycle?.rule ?? []) as Array<Record<string, unknown>>;
    return {
      name: String(raw.name ?? ""),
      location: String(raw.location ?? ""),
      storageClass: String(raw.storageClass ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
      createdAt: String(raw.timeCreated ?? ""),
      versioning: Boolean(versioning?.enabled),
      lifecycle: rules.map((r) => {
        const action = (r.action ?? {}) as Record<string, unknown>;
        const condition = (r.condition ?? {}) as Record<string, unknown>;
        return {
          action: {
            type: String(action.type ?? ""),
            storageClass: action.storageClass ? String(action.storageClass) : undefined,
          },
          condition: {
            age: condition.age != null ? Number(condition.age) : undefined,
            matchesStorageClass: condition.matchesStorageClass as string[] | undefined,
            isLive: condition.isLive != null ? Boolean(condition.isLive) : undefined,
            numNewerVersions: condition.numNewerVersions != null ? Number(condition.numNewerVersions) : undefined,
          },
        };
      }),
    };
  }

  private mapObject(raw: Record<string, unknown>): GcpStorageObject {
    return {
      name: String(raw.name ?? ""),
      bucket: String(raw.bucket ?? ""),
      size: Number(raw.size ?? 0),
      contentType: String(raw.contentType ?? ""),
      createdAt: String(raw.timeCreated ?? ""),
      updatedAt: String(raw.updated ?? ""),
      metadata: (raw.metadata as Record<string, string>) ?? {},
    };
  }
}

/** Factory: create a GcpStorageManager instance. */
export function createStorageManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpStorageManager {
  return new GcpStorageManager(projectId, getAccessToken, retryOptions);
}
