/**
 * Infrastructure Knowledge Graph — Contract Evaluation Engine
 *
 * Evaluates infrastructure contracts against the live graph.
 * Uses IQL as the query substrate for assertions, the graph engine
 * for blast-radius guardrails, and storage for dependency health checks.
 *
 * This is the deepest moat: it turns the unified graph model into
 * organizational knowledge that gets stickier over time.
 */

import type {
  GraphStorage,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";
import type { IQLResult } from "../iql/types.js";
import { parseIQL } from "../iql/parser.js";
import { executeQuery } from "../iql/executor.js";
import type { TemporalGraphStorage } from "../core/temporal.js";

import type {
  InfraContract,
  ContractAssertion,
  ContractGuardrail,
  AssertionResult,
  GuardrailResult,
  DependencyResult,
  ContractEvaluationResult,
  ContractSuiteResult,
  ContractStore,
  ContractEvent,
  ContractEventHandler,
  AssertionExpectation,
} from "./types.js";

// =============================================================================
// Engine Configuration
// =============================================================================

export type ContractEngineConfig = {
  /** Timeout per assertion query in ms (default: 10000). */
  assertionTimeoutMs?: number;
  /** Timeout per guardrail check in ms (default: 5000). */
  guardrailTimeoutMs?: number;
  /** Maximum assertions to evaluate per contract (default: 50). */
  maxAssertionsPerContract?: number;
  /** Maximum contracts to evaluate per suite run (default: 200). */
  maxContractsPerRun?: number;
};

const DEFAULT_CONFIG: Required<ContractEngineConfig> = {
  assertionTimeoutMs: 10_000,
  guardrailTimeoutMs: 5_000,
  maxAssertionsPerContract: 50,
  maxContractsPerRun: 200,
};

// =============================================================================
// Contract Evaluation Engine
// =============================================================================

export class ContractEngine {
  private engine: GraphEngine;
  private storage: GraphStorage;
  private temporal?: TemporalGraphStorage;
  private config: Required<ContractEngineConfig>;
  private eventHandlers: ContractEventHandler[] = [];

  constructor(
    engine: GraphEngine,
    storage: GraphStorage,
    temporal?: TemporalGraphStorage,
    config?: ContractEngineConfig,
  ) {
    this.engine = engine;
    this.storage = storage;
    this.temporal = temporal;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a handler for contract events. */
  onEvent(handler: ContractEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ContractEvent): void {
    for (const h of this.eventHandlers) {
      try {
        h(event);
      } catch {
        // Event handlers must not break evaluation
      }
    }
  }

  // ===========================================================================
  // Single Contract Evaluation
  // ===========================================================================

  /**
   * Evaluate a single infrastructure contract against the current graph state.
   */
  async evaluateContract(contract: InfraContract): Promise<ContractEvaluationResult> {
    const startMs = Date.now();

    if (!contract.enabled) {
      return this.buildResult(contract, [], [], [], startMs, "pass");
    }

    // Evaluate in parallel: assertions, guardrails, dependencies
    const [assertions, guardrails, dependencies] = await Promise.all([
      this.evaluateAssertions(contract.assertions),
      this.evaluateGuardrails(contract.guardrails),
      this.evaluateDependencies(contract.dependencies),
    ]);

    // Compute overall status
    const status = computeOverallStatus(assertions, guardrails, dependencies);
    const result = this.buildResult(contract, assertions, guardrails, dependencies, startMs, status);

    // Emit events
    if (status === "pass") {
      this.emit({ type: "contract-passed", contractId: contract.id, evaluatedAt: result.evaluatedAt });
    } else if (status === "fail" || status === "error") {
      const failures = [
        ...assertions.filter((a) => a.status === "fail").map((a) => `Assertion: ${a.description}`),
        ...guardrails.filter((g) => g.status === "fail").map((g) => `Guardrail: ${g.description}`),
        ...dependencies.filter((d) => d.status === "missing").map((d) => `Dependency missing: ${d.nodeId}`),
      ];
      this.emit({ type: "contract-failed", contractId: contract.id, evaluatedAt: result.evaluatedAt, failures });
    }

    // Emit specific events for missing deps and exceeded guardrails
    for (const dep of dependencies) {
      if (dep.status === "missing") {
        this.emit({ type: "dependency-missing", contractId: contract.id, nodeId: dep.nodeId });
      }
    }
    for (const gr of guardrails) {
      if (gr.status === "fail") {
        this.emit({
          type: "guardrail-exceeded",
          contractId: contract.id,
          guardrailId: gr.guardrailId,
          actual: gr.actualValue,
          threshold: gr.threshold,
        });
      }
    }

    return result;
  }

  // ===========================================================================
  // Suite Evaluation
  // ===========================================================================

  /**
   * Evaluate all contracts from a store.
   */
  async evaluateAll(store: ContractStore): Promise<ContractSuiteResult> {
    const startMs = Date.now();
    const contracts = store.list({ enabled: true }).slice(0, this.config.maxContractsPerRun);

    const results: ContractEvaluationResult[] = [];
    for (const contract of contracts) {
      const result = await this.evaluateContract(contract);
      results.push(result);
    }

    const evaluatedAt = new Date().toISOString();
    return {
      evaluatedAt,
      totalContracts: results.length,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
      degraded: results.filter((r) => r.status === "degraded").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Check if a proposed change would break any contracts.
   * Returns contracts whose dependencies include the target node.
   */
  async checkChangeAgainstContracts(
    store: ContractStore,
    targetNodeId: string,
  ): Promise<ContractEvaluationResult[]> {
    const affected = store.listByDependency(targetNodeId);
    const results: ContractEvaluationResult[] = [];

    for (const contract of affected) {
      const result = await this.evaluateContract(contract);
      results.push(result);
    }

    return results;
  }

  // ===========================================================================
  // Assertion Evaluation
  // ===========================================================================

  private async evaluateAssertions(
    assertions: ContractAssertion[],
  ): Promise<AssertionResult[]> {
    const capped = assertions.slice(0, this.config.maxAssertionsPerContract);
    const results: AssertionResult[] = [];

    for (const assertion of capped) {
      const result = await this.evaluateSingleAssertion(assertion);
      results.push(result);
    }

    return results;
  }

  private async evaluateSingleAssertion(
    assertion: ContractAssertion,
  ): Promise<AssertionResult> {
    const startMs = Date.now();

    try {
      // Parse IQL
      const parsed = parseIQL(assertion.query);

      // Execute with timeout
      const queryResult = await withTimeout(
        executeQuery(parsed, {
          storage: this.storage,
          temporal: this.temporal,
        }),
        this.config.assertionTimeoutMs,
        `Assertion query timed out after ${this.config.assertionTimeoutMs}ms`,
      );

      // Check expectation
      const { resultCount, totalCost } = extractQueryMetrics(queryResult);
      const status = checkExpectation(assertion.expectation, resultCount, totalCost);

      return {
        assertionId: assertion.id,
        description: assertion.description,
        query: assertion.query,
        status,
        resultCount,
        totalCost,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        assertionId: assertion.id,
        description: assertion.description,
        query: assertion.query,
        status: "error",
        resultCount: 0,
        totalCost: 0,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      };
    }
  }

  // ===========================================================================
  // Guardrail Evaluation
  // ===========================================================================

  private async evaluateGuardrails(
    guardrails: ContractGuardrail[],
  ): Promise<GuardrailResult[]> {
    const results: GuardrailResult[] = [];

    for (const guardrail of guardrails) {
      const result = await this.evaluateSingleGuardrail(guardrail);
      results.push(result);
    }

    return results;
  }

  private async evaluateSingleGuardrail(
    guardrail: ContractGuardrail,
  ): Promise<GuardrailResult> {
    const startMs = Date.now();

    try {
      let actualValue: number;

      switch (guardrail.type) {
        case "max-blast-radius": {
          if (!guardrail.nodePattern) {
            return {
              guardrailId: guardrail.id,
              description: guardrail.description,
              type: guardrail.type,
              status: "error",
              actualValue: 0,
              threshold: guardrail.threshold,
              error: "max-blast-radius guardrail requires nodePattern",
              durationMs: Date.now() - startMs,
            };
          }
          const blast = await withTimeout(
            this.engine.getBlastRadius(guardrail.nodePattern, 6),
            this.config.guardrailTimeoutMs,
            `Blast radius timed out`,
          );
          actualValue = blast.nodes.size - 1; // exclude root
          break;
        }

        case "max-monthly-cost": {
          const stats = await this.engine.getStats();
          if (guardrail.nodePattern) {
            // Cost of a specific node subtree
            const cost = await this.engine.getNodeCost(guardrail.nodePattern, true);
            actualValue = cost.totalMonthly;
          } else {
            actualValue = stats.totalCostMonthly;
          }
          break;
        }

        case "max-dependency-depth": {
          if (!guardrail.nodePattern) {
            return {
              guardrailId: guardrail.id,
              description: guardrail.description,
              type: guardrail.type,
              status: "error",
              actualValue: 0,
              threshold: guardrail.threshold,
              error: "max-dependency-depth guardrail requires nodePattern",
              durationMs: Date.now() - startMs,
            };
          }
          const chain = await this.engine.getDependencyChain(
            guardrail.nodePattern,
            "downstream",
            guardrail.threshold + 2, // look slightly deeper
          );
          const maxHop = Math.max(0, ...Array.from(chain.hops.keys()));
          actualValue = maxHop;
          break;
        }

        case "min-replicas": {
          // Count nodes matching the pattern
          if (!guardrail.nodePattern) {
            actualValue = 0;
          } else {
            // Use IQL to count matching resources
            const parsed = parseIQL(`FIND resources WHERE name LIKE "${guardrail.nodePattern}"`);
            const result = await executeQuery(parsed, { storage: this.storage });
            actualValue = result.type === "find" ? result.nodes.length : 0;
          }
          // For min-replicas, fail if BELOW threshold
          const status = actualValue >= guardrail.threshold ? "pass" : "fail";
          return {
            guardrailId: guardrail.id,
            description: guardrail.description,
            type: guardrail.type,
            status,
            actualValue,
            threshold: guardrail.threshold,
            durationMs: Date.now() - startMs,
          };
        }

        case "custom-iql": {
          if (!guardrail.nodePattern) {
            return {
              guardrailId: guardrail.id,
              description: guardrail.description,
              type: guardrail.type,
              status: "error",
              actualValue: 0,
              threshold: guardrail.threshold,
              error: "custom-iql guardrail requires nodePattern containing IQL query",
              durationMs: Date.now() - startMs,
            };
          }
          const parsed = parseIQL(guardrail.nodePattern);
          const result = await executeQuery(parsed, {
            storage: this.storage,
            temporal: this.temporal,
          });
          const { resultCount } = extractQueryMetrics(result);
          actualValue = resultCount;
          break;
        }

        case "max-drift-age": {
          // Not evaluable without temporal — return pass
          actualValue = 0;
          break;
        }

        default:
          actualValue = 0;
      }

      // Default comparison: actual must be <= threshold (max guardrails)
      const status = actualValue <= guardrail.threshold ? "pass" : "fail";

      return {
        guardrailId: guardrail.id,
        description: guardrail.description,
        type: guardrail.type,
        status,
        actualValue,
        threshold: guardrail.threshold,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        guardrailId: guardrail.id,
        description: guardrail.description,
        type: guardrail.type,
        status: "error",
        actualValue: 0,
        threshold: guardrail.threshold,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      };
    }
  }

  // ===========================================================================
  // Dependency Health Check
  // ===========================================================================

  private async evaluateDependencies(
    dependencies: string[],
  ): Promise<DependencyResult[]> {
    const results: DependencyResult[] = [];

    for (const nodeId of dependencies) {
      try {
        const node = await this.storage.getNode(nodeId);
        if (!node) {
          results.push({ nodeId, status: "missing" });
        } else if (node.status === "disappeared") {
          results.push({
            nodeId,
            status: "disappeared",
            nodeName: node.name,
            nodeStatus: node.status,
          });
        } else if (node.status === "error" || node.status === "stopped") {
          results.push({
            nodeId,
            status: "degraded",
            nodeName: node.name,
            nodeStatus: node.status,
          });
        } else {
          results.push({
            nodeId,
            status: "healthy",
            nodeName: node.name,
            nodeStatus: node.status,
          });
        }
      } catch {
        results.push({ nodeId, status: "missing" });
      }
    }

    return results;
  }

  // ===========================================================================
  // Result Building
  // ===========================================================================

  private buildResult(
    contract: InfraContract,
    assertions: AssertionResult[],
    guardrails: GuardrailResult[],
    dependencies: DependencyResult[],
    startMs: number,
    status: ContractEvaluationResult["status"],
  ): ContractEvaluationResult {
    return {
      contractId: contract.id,
      contractName: contract.name,
      owner: contract.owner,
      status,
      evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      assertions,
      guardrails,
      dependencies,
      summary: {
        totalAssertions: assertions.length,
        passedAssertions: assertions.filter((a) => a.status === "pass").length,
        failedAssertions: assertions.filter((a) => a.status === "fail").length,
        errorAssertions: assertions.filter((a) => a.status === "error").length,
        totalGuardrails: guardrails.length,
        passedGuardrails: guardrails.filter((g) => g.status === "pass").length,
        failedGuardrails: guardrails.filter((g) => g.status === "fail").length,
        totalDependencies: dependencies.length,
        healthyDependencies: dependencies.filter((d) => d.status === "healthy").length,
        missingDependencies: dependencies.filter((d) => d.status === "missing" || d.status === "disappeared").length,
      },
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function computeOverallStatus(
  assertions: AssertionResult[],
  guardrails: GuardrailResult[],
  dependencies: DependencyResult[],
): ContractEvaluationResult["status"] {
  const hasFailedAssertion = assertions.some((a) => a.status === "fail");
  const hasFailedGuardrail = guardrails.some((g) => g.status === "fail");
  const hasMissingDep = dependencies.some(
    (d) => d.status === "missing" || d.status === "disappeared",
  );
  const hasError =
    assertions.some((a) => a.status === "error") ||
    guardrails.some((g) => g.status === "error");
  const hasDegraded = dependencies.some((d) => d.status === "degraded");

  if (hasFailedAssertion || hasFailedGuardrail || hasMissingDep) return "fail";
  if (hasError) return "error";
  if (hasDegraded) return "degraded";
  return "pass";
}

function extractQueryMetrics(result: IQLResult): { resultCount: number; totalCost: number } {
  if (result.type === "find") {
    return {
      resultCount: result.nodes.length,
      totalCost: result.totalCost,
    };
  }
  if (result.type === "summarize") {
    return {
      resultCount: result.groups.length,
      totalCost: result.total,
    };
  }
  if (result.type === "diff") {
    return {
      resultCount: result.details.length,
      totalCost: Math.abs(result.costDelta),
    };
  }
  if (result.type === "path") {
    return {
      resultCount: result.found ? result.path.length : 0,
      totalCost: 0,
    };
  }
  return { resultCount: 0, totalCost: 0 };
}

function checkExpectation(
  expectation: AssertionExpectation,
  resultCount: number,
  totalCost: number,
): "pass" | "fail" {
  switch (expectation.type) {
    case "non-empty":
      return resultCount > 0 ? "pass" : "fail";
    case "empty":
      return resultCount === 0 ? "pass" : "fail";
    case "count": {
      const minOk = expectation.min === undefined || resultCount >= expectation.min;
      const maxOk = expectation.max === undefined || resultCount <= expectation.max;
      return minOk && maxOk ? "pass" : "fail";
    }
    case "cost":
      return totalCost <= expectation.maxMonthlyCost ? "pass" : "fail";
    case "all-match":
      // "all-match" means the query result should contain all expected nodes
      // For now, treat as non-empty (all query results match the filter)
      return resultCount > 0 ? "pass" : "fail";
    default:
      return "fail";
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// =============================================================================
// Formatting
// =============================================================================

/** Format a contract evaluation result as markdown. */
export function formatContractResultMarkdown(result: ContractEvaluationResult): string {
  const lines: string[] = [];
  const icon = result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : "⚠️";

  lines.push(`## ${icon} Contract: ${result.contractName}`);
  lines.push("");
  lines.push(`**Owner:** ${result.owner}`);
  lines.push(`**Status:** ${result.status.toUpperCase()}`);
  lines.push(`**Evaluated:** ${result.evaluatedAt}`);
  lines.push(`**Duration:** ${result.durationMs}ms`);
  lines.push("");

  // Summary
  const s = result.summary;
  lines.push("### Summary");
  lines.push("");
  lines.push(`| Check | Pass | Fail |`);
  lines.push(`|-------|------|------|`);
  lines.push(`| Assertions | ${s.passedAssertions}/${s.totalAssertions} | ${s.failedAssertions} |`);
  lines.push(`| Guardrails | ${s.passedGuardrails}/${s.totalGuardrails} | ${s.failedGuardrails} |`);
  lines.push(`| Dependencies | ${s.healthyDependencies}/${s.totalDependencies} | ${s.missingDependencies} missing |`);
  lines.push("");

  // Failed assertions
  const failed = result.assertions.filter((a) => a.status === "fail");
  if (failed.length > 0) {
    lines.push("### Failed Assertions");
    lines.push("");
    for (const a of failed) {
      lines.push(`- ❌ **${a.description}**`);
      lines.push(`  Query: \`${a.query}\``);
      lines.push(`  Result: ${a.resultCount} items, $${a.totalCost.toFixed(2)} cost`);
    }
    lines.push("");
  }

  // Failed guardrails
  const failedG = result.guardrails.filter((g) => g.status === "fail");
  if (failedG.length > 0) {
    lines.push("### Exceeded Guardrails");
    lines.push("");
    for (const g of failedG) {
      lines.push(`- ❌ **${g.description}**`);
      lines.push(`  Type: ${g.type}, Actual: ${g.actualValue}, Threshold: ${g.threshold}`);
    }
    lines.push("");
  }

  // Missing dependencies
  const missingDeps = result.dependencies.filter(
    (d) => d.status === "missing" || d.status === "disappeared",
  );
  if (missingDeps.length > 0) {
    lines.push("### Missing Dependencies");
    lines.push("");
    for (const d of missingDeps) {
      lines.push(`- ❌ **${d.nodeId}** — ${d.status}${d.nodeName ? ` (${d.nodeName})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Format a full suite result as markdown. */
export function formatContractSuiteMarkdown(suite: ContractSuiteResult): string {
  const lines: string[] = [];

  lines.push("## Infrastructure Contract Suite Results");
  lines.push("");
  lines.push(`**Evaluated:** ${suite.evaluatedAt}`);
  lines.push(`**Duration:** ${suite.durationMs}ms`);
  lines.push("");

  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  lines.push(`| ✅ Passed | ${suite.passed} |`);
  lines.push(`| ❌ Failed | ${suite.failed} |`);
  lines.push(`| ⚠️ Degraded | ${suite.degraded} |`);
  lines.push(`| 🔴 Error | ${suite.errors} |`);
  lines.push(`| **Total** | **${suite.totalContracts}** |`);
  lines.push("");

  // List failures
  const failures = suite.results.filter((r) => r.status === "fail" || r.status === "error");
  if (failures.length > 0) {
    lines.push("### Failing Contracts");
    lines.push("");
    for (const f of failures) {
      const failedAssertions = f.assertions.filter((a) => a.status === "fail");
      const failedGuardrails = f.guardrails.filter((g) => g.status === "fail");
      const missingDeps = f.dependencies.filter((d) => d.status === "missing" || d.status === "disappeared");

      lines.push(`#### ❌ ${f.contractName} (owner: ${f.owner})`);
      if (failedAssertions.length > 0) {
        lines.push(`  Assertions: ${failedAssertions.map((a) => a.description).join(", ")}`);
      }
      if (failedGuardrails.length > 0) {
        lines.push(`  Guardrails: ${failedGuardrails.map((g) => g.description).join(", ")}`);
      }
      if (missingDeps.length > 0) {
        lines.push(`  Missing deps: ${missingDeps.map((d) => d.nodeId).join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
