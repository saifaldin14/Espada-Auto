/**
 * Policy Bridge — Policy Engine ↔ Knowledge Graph
 *
 * Bridges the policy-engine extension's rule evaluator with KG's graph
 * topology. Converts GraphNodes into PolicyEvaluationInput payloads
 * with graph context (neighbors, blast radius, dependency depth), enabling
 * topology-aware policy decisions.
 *
 * Use cases:
 *   - Pre-mutation policy checks ("Can this resource be deleted?")
 *   - Drift response policies ("Block drifted resources with blast radius > 20")
 *   - Cost governance policies ("Warn if change impacts > $1000/mo")
 *   - Access control policies ("Deny write to production VPCs")
 */

import type {
  GraphNode,
  NodeFilter,
} from "../types.js";

import type {
  IntegrationContext,
  PolicyGraphContext,
  PolicyEvaluationInput,
  AggregatedPolicyResult,
  PolicyDefinition,
} from "./types.js";
import { graphNodeToPolicyResource, buildGraphContext } from "./types.js";
import { withTimeout, CircuitBreaker } from "./resilience.js";

// =============================================================================
// Policy Bridge
// =============================================================================

export class PolicyBridge {
  private readonly breaker = new CircuitBreaker("policy", 5, 30_000);
  private cachedPolicies: PolicyDefinition[] | null = null;
  private policiesCachedAt = 0;
  private static readonly POLICY_CACHE_TTL_MS = 60_000; // 1 minute

  constructor(
    private readonly ctx: IntegrationContext,
  ) {}

  /**
   * Load enabled policies from the policy storage.
   * Caches for 60s to avoid repeated storage reads.
   */
  private async loadPolicies(): Promise<PolicyDefinition[]> {
    const now = Date.now();
    if (this.cachedPolicies && now - this.policiesCachedAt < PolicyBridge.POLICY_CACHE_TTL_MS) {
      return this.cachedPolicies;
    }

    if (!this.ctx.ext.policyStorage) {
      return [];
    }

    try {
      const policies = await withTimeout(
        this.ctx.ext.policyStorage.list({ enabled: true }),
        5_000,
        "policyStorage.list",
      );
      this.cachedPolicies = policies;
      this.policiesCachedAt = now;
      return policies;
    } catch (err) {
      this.ctx.logger.error(`Failed to load policies: ${err}`);
      return this.cachedPolicies ?? [];
    }
  }

  /**
   * Evaluate all active policies against a specific graph node.
   *
   * Automatically enriches the policy input with graph context:
   *   - Neighbors (1-hop)
   *   - Blast radius (node count at depth 3)
   *   - Dependency depth (max hops in blast radius)
   */
  async evaluateNode(
    nodeId: string,
    opts?: {
      actor?: { id: string; roles: string[]; groups: string[] };
      environment?: string;
      blastRadiusDepth?: number;
    },
  ): Promise<AggregatedPolicyResult | null> {
    if (!this.ctx.available.policyEngine || !this.ctx.ext.policyEngine) {
      this.ctx.logger.debug?.("Policy engine unavailable — skipping policy evaluation");
      return null;
    }

    const node = await this.ctx.storage.getNode(nodeId);
    if (!node) {
      this.ctx.logger.warn(`Policy evaluation: node ${nodeId} not found`);
      return null;
    }

    const input = await this.buildNodeInput(node, opts);
    const policies = await this.loadPolicies();
    const result = this.ctx.ext.policyEngine.evaluateAll(policies, input);

    // Emit audit event
    this.emitAudit("evaluateNode", nodeId, result);

    return result;
  }

  /**
   * Evaluate policies for a bulk set of nodes (e.g., all nodes returned by a filter).
   * Returns per-node results.
   */
  async evaluateNodes(
    filter: NodeFilter,
    opts?: {
      actor?: { id: string; roles: string[]; groups: string[] };
      environment?: string;
    },
  ): Promise<Map<string, AggregatedPolicyResult>> {
    if (!this.ctx.available.policyEngine || !this.ctx.ext.policyEngine) {
      return new Map();
    }

    const nodes = await this.ctx.storage.queryNodes(filter);
    const results = new Map<string, AggregatedPolicyResult>();

    for (const node of nodes) {
      try {
        const input = await this.buildNodeInput(node, opts);
        const policies = await this.loadPolicies();
        const result = this.ctx.ext.policyEngine.evaluateAll(policies, input);
        results.set(node.id, result);
      } catch (err) {
        this.ctx.logger.error(`Policy evaluation failed for ${node.id}: ${err}`);
      }
    }

    return results;
  }

  /**
   * Pre-mutation policy check. Evaluates policies _before_ a change is applied.
   * Returns whether the mutation should proceed.
   */
  async preMutationCheck(
    nodeId: string,
    operation: "create" | "update" | "delete",
    actor?: { id: string; roles: string[]; groups: string[] },
  ): Promise<{
    allowed: boolean;
    warnings: string[];
    denials: string[];
    approvalRequired: boolean;
  }> {
    if (!this.ctx.available.policyEngine || !this.ctx.ext.policyEngine) {
      return { allowed: true, warnings: [], denials: [], approvalRequired: false };
    }

    const node = await this.ctx.storage.getNode(nodeId);
    if (!node) {
      return { allowed: true, warnings: [], denials: [], approvalRequired: false };
    }

    const resource = graphNodeToPolicyResource(node);
    const input: PolicyEvaluationInput = {
      resource: {
        ...resource,
        metadata: {
          ...resource.metadata,
          requestedOperation: operation,
        },
      },
      actor,
      plan: {
        totalCreates: operation === "create" ? 1 : 0,
        totalUpdates: operation === "update" ? 1 : 0,
        totalDeletes: operation === "delete" ? 1 : 0,
      },
    };

    // Add graph context for delete operations (blast radius is critical)
    if (operation === "delete") {
      const blast = await this.ctx.engine.getBlastRadius(nodeId, 3);
      input.graph = buildGraphContext(
        [...blast.nodes.values()],
        blast.nodes.size,
        blast.hops.size,
      );
    }

    const result = await this.breaker.execute(async () => {
      const policies = await this.loadPolicies();
      return this.ctx.ext.policyEngine!.evaluateAll(policies, input);
    });

    this.emitAudit(`preMutationCheck:${operation}`, nodeId, result);

    return {
      allowed: result.allowed,
      warnings: result.warnings,
      denials: result.denials,
      approvalRequired: result.approvalRequired,
    };
  }

  /**
   * Evaluate drift response policies.
   * Used by the drift detection system to determine how to handle drifted resources.
   */
  async evaluateDrift(
    nodeId: string,
    driftedFields: string[],
  ): Promise<AggregatedPolicyResult | null> {
    if (!this.ctx.available.policyEngine || !this.ctx.ext.policyEngine) {
      return null;
    }

    const node = await this.ctx.storage.getNode(nodeId);
    if (!node) return null;

    const resource = graphNodeToPolicyResource(node);
    const input: PolicyEvaluationInput = {
      resource: {
        ...resource,
        metadata: {
          ...resource.metadata,
          drifted: true,
          driftedFields,
          driftFieldCount: driftedFields.length,
        },
      },
    };

    // Add graph context
    try {
      const blast = await this.ctx.engine.getBlastRadius(nodeId, 3);
      input.graph = buildGraphContext(
        [...blast.nodes.values()],
        blast.nodes.size,
        blast.hops.size,
      );
    } catch {
      // Node might not be in graph yet
    }

    const policies = await this.loadPolicies();
    return this.ctx.ext.policyEngine.evaluateAll(policies, input);
  }

  /**
   * Evaluate cost-related policies for a resource.
   */
  async evaluateCost(
    nodeId: string,
    currentCost: number,
    projectedCost: number,
    actor?: { id: string; roles: string[]; groups: string[] },
  ): Promise<AggregatedPolicyResult | null> {
    if (!this.ctx.available.policyEngine || !this.ctx.ext.policyEngine) {
      return null;
    }

    const node = await this.ctx.storage.getNode(nodeId);
    if (!node) return null;

    const resource = graphNodeToPolicyResource(node);
    const input: PolicyEvaluationInput = {
      resource,
      cost: {
        current: currentCost,
        projected: projectedCost,
        delta: projectedCost - currentCost,
        currency: "USD",
      },
      actor,
    };

    const policies = await this.loadPolicies();
    return this.ctx.ext.policyEngine.evaluateAll(policies, input);
  }

  /**
   * Get a summary of policy violations across all graph nodes.
   */
  async getViolationSummary(
    filter?: NodeFilter,
  ): Promise<{
    totalNodes: number;
    evaluatedNodes: number;
    nodesWithViolations: number;
    totalDenials: number;
    totalWarnings: number;
    approvalRequired: number;
    violations: Array<{
      nodeId: string;
      nodeName: string;
      denials: string[];
      warnings: string[];
    }>;
  }> {
    const results = await this.evaluateNodes(filter ?? {});
    const nodes = await this.ctx.storage.queryNodes(filter ?? {});

    let nodesWithViolations = 0;
    let totalDenials = 0;
    let totalWarnings = 0;
    let approvalRequired = 0;
    const violations: Array<{
      nodeId: string;
      nodeName: string;
      denials: string[];
      warnings: string[];
    }> = [];

    for (const [nodeId, result] of results.entries()) {
      if (result.denials.length > 0 || result.warnings.length > 0) {
        const node = nodes.find((n) => n.id === nodeId);
        nodesWithViolations++;
        totalDenials += result.denials.length;
        totalWarnings += result.warnings.length;
        if (result.approvalRequired) approvalRequired++;

        violations.push({
          nodeId,
          nodeName: node?.name ?? nodeId,
          denials: result.denials,
          warnings: result.warnings,
        });
      }
    }

    return {
      totalNodes: nodes.length,
      evaluatedNodes: results.size,
      nodesWithViolations,
      totalDenials,
      totalWarnings,
      approvalRequired,
      violations,
    };
  }

  // -- Private helpers --------------------------------------------------------

  /**
   * Build a full PolicyEvaluationInput for a node with graph context.
   */
  private async buildNodeInput(
    node: GraphNode,
    opts?: {
      actor?: { id: string; roles: string[]; groups: string[] };
      environment?: string;
      blastRadiusDepth?: number;
    },
  ): Promise<PolicyEvaluationInput> {
    const resource = graphNodeToPolicyResource(node);
    const depth = opts?.blastRadiusDepth ?? 3;

    // Build graph context with blast radius
    let graphContext: PolicyGraphContext | undefined;
    try {
      const blast = await this.ctx.engine.getBlastRadius(node.id, depth);
      graphContext = buildGraphContext(
        [...blast.nodes.values()],
        blast.nodes.size,
        blast.hops.size,
      );
    } catch {
      // No graph context available
    }

    // Include cost context if available
    const cost = node.costMonthly != null
      ? { current: node.costMonthly, projected: node.costMonthly, delta: 0, currency: "USD" }
      : undefined;

    return {
      resource,
      actor: opts?.actor,
      environment: opts?.environment,
      graph: graphContext,
      cost,
    };
  }

  private emitAudit(
    operation: string,
    nodeId: string,
    result: AggregatedPolicyResult,
  ): void {
    if (!this.ctx.ext.auditLogger) return;

    this.ctx.ext.auditLogger.log({
      eventType: "policy_evaluated",
      severity: result.denied ? "warn" : "info",
      actor: { id: "system", name: "policy-bridge", roles: [] },
      operation: `kg.policy.${operation}`,
      resource: { type: "graph-node", id: nodeId },
      result: result.denied ? "denied" : "success",
      metadata: {
        bridge: "policy",
        totalPolicies: result.totalPolicies,
        passedPolicies: result.passedPolicies,
        failedPolicies: result.failedPolicies,
        allowed: result.allowed,
        denied: result.denied,
        warnings: result.warnings.length,
        denials: result.denials.length,
        approvalRequired: result.approvalRequired,
      },
    });
  }
}

// =============================================================================
// Format Helper
// =============================================================================

export function formatPolicyBridgeMarkdown(
  summary: Awaited<ReturnType<PolicyBridge["getViolationSummary"]>>,
): string {
  const lines: string[] = [
    "# Policy Violation Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total Nodes | ${summary.totalNodes} |`,
    `| Evaluated | ${summary.evaluatedNodes} |`,
    `| With Violations | ${summary.nodesWithViolations} |`,
    `| Total Denials | ${summary.totalDenials} |`,
    `| Total Warnings | ${summary.totalWarnings} |`,
    `| Approval Required | ${summary.approvalRequired} |`,
    "",
  ];

  if (summary.violations.length > 0) {
    lines.push(
      "## Violations",
      "",
      "| Node | Denials | Warnings |",
      "|------|---------|----------|",
      ...summary.violations.map((v) =>
        `| ${v.nodeName} | ${v.denials.length > 0 ? v.denials.join("; ") : "-"} | ${v.warnings.length > 0 ? v.warnings.join("; ") : "-"} |`,
      ),
      "",
    );
  }

  return lines.join("\n");
}
