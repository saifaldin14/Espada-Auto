/**
 * GCP Extension — Cloud KMS Manager
 *
 * Manages Cloud KMS key rings, crypto keys, and key versions.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, shortName } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Cloud KMS key ring. */
export type GcpKeyRing = {
  name: string;
  createTime: string;
};

/** A Cloud KMS crypto key. */
export type GcpCryptoKey = {
  name: string;
  purpose: string;
  primaryVersion: string;
  createTime: string;
  rotationPeriod: string;
  labels: Record<string, string>;
};

/** A version of a Cloud KMS crypto key. */
export type GcpCryptoKeyVersion = {
  name: string;
  state: string;
  algorithm: string;
  createTime: string;
};

// =============================================================================
// GcpKMSManager
// =============================================================================

/**
 * Manages GCP Cloud KMS resources.
 *
 * Provides methods for listing and inspecting key rings, crypto keys,
 * and crypto key versions.
 */
export class GcpKMSManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all key rings in a given location. */
  async listKeyRings(location: string): Promise<GcpKeyRing[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "keyRings");
      return raw.map((r) => ({
        name: shortName((r.name as string) ?? ""),
        createTime: (r.createTime as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Get a single key ring by location and name. */
  async getKeyRing(location: string, name: string): Promise<GcpKeyRing> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${name}`;
      const r = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: shortName((r.name as string) ?? ""),
        createTime: (r.createTime as string) ?? "",
      };
    }, this.retryOptions);
  }

  /** List all crypto keys in a key ring. */
  async listCryptoKeys(location: string, keyRing: string): Promise<GcpCryptoKey[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "cryptoKeys");
      return raw.map((k) => {
        const primary = k.primary as Record<string, unknown> | undefined;
        return {
          name: shortName((k.name as string) ?? ""),
          purpose: (k.purpose as string) ?? "",
          primaryVersion: primary ? shortName((primary.name as string) ?? "") : "",
          createTime: (k.createTime as string) ?? "",
          rotationPeriod: (k.rotationPeriod as string) ?? "",
          labels: (k.labels as Record<string, string>) ?? {},
        };
      });
    }, this.retryOptions);
  }

  /** Get a single crypto key. */
  async getCryptoKey(location: string, keyRing: string, key: string): Promise<GcpCryptoKey> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${key}`;
      const k = await gcpRequest<Record<string, unknown>>(url, token);
      const primary = k.primary as Record<string, unknown> | undefined;
      return {
        name: shortName((k.name as string) ?? ""),
        purpose: (k.purpose as string) ?? "",
        primaryVersion: primary ? shortName((primary.name as string) ?? "") : "",
        createTime: (k.createTime as string) ?? "",
        rotationPeriod: (k.rotationPeriod as string) ?? "",
        labels: (k.labels as Record<string, string>) ?? {},
      };
    }, this.retryOptions);
  }

  /** List all versions of a crypto key. */
  async listCryptoKeyVersions(
    location: string,
    keyRing: string,
    key: string,
  ): Promise<GcpCryptoKeyVersion[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${key}/cryptoKeyVersions`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "cryptoKeyVersions");
      return raw.map((v) => ({
        name: shortName((v.name as string) ?? ""),
        state: (v.state as string) ?? "",
        algorithm: (v.algorithm as string) ?? "",
        createTime: (v.createTime as string) ?? "",
      }));
    }, this.retryOptions);
  }
}
