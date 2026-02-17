/**
 * GCP Extension — Cloud KMS Manager
 *
 * Manages Cloud KMS key rings, crypto keys, and key versions.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all key rings in a given location. */
  async listKeyRings(location: string): Promise<GcpKeyRing[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings`;
      return [] as GcpKeyRing[];
    }, this.retryOptions);
  }

  /** Get a single key ring by location and name. */
  async getKeyRing(location: string, name: string): Promise<GcpKeyRing> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${name}`;
      throw new Error(`Key ring ${name} not found in ${location} (placeholder)`);
    }, this.retryOptions);
  }

  /** List all crypto keys in a key ring. */
  async listCryptoKeys(location: string, keyRing: string): Promise<GcpCryptoKey[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys`;
      return [] as GcpCryptoKey[];
    }, this.retryOptions);
  }

  /** Get a single crypto key. */
  async getCryptoKey(location: string, keyRing: string, key: string): Promise<GcpCryptoKey> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${key}`;
      throw new Error(`Crypto key ${key} not found in ${keyRing} (placeholder)`);
    }, this.retryOptions);
  }

  /** List all versions of a crypto key. */
  async listCryptoKeyVersions(
    location: string,
    keyRing: string,
    key: string,
  ): Promise<GcpCryptoKeyVersion[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudkms.googleapis.com/v1/projects/${this.projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${key}/cryptoKeyVersions`;
      return [] as GcpCryptoKeyVersion[];
    }, this.retryOptions);
  }
}
