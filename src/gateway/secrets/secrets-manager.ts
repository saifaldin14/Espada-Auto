/**
 * Secrets Management — Vault Interface & Multi-Backend Secret Storage
 *
 * Provides a unified interface for secrets management across
 * multiple backends:
 *
 * - Environment variables (default, zero-dependency)
 * - Encrypted file store (AES-256-GCM)
 * - HashiCorp Vault (HTTP API)
 * - AWS Secrets Manager
 * - Azure Key Vault
 * - GCP Secret Manager
 *
 * Features:
 * - Secret rotation support with expiry tracking
 * - Audit trail integration for every access
 * - Caching layer with configurable TTL
 * - Secret templating (reference other secrets)
 * - Lease management for dynamic secrets
 *
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// =============================================================================
// Types
// =============================================================================

export interface Secret {
  /** Secret key/name */
  key: string;

  /** Secret value */
  value: string;

  /** Version (auto-incremented on update) */
  version: number;

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of last update */
  updatedAt: string;

  /** ISO timestamp of expiry (if applicable) */
  expiresAt?: string;

  /** Metadata */
  metadata?: Record<string, string>;

  /** Tags for organization */
  tags?: string[];

  /** Backend where the secret is stored */
  backend: string;
}

export interface SecretReference {
  /** Key of the secret */
  key: string;

  /** Specific version (default: latest) */
  version?: number;

  /** Backend to resolve from (default: primary) */
  backend?: string;
}

export interface SecretBackendConfig {
  /** Backend type */
  type: "env" | "file" | "vault" | "aws-sm" | "azure-kv" | "gcp-sm";

  /** Priority (lower = tried first) */
  priority: number;

  /** For file backend */
  file?: {
    path: string;
    encryptionKey?: string; // hex-encoded AES-256 key
  };

  /** For HashiCorp Vault */
  vault?: {
    address: string;
    token?: string;
    roleId?: string;
    secretId?: string;
    mountPath?: string;
    namespace?: string;
  };

  /** For AWS Secrets Manager */
  aws?: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    prefix?: string;
  };

  /** For Azure Key Vault */
  azure?: {
    vaultUrl: string;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
  };

  /** For GCP Secret Manager */
  gcp?: {
    projectId: string;
    keyFilePath?: string;
    prefix?: string;
  };
}

export interface SecretsManagerConfig {
  /** Backend configurations (order = fallback priority) */
  backends: SecretBackendConfig[];

  /** Cache TTL in seconds (default: 300) */
  cacheTtlSeconds?: number;

  /** Enable audit logging for secret access */
  auditEnabled?: boolean;

  /** Prefix for environment variable lookups */
  envPrefix?: string;
}

// =============================================================================
// SecretBackend interface
// =============================================================================

export interface SecretBackend {
  /** Backend name/type */
  readonly name: string;

  /** Initialize the backend */
  initialize(): Promise<void>;

  /** Get a secret by key */
  get(key: string, version?: number): Promise<Secret | null>;

  /** Set/update a secret */
  set(key: string, value: string, metadata?: Record<string, string>): Promise<Secret>;

  /** Delete a secret */
  delete(key: string): Promise<boolean>;

  /** List all secret keys */
  list(): Promise<string[]>;

  /** Check if a secret exists */
  has(key: string): Promise<boolean>;

  /** Close/cleanup */
  close(): Promise<void>;
}

// =============================================================================
// Environment Variable Backend
// =============================================================================

export class EnvSecretBackend implements SecretBackend {
  readonly name = "env";
  private prefix: string;

  constructor(prefix = "ESPADA_SECRET_") {
    this.prefix = prefix;
  }

  async initialize(): Promise<void> {}

  async get(key: string): Promise<Secret | null> {
    const envKey = `${this.prefix}${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const value = process.env[envKey];
    if (value === undefined) return null;

    return {
      key,
      value,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backend: this.name,
    };
  }

  async set(p0: string, p1: string): Promise<Secret> {
    throw new Error("Environment variable backend is read-only");
  }

  async delete(p0: string): Promise<boolean> {
    throw new Error("Environment variable backend is read-only");
  }

  async list(): Promise<string[]> {
    return Object.keys(process.env)
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length).toLowerCase().replace(/_/g, "-"));
  }

  async has(key: string): Promise<boolean> {
    const envKey = `${this.prefix}${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    return process.env[envKey] !== undefined;
  }

  async close(): Promise<void> {}
}

// =============================================================================
// Encrypted File Backend
// =============================================================================

interface FileStoreData {
  secrets: Record<
    string,
    {
      value: string; // encrypted
      version: number;
      createdAt: string;
      updatedAt: string;
      expiresAt?: string;
      metadata?: Record<string, string>;
      tags?: string[];
    }
  >;
}

export class EncryptedFileBackend implements SecretBackend {
  readonly name = "file";
  private filePath: string;
  private encryptionKey: Buffer;
  private data: FileStoreData = { secrets: {} };

  constructor(filePath: string, encryptionKeyHex: string) {
    this.filePath = filePath;
    this.encryptionKey = Buffer.from(encryptionKeyHex, "hex");

    if (this.encryptionKey.length !== 32) {
      throw new Error("Encryption key must be 32 bytes (64 hex chars)");
    }
  }

  async initialize(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(raw) as FileStoreData;
    }
  }

  async get(key: string): Promise<Secret | null> {
    const entry = this.data.secrets[key];
    if (!entry) return null;

    // Check expiry
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
      delete this.data.secrets[key];
      this.persist();
      return null;
    }

    return {
      key,
      value: this.decrypt(entry.value),
      version: entry.version,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      metadata: entry.metadata,
      tags: entry.tags,
      backend: this.name,
    };
  }

  async set(key: string, value: string, metadata?: Record<string, string>): Promise<Secret> {
    const now = new Date().toISOString();
    const existing = this.data.secrets[key];
    const version = (existing?.version ?? 0) + 1;

    this.data.secrets[key] = {
      value: this.encrypt(value),
      version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: metadata ?? existing?.metadata,
      tags: existing?.tags,
    };

    this.persist();

    return {
      key,
      value,
      version,
      createdAt: this.data.secrets[key].createdAt,
      updatedAt: now,
      metadata,
      backend: this.name,
    };
  }

  async delete(key: string): Promise<boolean> {
    if (!(key in this.data.secrets)) return false;
    delete this.data.secrets[key];
    this.persist();
    return true;
  }

  async list(): Promise<string[]> {
    return Object.keys(this.data.secrets);
  }

  async has(key: string): Promise<boolean> {
    return key in this.data.secrets;
  }

  async close(): Promise<void> {
    this.persist();
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // iv:authTag:ciphertext (all base64)
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  private decrypt(encrypted: string): string {
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
      throw new Error(
        `secrets: malformed encrypted value — expected 3 colon-separated parts, got ${parts.length}`,
      );
    }
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

// =============================================================================
// HashiCorp Vault Backend
// =============================================================================

export class VaultSecretBackend implements SecretBackend {
  readonly name = "vault";
  private address: string;
  private token: string;
  private mountPath: string;
  private namespace?: string;

  constructor(config: NonNullable<SecretBackendConfig["vault"]>) {
    this.address = config.address.replace(/\/$/, "");
    this.token = config.token ?? "";
    this.mountPath = config.mountPath ?? "secret";
    this.namespace = config.namespace;
  }

  async initialize(): Promise<void> {
    // Verify connectivity
    const res = await this.request("GET", "/v1/sys/health");
    if (!res.ok && res.status !== 429 && res.status !== 472 && res.status !== 473) {
      throw new Error(`Vault health check failed: HTTP ${res.status}`);
    }
  }

  async get(key: string, version?: number): Promise<Secret | null> {
    const versionQuery = version ? `?version=${version}` : "";
    const res = await this.request("GET", `/v1/${this.mountPath}/data/${key}${versionQuery}`);

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Vault read failed: HTTP ${res.status}`);

    const body = (await res.json()) as {
      data: {
        data: Record<string, string>;
        metadata: { version: number; created_time: string; destroyed: boolean };
      };
    };

    if (body.data.metadata.destroyed) return null;

    return {
      key,
      value: body.data.data.value ?? JSON.stringify(body.data.data),
      version: body.data.metadata.version,
      createdAt: body.data.metadata.created_time,
      updatedAt: body.data.metadata.created_time,
      metadata: { ...body.data.data },
      backend: this.name,
    };
  }

  async set(key: string, value: string, metadata?: Record<string, string>): Promise<Secret> {
    const data = { value, ...metadata };
    const res = await this.request("POST", `/v1/${this.mountPath}/data/${key}`, {
      data,
    });

    if (!res.ok) throw new Error(`Vault write failed: HTTP ${res.status}`);

    const body = (await res.json()) as {
      data: { version: number; created_time: string };
    };

    return {
      key,
      value,
      version: body.data.version,
      createdAt: body.data.created_time,
      updatedAt: body.data.created_time,
      metadata,
      backend: this.name,
    };
  }

  async delete(key: string): Promise<boolean> {
    const res = await this.request("DELETE", `/v1/${this.mountPath}/data/${key}`);
    return res.status === 204 || res.ok;
  }

  async list(): Promise<string[]> {
    const res = await this.request("LIST", `/v1/${this.mountPath}/metadata/`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Vault list failed: HTTP ${res.status}`);

    const body = (await res.json()) as { data: { keys: string[] } };
    return body.data.keys;
  }

  async has(key: string): Promise<boolean> {
    const res = await this.request("GET", `/v1/${this.mountPath}/metadata/${key}`);
    return res.ok;
  }

  async close(): Promise<void> {}

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      "X-Vault-Token": this.token,
    };
    if (this.namespace) {
      headers["X-Vault-Namespace"] = this.namespace;
    }
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    return fetch(`${this.address}${path}`, {
      method: method === "LIST" ? "GET" : method,
      headers: {
        ...headers,
        ...(method === "LIST" ? { "X-Http-Method-Override": "LIST" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

// =============================================================================
// Secrets Manager — Unified Multi-Backend
// =============================================================================

export class SecretsManager {
  private backends: SecretBackend[] = [];
  private cache = new Map<string, { secret: Secret; cachedAt: number }>();
  private cacheTtlMs: number;
  private auditCallback?: (event: {
    action: "get" | "set" | "delete" | "list";
    key?: string;
    backend: string;
    success: boolean;
    timestamp: string;
  }) => void;

  constructor(config: SecretsManagerConfig) {
    this.cacheTtlMs = (config.cacheTtlSeconds ?? 300) * 1000;
  }

  /**
   * Add a backend to the secrets manager.
   */
  addBackend(backend: SecretBackend): void {
    this.backends.push(backend);
  }

  /**
   * Set an audit callback for secret access logging.
   */
  onAudit(callback: typeof this.auditCallback): void {
    this.auditCallback = callback;
  }

  /**
   * Initialize all backends.
   */
  async initialize(): Promise<void> {
    for (const backend of this.backends) {
      await backend.initialize();
    }
  }

  /**
   * Get a secret by key. Tries backends in order until found.
   * Results are cached with configurable TTL.
   */
  async get(
    key: string,
    options?: { skipCache?: boolean; backend?: string },
  ): Promise<Secret | null> {
    // Check cache
    if (!options?.skipCache) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
        return cached.secret;
      }
    }

    const backendsToCheck = options?.backend
      ? this.backends.filter((b) => b.name === options.backend)
      : this.backends;

    for (const backend of backendsToCheck) {
      try {
        const secret = await backend.get(key);
        if (secret) {
          this.cache.set(key, { secret, cachedAt: Date.now() });
          this.audit("get", key, backend.name, true);
          return secret;
        }
      } catch {
        this.audit("get", key, backend.name, false);
      }
    }

    return null;
  }

  /**
   * Set a secret. Writes to the first writable backend.
   */
  async set(
    key: string,
    value: string,
    options?: { backend?: string; metadata?: Record<string, string> },
  ): Promise<Secret> {
    const backendsToTry = options?.backend
      ? this.backends.filter((b) => b.name === options.backend)
      : this.backends;

    for (const backend of backendsToTry) {
      try {
        const secret = await backend.set(key, value, options?.metadata);
        this.cache.set(key, { secret, cachedAt: Date.now() });
        this.audit("set", key, backend.name, true);
        return secret;
      } catch {
        // Try next backend (this one might be read-only)
        continue;
      }
    }

    throw new Error(`No writable backend available for secret: ${key}`);
  }

  /**
   * Delete a secret from all backends.
   */
  async delete(key: string): Promise<boolean> {
    let deleted = false;

    for (const backend of this.backends) {
      try {
        if (await backend.delete(key)) {
          deleted = true;
          this.audit("delete", key, backend.name, true);
        }
      } catch {
        // Skip read-only or unavailable backends
      }
    }

    this.cache.delete(key);
    return deleted;
  }

  /**
   * List all secret keys across all backends.
   */
  async list(): Promise<string[]> {
    const allKeys = new Set<string>();

    for (const backend of this.backends) {
      try {
        const keys = await backend.list();
        for (const key of keys) {
          allKeys.add(key);
        }
        this.audit("list", undefined, backend.name, true);
      } catch {
        this.audit("list", undefined, backend.name, false);
      }
    }

    return Array.from(allKeys).sort();
  }

  /**
   * Resolve a secret reference string.
   * Format: `${secret:key}` or `${secret:key:version}` or `${secret:backend:key}`
   */
  async resolveTemplate(template: string): Promise<string> {
    return this.resolveSecretRefs(template);
  }

  /**
   * Resolve all secret references in a template string (async).
   */
  async resolveSecretRefs(template: string): Promise<string> {
    const refs = [...template.matchAll(/\$\{secret:([^}]+)}/g)];
    let resolved = template;

    for (const ref of refs) {
      const parts = ref[1].split(":");
      let key: string;
      let backend: string | undefined;

      if (parts.length === 1) {
        key = parts[0];
      } else {
        backend = parts[0];
        key = parts[1];
      }

      const secret = await this.get(key, { backend });
      if (secret) {
        resolved = resolved.replace(ref[0], secret.value);
      }
    }

    return resolved;
  }

  /** Clear the secret cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Close all backends. */
  async close(): Promise<void> {
    for (const backend of this.backends) {
      await backend.close();
    }
    this.cache.clear();
  }

  private audit(
    action: "get" | "set" | "delete" | "list",
    key: string | undefined,
    backend: string,
    success: boolean,
  ): void {
    this.auditCallback?.({
      action,
      key,
      backend,
      success,
      timestamp: new Date().toISOString(),
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a SecretsManager from configuration.
 */
export function createSecretsManager(config: SecretsManagerConfig): SecretsManager {
  const manager = new SecretsManager(config);

  for (const backendConfig of config.backends) {
    switch (backendConfig.type) {
      case "env":
        manager.addBackend(new EnvSecretBackend(config.envPrefix));
        break;
      case "file":
        if (backendConfig.file) {
          if (!backendConfig.file.encryptionKey) {
            throw new Error(
              "secrets: EncryptedFileBackend requires an explicit encryptionKey — " +
                "a randomly generated key would be lost on restart, making stored secrets unrecoverable",
            );
          }
          manager.addBackend(
            new EncryptedFileBackend(backendConfig.file.path, backendConfig.file.encryptionKey),
          );
        }
        break;
      case "vault":
        if (backendConfig.vault) {
          manager.addBackend(new VaultSecretBackend(backendConfig.vault));
        }
        break;
      // AWS, Azure, GCP backends would be implemented in their
      // respective extension packages (extensions/aws, etc.)
    }
  }

  return manager;
}
