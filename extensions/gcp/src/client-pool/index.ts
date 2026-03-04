/**
 * GCP Client Pool Manager
 *
 * Manages cached access tokens and connection pooling for
 * efficient multi-region, multi-service GCP API access.
 * Handles token refresh, circuit breaker integration, and
 * request rate limiting.
 */

// =============================================================================
// Types
// =============================================================================

export type TokenEntry = {
  token: string;
  expiresAt: number;
  scope: string;
};

export type PooledClient = {
  id: string;
  projectId: string;
  region: string;
  service: string;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
  errorCount: number;
  healthy: boolean;
};

export type PoolConfig = {
  maxTokenAge: number;
  tokenRefreshBuffer: number;
  maxClientsPerService: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;
  maxRequestsPerSecond: number;
};

export type PoolStats = {
  totalClients: number;
  activeClients: number;
  idleClients: number;
  unhealthyClients: number;
  cachedTokens: number;
  totalRequests: number;
  totalErrors: number;
  hitRate: number;
};

export type RateLimitState = {
  service: string;
  tokens: number;
  maxTokens: number;
  refillRate: number;
  lastRefill: number;
};

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_CONFIG: PoolConfig = {
  maxTokenAge: 3600_000,
  tokenRefreshBuffer: 300_000,
  maxClientsPerService: 10,
  idleTimeoutMs: 600_000,
  healthCheckIntervalMs: 60_000,
  maxRequestsPerSecond: 100,
};

// =============================================================================
// Manager
// =============================================================================

export class GcpClientPoolManager {
  private config: PoolConfig;
  private tokens: Map<string, TokenEntry> = new Map();
  private clients: Map<string, PooledClient> = new Map();
  private rateLimiters: Map<string, RateLimitState> = new Map();
  private totalRequests = 0;
  private totalErrors = 0;
  private tokenHits = 0;
  private tokenMisses = 0;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<PoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Auto-start cleanup so expired tokens and idle clients are reaped
    this.startCleanup();
  }

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  async getToken(
    scope: string,
    fetchToken: () => Promise<{ token: string; expiresInSeconds: number }>,
  ): Promise<string> {
    const existing = this.tokens.get(scope);
    const now = Date.now();

    if (existing && existing.expiresAt - this.config.tokenRefreshBuffer > now) {
      this.tokenHits++;
      return existing.token;
    }

    this.tokenMisses++;
    const fresh = await fetchToken();
    const entry: TokenEntry = {
      token: fresh.token,
      expiresAt: now + fresh.expiresInSeconds * 1000,
      scope,
    };
    this.tokens.set(scope, entry);
    return entry.token;
  }

  invalidateToken(scope: string): boolean {
    return this.tokens.delete(scope);
  }

  invalidateAllTokens(): void {
    this.tokens.clear();
  }

  // ---------------------------------------------------------------------------
  // Client pool
  // ---------------------------------------------------------------------------

  acquireClient(projectId: string, region: string, service: string): PooledClient {
    const key = `${projectId}:${region}:${service}`;
    const existing = this.clients.get(key);

    if (existing && existing.healthy) {
      existing.lastUsedAt = Date.now();
      existing.requestCount++;
      this.totalRequests++;
      return existing;
    }

    const serviceClientsCount = Array.from(this.clients.values()).filter(
      (c) => c.service === service && c.projectId === projectId,
    ).length;

    if (serviceClientsCount >= this.config.maxClientsPerService) {
      this.evictIdleClients(service, projectId);
    }

    const client: PooledClient = {
      id: key,
      projectId,
      region,
      service,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 1,
      errorCount: 0,
      healthy: true,
    };
    this.clients.set(key, client);
    this.totalRequests++;
    return client;
  }

  releaseClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastUsedAt = Date.now();
    }
  }

  reportError(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.errorCount++;
      this.totalErrors++;
      if (client.errorCount > 5) {
        client.healthy = false;
      }
    }
  }

  resetClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.errorCount = 0;
      client.healthy = true;
    }
  }

  removeClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  // ---------------------------------------------------------------------------
  // Rate limiting (token bucket)
  // ---------------------------------------------------------------------------

  checkRateLimit(service: string): boolean {
    const now = Date.now();
    let limiter = this.rateLimiters.get(service);

    if (!limiter) {
      limiter = {
        service,
        tokens: this.config.maxRequestsPerSecond,
        maxTokens: this.config.maxRequestsPerSecond,
        refillRate: this.config.maxRequestsPerSecond,
        lastRefill: now,
      };
      this.rateLimiters.set(service, limiter);
    }

    const elapsed = (now - limiter.lastRefill) / 1000;
    limiter.tokens = Math.min(
      limiter.maxTokens,
      limiter.tokens + elapsed * limiter.refillRate,
    );
    limiter.lastRefill = now;

    if (limiter.tokens >= 1) {
      limiter.tokens--;
      return true;
    }
    return false;
  }

  setRateLimit(service: string, maxPerSecond: number): void {
    const existing = this.rateLimiters.get(service);
    if (existing) {
      existing.maxTokens = maxPerSecond;
      existing.refillRate = maxPerSecond;
    } else {
      this.rateLimiters.set(service, {
        service,
        tokens: maxPerSecond,
        maxTokens: maxPerSecond,
        refillRate: maxPerSecond,
        lastRefill: Date.now(),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Stats & health
  // ---------------------------------------------------------------------------

  getStats(): PoolStats {
    const now = Date.now();
    const allClients = Array.from(this.clients.values());
    const active = allClients.filter(
      (c) => now - c.lastUsedAt < this.config.idleTimeoutMs && c.healthy,
    );
    const idle = allClients.filter(
      (c) => now - c.lastUsedAt >= this.config.idleTimeoutMs,
    );
    const unhealthy = allClients.filter((c) => !c.healthy);
    const totalTokenLookups = this.tokenHits + this.tokenMisses;

    return {
      totalClients: allClients.length,
      activeClients: active.length,
      idleClients: idle.length,
      unhealthyClients: unhealthy.length,
      cachedTokens: this.tokens.size,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      hitRate: totalTokenLookups > 0 ? this.tokenHits / totalTokenLookups : 0,
    };
  }

  getClient(clientId: string): PooledClient | undefined {
    return this.clients.get(clientId);
  }

  listClients(service?: string): PooledClient[] {
    const all = Array.from(this.clients.values());
    return service ? all.filter((c) => c.service === service) : all;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.healthCheckIntervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  cleanup(): void {
    const now = Date.now();

    for (const [scope, entry] of this.tokens) {
      if (entry.expiresAt <= now) {
        this.tokens.delete(scope);
      }
    }

    for (const [key, client] of this.clients) {
      if (now - client.lastUsedAt > this.config.idleTimeoutMs) {
        this.clients.delete(key);
      }
    }
  }

  destroy(): void {
    this.stopCleanup();
    this.tokens.clear();
    this.clients.clear();
    this.rateLimiters.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private evictIdleClients(service: string, projectId: string): void {
    const now = Date.now();
    const candidates = Array.from(this.clients.entries())
      .filter(([, c]) => c.service === service && c.projectId === projectId)
      .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt);

    for (const [key, client] of candidates) {
      if (now - client.lastUsedAt > this.config.idleTimeoutMs || !client.healthy) {
        this.clients.delete(key);
        break;
      }
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createClientPoolManager(
  config?: Partial<PoolConfig>,
): GcpClientPoolManager {
  return new GcpClientPoolManager(config);
}
