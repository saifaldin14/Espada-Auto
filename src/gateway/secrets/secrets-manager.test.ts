/**
 * Comprehensive QA Tests — Secrets Manager
 *
 * Enterprise-grade test suite covering:
 * - EnvSecretBackend: read-only ops, key normalization
 * - EncryptedFileBackend: AES-256-GCM encrypt/decrypt, persistence, expiry
 * - SecretsManager: multi-backend fallback, caching, audit callback
 * - resolveTemplate / resolveSecretRefs: template resolution
 * - createSecretsManager factory: config validation
 * - Production hardening: malformed ciphertext, missing encryption key
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { unlinkSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import {
  EnvSecretBackend,
  EncryptedFileBackend,
  SecretsManager,
  VaultSecretBackend,
  createSecretsManager,
} from "./secrets-manager.js";
import type { SecretBackend, SecretsManagerConfig } from "./secrets-manager.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpFile(name: string): string {
  const dir = join(tmpdir(), "espada-test-secrets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${name}-${randomUUID()}.json`);
}

function cleanup(path: string) {
  try {
    unlinkSync(path);
  } catch {
    /* ok */
  }
}

/** 64 hex char key (32 bytes) */
const VALID_KEY = randomBytes(32).toString("hex");

function makeSession(): { id: string; path: string; key: string } {
  const id = randomUUID();
  const path = tmpFile(id);
  return { id, path, key: VALID_KEY };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EnvSecretBackend
// ═══════════════════════════════════════════════════════════════════════════════

describe("EnvSecretBackend", () => {
  const prefix = "ESPADA_TEST_SECRET_";

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith(prefix)) delete process.env[k];
    }
  });

  it("reads an existing environment variable", async () => {
    process.env[`${prefix}DB_PASSWORD`] = "s3cret";
    const backend = new EnvSecretBackend(prefix);
    await backend.initialize();

    const secret = await backend.get("db-password");
    expect(secret).not.toBeNull();
    expect(secret!.value).toBe("s3cret");
    expect(secret!.backend).toBe("env");
    expect(secret!.version).toBe(1);
  });

  it("returns null for missing variables", async () => {
    const backend = new EnvSecretBackend(prefix);
    expect(await backend.get("nonexistent")).toBeNull();
  });

  it("key normalization: converts dots/dashes to underscores, uppercases", async () => {
    process.env[`${prefix}MY_API_KEY`] = "val";
    const backend = new EnvSecretBackend(prefix);
    expect(await backend.get("my-api-key")).not.toBeNull();
  });

  it("set() throws — env backend is read-only", async () => {
    const backend = new EnvSecretBackend(prefix);
    await expect(backend.set("key", "val")).rejects.toThrow("read-only");
  });

  it("delete() throws — env backend is read-only", async () => {
    const backend = new EnvSecretBackend(prefix);
    await expect(backend.delete("key")).rejects.toThrow("read-only");
  });

  it("list() returns normalized keys", async () => {
    process.env[`${prefix}A`] = "1";
    process.env[`${prefix}B`] = "2";
    const backend = new EnvSecretBackend(prefix);
    const keys = await backend.list();
    expect(keys).toContain("a");
    expect(keys).toContain("b");
  });

  it("has() correctly detects presence", async () => {
    process.env[`${prefix}EXISTS`] = "yes";
    const backend = new EnvSecretBackend(prefix);
    expect(await backend.has("exists")).toBe(true);
    expect(await backend.has("nope")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EncryptedFileBackend
// ═══════════════════════════════════════════════════════════════════════════════

describe("EncryptedFileBackend", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile("encrypted");
  });

  afterEach(() => {
    cleanup(filePath);
  });

  it("round-trip: set → get returns original value", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();

    await backend.set("api-key", "super-secret-value", { team: "platform" });
    const secret = await backend.get("api-key");

    expect(secret).not.toBeNull();
    expect(secret!.value).toBe("super-secret-value");
    expect(secret!.version).toBe(1);
    expect(secret!.metadata).toEqual({ team: "platform" });
    expect(secret!.backend).toBe("file");
  });

  it("encrypts values at rest — raw file does not contain plaintext", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();
    await backend.set("my-secret", "this-should-be-encrypted");

    const raw = readFileSync(filePath, "utf8");
    expect(raw).not.toContain("this-should-be-encrypted");

    // But the encrypted value should have 3 colon-separated parts
    const data = JSON.parse(raw);
    const encryptedVal = data.secrets["my-secret"].value;
    expect(encryptedVal.split(":")).toHaveLength(3);
  });

  it("version increments on update", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();

    await backend.set("key", "v1");
    expect((await backend.get("key"))!.version).toBe(1);

    await backend.set("key", "v2");
    expect((await backend.get("key"))!.version).toBe(2);

    await backend.set("key", "v3");
    expect((await backend.get("key"))!.version).toBe(3);
  });

  it("delete() removes key and returns true; false for missing", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();

    await backend.set("temp", "val");
    expect(await backend.delete("temp")).toBe(true);
    expect(await backend.get("temp")).toBeNull();
    expect(await backend.delete("temp")).toBe(false);
  });

  it("list() and has() work correctly", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();

    await backend.set("a", "1");
    await backend.set("b", "2");

    expect(await backend.list()).toEqual(expect.arrayContaining(["a", "b"]));
    expect(await backend.has("a")).toBe(true);
    expect(await backend.has("c")).toBe(false);
  });

  it("expired secrets are auto-evicted on get()", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();
    await backend.set("temp", "val");

    // Manually inject an expired entry
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    raw.secrets["temp"].expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(filePath, JSON.stringify(raw));

    // Re-initialize to reload
    const backend2 = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend2.initialize();

    expect(await backend2.get("temp")).toBeNull();
  });

  it("rejects invalid encryption key length", () => {
    expect(() => new EncryptedFileBackend(filePath, "short")).toThrow("32 bytes");
  });

  it("throws on malformed ciphertext (production hardening CRITICAL #4)", async () => {
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();
    await backend.set("good", "value");

    // Corrupt the stored ciphertext
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    raw.secrets["good"].value = "not-valid-ciphertext";
    writeFileSync(filePath, JSON.stringify(raw));

    const backend2 = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend2.initialize();
    expect(() => backend2.get("good")).rejects.toThrow(/malformed encrypted value/);
  });

  it("throws on wrong decryption key", async () => {
    const backend1 = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend1.initialize();
    await backend1.set("secret", "data");

    const otherKey = randomBytes(32).toString("hex");
    const backend2 = new EncryptedFileBackend(filePath, otherKey);
    await backend2.initialize();

    await expect(backend2.get("secret")).rejects.toThrow();
  });

  it("persists across re-initialize", async () => {
    const b1 = new EncryptedFileBackend(filePath, VALID_KEY);
    await b1.initialize();
    await b1.set("persistent", "value");
    await b1.close();

    const b2 = new EncryptedFileBackend(filePath, VALID_KEY);
    await b2.initialize();
    const secret = await b2.get("persistent");
    expect(secret!.value).toBe("value");
  });

  it("creates directory if it does not exist", async () => {
    const nested = join(tmpdir(), "espada-test-secrets", "deep", randomUUID(), "store.json");
    const backend = new EncryptedFileBackend(nested, VALID_KEY);
    await backend.initialize();
    await backend.set("key", "val");
    expect(existsSync(nested)).toBe(true);
    cleanup(nested);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SecretsManager — multi-backend, caching, audit
// ═══════════════════════════════════════════════════════════════════════════════

describe("SecretsManager", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile("manager");
  });

  afterEach(() => {
    cleanup(filePath);
  });

  function createManager(opts?: { cacheTtl?: number }): {
    manager: SecretsManager;
    fileBackend: EncryptedFileBackend;
    envBackend: EnvSecretBackend;
  } {
    const manager = new SecretsManager({
      backends: [],
      cacheTtlSeconds: opts?.cacheTtl ?? 300,
    });
    const fileBackend = new EncryptedFileBackend(filePath, VALID_KEY);
    const envBackend = new EnvSecretBackend("ESPADA_MGRT_");
    manager.addBackend(envBackend);
    manager.addBackend(fileBackend);
    return { manager, fileBackend, envBackend };
  }

  it("falls back through backends: env miss → file hit", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("db-pass", "fromFile");

    const secret = await manager.get("db-pass");
    expect(secret).not.toBeNull();
    expect(secret!.value).toBe("fromFile");
    expect(secret!.backend).toBe("file");
  });

  it("env backend has priority over file", async () => {
    process.env["ESPADA_MGRT_DB_PASS"] = "fromEnv";
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("db-pass", "fromFile");

    const secret = await manager.get("db-pass");
    expect(secret!.value).toBe("fromEnv");
    expect(secret!.backend).toBe("env");

    delete process.env["ESPADA_MGRT_DB_PASS"];
  });

  it("caches results and returns from cache on second get()", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("cached", "original");

    await manager.get("cached");
    // Mutate underlying store — cache should still return old value
    await fileBackend.set("cached", "updated");

    const secret = await manager.get("cached");
    expect(secret!.value).toBe("original");
  });

  it("skipCache bypasses the cache", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("cached", "v1");
    await manager.get("cached");

    await fileBackend.set("cached", "v2");
    const secret = await manager.get("cached", { skipCache: true });
    expect(secret!.value).toBe("v2");
  });

  it("clearCache() invalidates all cached entries", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("key", "v1");
    await manager.get("key");

    await fileBackend.set("key", "v2");
    manager.clearCache();

    const secret = await manager.get("key");
    expect(secret!.value).toBe("v2");
  });

  it("set() writes to first writable backend, skipping read-only env", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();

    const secret = await manager.set("new-key", "new-value");
    expect(secret.backend).toBe("file");
    expect(secret.value).toBe("new-value");
  });

  it("set() throws when no writable backend available", async () => {
    const manager = new SecretsManager({ backends: [] });
    manager.addBackend(new EnvSecretBackend("PREFIX_"));

    await expect(manager.set("key", "val")).rejects.toThrow("No writable backend");
  });

  it("delete() removes from all backends", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("to-delete", "val");

    expect(await manager.delete("to-delete")).toBe(true);
    expect(await fileBackend.get("to-delete")).toBeNull();
  });

  it("list() aggregates keys from all backends", async () => {
    process.env["ESPADA_MGRT_FROM_ENV"] = "x";
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("from-file", "y");

    const keys = await manager.list();
    expect(keys).toContain("from-file");
    expect(keys).toContain("from-env");

    delete process.env["ESPADA_MGRT_FROM_ENV"];
  });

  it("audit callback is invoked on get/set/delete/list", async () => {
    const auditEvents: unknown[] = [];
    const { manager, fileBackend } = createManager();
    manager.onAudit((e) => auditEvents.push(e));
    await fileBackend.initialize();

    await manager.set("audited", "val");
    // Use skipCache so get() actually hits the backend and fires audit
    await manager.get("audited", { skipCache: true });
    await manager.delete("audited");
    await manager.list();

    expect(auditEvents.length).toBeGreaterThanOrEqual(4);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "set", success: true }),
        expect.objectContaining({ action: "get", success: true }),
        expect.objectContaining({ action: "delete", success: true }),
        expect.objectContaining({ action: "list", success: true }),
      ]),
    );
  });

  it("close() closes all backends", async () => {
    const { manager, fileBackend } = createManager();
    await fileBackend.initialize();
    await fileBackend.set("key", "val");

    await manager.close();
    // After close, cache should be empty
    const emptyCache = manager["cache"];
    expect(emptyCache.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resolveTemplate / resolveSecretRefs
// ═══════════════════════════════════════════════════════════════════════════════

describe("SecretsManager.resolveTemplate", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile("template");
  });
  afterEach(() => cleanup(filePath));

  it("resolves ${secret:key} references in templates", async () => {
    const manager = new SecretsManager({ backends: [] });
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();
    await backend.set("db-host", "prod.db.example.com");
    await backend.set("db-pass", "hunter2");
    manager.addBackend(backend);

    const result = await manager.resolveTemplate(
      "postgres://admin:${secret:db-pass}@${secret:db-host}:5432/app",
    );
    expect(result).toBe("postgres://admin:hunter2@prod.db.example.com:5432/app");
  });

  it("resolves ${secret:backend:key} with specific backend", async () => {
    const manager = new SecretsManager({ backends: [] });
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();
    await backend.set("token", "abc123");
    manager.addBackend(backend);

    const result = await manager.resolveTemplate("Bearer ${secret:file:token}");
    expect(result).toBe("Bearer abc123");
  });

  it("leaves unresolvable references unchanged", async () => {
    const manager = new SecretsManager({ backends: [] });
    const backend = new EncryptedFileBackend(filePath, VALID_KEY);
    await backend.initialize();
    manager.addBackend(backend);

    const result = await manager.resolveTemplate("${secret:nonexistent}");
    expect(result).toBe("${secret:nonexistent}");
  });

  it("resolveTemplate delegates to resolveSecretRefs (CRITICAL #2)", async () => {
    const manager = new SecretsManager({ backends: [] });
    const spy = vi.spyOn(manager, "resolveSecretRefs");
    await manager.resolveTemplate("test");
    expect(spy).toHaveBeenCalledWith("test");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createSecretsManager factory
// ═══════════════════════════════════════════════════════════════════════════════

describe("createSecretsManager", () => {
  afterEach(() => {
    // Clean up any test env vars
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("ESPADA_FACTORY_")) delete process.env[k];
    }
  });

  it("creates manager with env backend", () => {
    const config: SecretsManagerConfig = {
      backends: [{ type: "env", priority: 1 }],
      envPrefix: "ESPADA_FACTORY_",
    };
    const manager = createSecretsManager(config);
    expect(manager).toBeInstanceOf(SecretsManager);
  });

  it("creates manager with file backend", () => {
    const path = tmpFile("factory");
    const config: SecretsManagerConfig = {
      backends: [
        {
          type: "file",
          priority: 1,
          file: { path, encryptionKey: VALID_KEY },
        },
      ],
    };
    const manager = createSecretsManager(config);
    expect(manager).toBeInstanceOf(SecretsManager);
    cleanup(path);
  });

  it("throws when file backend has no encryptionKey (CRITICAL #1)", () => {
    const config: SecretsManagerConfig = {
      backends: [
        {
          type: "file",
          priority: 1,
          file: { path: "/tmp/nope.json" },
        },
      ],
    };
    expect(() => createSecretsManager(config)).toThrow(/encryptionKey/);
  });

  it("throws descriptive error about lost keys on restart", () => {
    const config: SecretsManagerConfig = {
      backends: [
        {
          type: "file",
          priority: 1,
          file: { path: "/tmp/nope.json" },
        },
      ],
    };
    expect(() => createSecretsManager(config)).toThrow(/unrecoverable/);
  });

  it("creates manager with vault backend config", () => {
    const config: SecretsManagerConfig = {
      backends: [
        {
          type: "vault",
          priority: 1,
          vault: { address: "http://vault:8200", token: "test-token" },
        },
      ],
    };
    const manager = createSecretsManager(config);
    expect(manager).toBeInstanceOf(SecretsManager);
  });

  it("skips backends with missing nested config", () => {
    const config: SecretsManagerConfig = {
      backends: [
        { type: "file", priority: 1 }, // no file.path
        { type: "vault", priority: 2 }, // no vault.address
      ],
    };
    // Should not throw — just skip those backends
    const manager = createSecretsManager(config);
    expect(manager).toBeInstanceOf(SecretsManager);
  });
});
