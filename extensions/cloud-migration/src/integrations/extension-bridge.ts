/**
 * Extension Bridge — Runtime Integration with Sibling Extensions
 *
 * Lazily imports sibling extensions (audit-trail, policy-engine,
 * cost-governance, knowledge-graph) via dynamic relative imports,
 * matching the same pattern used by aws-adapter.ts / azure-adapter.ts.
 *
 * Every bridge method degrades gracefully — if the sibling extension
 * is not installed or its files cannot be resolved, the bridge logs
 * a warning and returns a no-op result. This mirrors the
 * "optionalDependencies" contract in espada.plugin.json.
 *
 * aws / azure / gcp are already wired via provider adapters.
 */

// =============================================================================
// Logger interface (avoid hard dependency on EspadaPluginApi)
// =============================================================================

export interface BridgeLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const NOOP_LOGGER: BridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// =============================================================================
// Bridge State — Resolved extension instances (or null if unavailable)
// =============================================================================

export interface ResolvedExtensions {
  /** audit-trail AuditLogger instance (for emitting cross-extension audit events) */
  auditLogger: AuditLoggerLike | null;
  /** policy-engine PolicyEvaluationEngine + storage (for org-wide policy checks) */
  policyEngine: PolicyEngineLike | null;
  /** cost-governance BudgetManager (for budget threshold checks) */
  budgetManager: BudgetManagerLike | null;
  /** knowledge-graph GraphEngine + AdapterRegistry (for topology sync) */
  knowledgeGraph: KnowledgeGraphLike | null;
}

// =============================================================================
// Lightweight "Like" interfaces — structural contracts that avoid importing
// the real classes, so the bridge compiles even if sibling extensions are absent.
// =============================================================================

export interface AuditLoggerLike {
  log(input: {
    eventType: string;
    severity: string;
    actor: { id: string; name: string; roles: string[] };
    operation: string;
    resource?: { type: string; id: string; provider?: string };
    parameters?: Record<string, unknown>;
    result: string;
    correlationId?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }): unknown;
  start(): void;
  stop(): void;
}

export interface PolicyEngineLike {
  evaluateAll(
    policies: unknown[],
    input: unknown,
  ): {
    passed: boolean;
    violations: Array<{ ruleId: string; message: string; action: string }>;
  };
}

export interface PolicyStorageLike {
  list(filter?: { enabled?: boolean }): Promise<unknown[]>;
  initialize(): Promise<void>;
}

export interface BudgetManagerLike {
  getAllStatuses(): Array<{
    id: string;
    name: string;
    monthlyLimit: number;
    currentSpend: number;
    status: string;
    utilization: number;
  }>;
  findBudget(
    scope: string,
    scopeId: string,
  ): { id: string; monthlyLimit: number; currentSpend: number } | null;
}

export interface KnowledgeGraphLike {
  /** Upsert nodes into the knowledge graph (create-or-update). */
  upsertNodes(
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      properties: Record<string, unknown>;
      provider: string;
    }>,
  ): Promise<void>;
  /** Upsert edges into the knowledge graph (create-or-update). */
  upsertEdges(
    edges: Array<{
      source: string;
      target: string;
      type: string;
      properties: Record<string, unknown>;
    }>,
  ): Promise<void>;
  /** Delete a single node by ID. */
  deleteNode(id: string): Promise<void>;
}

// =============================================================================
// Extension Bridge — Singleton
// =============================================================================

let _resolved: ResolvedExtensions | null = null;
let _logger: BridgeLogger = NOOP_LOGGER;

/**
 * Lazily resolve all sibling extensions via dynamic imports.
 * Results are cached — safe to call repeatedly.
 */
export async function resolveExtensions(
  log?: BridgeLogger,
): Promise<ResolvedExtensions> {
  if (_resolved) return _resolved;
  _logger = log ?? NOOP_LOGGER;

  const [auditLogger, policyEngine, budgetManager, knowledgeGraph] =
    await Promise.all([
      resolveAuditTrail(),
      resolvePolicyEngine(),
      resolveCostGovernance(),
      resolveKnowledgeGraph(),
    ]);

  _resolved = { auditLogger, policyEngine, budgetManager, knowledgeGraph };
  return _resolved;
}

/**
 * Get the currently resolved extensions (null if not yet resolved).
 */
export function getResolvedExtensions(): ResolvedExtensions | null {
  return _resolved;
}

/**
 * Reset all resolved extensions (for testing / service restart).
 */
export function resetExtensionBridge(): void {
  _resolved = null;
}

// =============================================================================
// Individual Resolvers — each try/catches independently
// =============================================================================

async function resolveAuditTrail(): Promise<AuditLoggerLike | null> {
  try {
    const mod = await import("../../../audit-trail/index.js");
    const { AuditLogger, InMemoryAuditStorage } = mod;
    if (!AuditLogger || !InMemoryAuditStorage) {
      _logger.warn("[extension-bridge] audit-trail: exports not found");
      return null;
    }
    // Create an in-memory logger for cross-extension event emission.
    // In production the audit-trail plugin's own registered service
    // handles persistence — we just emit events into its logger.
    const storage = new InMemoryAuditStorage();
    await storage.initialize();
    const logger = new AuditLogger(storage);
    logger.start();
    _logger.info("[extension-bridge] audit-trail: resolved");
    return logger as unknown as AuditLoggerLike;
  } catch (err) {
    _logger.warn(
      `[extension-bridge] audit-trail: not available (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

async function resolvePolicyEngine(): Promise<PolicyEngineLike | null> {
  try {
    const engineMod = await import(
      "../../../policy-engine/src/engine.js"
    );
    const { PolicyEvaluationEngine } = engineMod;
    if (!PolicyEvaluationEngine) {
      _logger.warn("[extension-bridge] policy-engine: engine not found");
      return null;
    }
    const engine = new PolicyEvaluationEngine();
    _logger.info("[extension-bridge] policy-engine: resolved");
    return engine as unknown as PolicyEngineLike;
  } catch (err) {
    _logger.warn(
      `[extension-bridge] policy-engine: not available (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

async function resolveCostGovernance(): Promise<BudgetManagerLike | null> {
  try {
    const mod = await import(
      "../../../cost-governance/src/budgets.js"
    );
    const { BudgetManager } = mod;
    if (!BudgetManager) {
      _logger.warn("[extension-bridge] cost-governance: BudgetManager not found");
      return null;
    }
    // Use in-memory mode (null path) so we don't touch the user's real budget file.
    // The cost-governance plugin's own service handles real persistence.
    const manager = new BudgetManager(null);
    _logger.info("[extension-bridge] cost-governance: resolved");
    return manager as unknown as BudgetManagerLike;
  } catch (err) {
    _logger.warn(
      `[extension-bridge] cost-governance: not available (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

async function resolveKnowledgeGraph(): Promise<KnowledgeGraphLike | null> {
  try {
    const mod = await import("../../../knowledge-graph/index.js");
    const { InMemoryGraphStorage } = mod;
    if (!InMemoryGraphStorage) {
      _logger.warn("[extension-bridge] knowledge-graph: exports not found");
      return null;
    }
    const storage = new InMemoryGraphStorage();
    await storage.initialize();
    _logger.info("[extension-bridge] knowledge-graph: resolved");
    // Expose storage's upsert/delete directly — the GraphEngine delegates to
    // these same methods during sync, so callers get the same behaviour.
    // The KG's GraphNodeInput/GraphEdgeInput types require more fields than
    // our lightweight bridge types, so we cast through `any` at the boundary.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return {
      upsertNodes: (nodes: any) => storage.upsertNodes(nodes),
      upsertEdges: (edges: any) => storage.upsertEdges(edges),
      deleteNode: (id: string) => storage.deleteNode(id),
    } as KnowledgeGraphLike;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (err) {
    _logger.warn(
      `[extension-bridge] knowledge-graph: not available (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}
