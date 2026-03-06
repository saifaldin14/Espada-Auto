/**
 * Compliance Bridge — Compliance Extension ↔ Knowledge Graph
 *
 * Bridges the compliance extension's multi-framework evaluator with KG's
 * graph topology. Maps GraphNode → ControlEvalNode, delegates evaluation
 * to the compliance extension (6 frameworks, 34+ controls, waiver management),
 * and enriches results with graph context (blast radius, dependencies).
 *
 * When the compliance extension is unavailable, falls back to KG's built-in
 * compliance module (which has fewer controls and no waiver persistence).
 */

import type {
  NodeFilter,
} from "../types.js";

import type {
  IntegrationContext,
  ComplianceFrameworkId,
  ComplianceEvaluationResult,
  ComplianceViolation,
  ControlEvalNode,
} from "./types.js";
import { graphNodeToControlEvalNode } from "./types.js";

// =============================================================================
// Compliance Bridge
// =============================================================================

export class ComplianceBridge {
  constructor(
    private readonly ctx: IntegrationContext,
  ) {}

  /**
   * Run a compliance assessment against graph nodes using the compliance
   * extension's evaluator (34+ controls, waiver support).
   *
   * Falls back to KG's built-in compliance module if the extension is unavailable.
   */
  async evaluate(
    frameworkId: ComplianceFrameworkId,
    filter?: NodeFilter,
  ): Promise<ComplianceEvaluationResult> {
    const nodes = await this.ctx.storage.queryNodes(filter ?? {});
    const evalNodes = nodes.map(graphNodeToControlEvalNode);

    // Use the compliance extension if available
    if (this.ctx.available.compliance && this.ctx.ext.complianceEvaluator) {
      this.ctx.logger.info(
        `Evaluating ${frameworkId} via compliance extension (${evalNodes.length} nodes)`,
      );

      const waiverLookup = this.ctx.ext.waiverStore
        ? { isWaived: (cid: string, rid: string) => this.ctx.ext.waiverStore!.isWaived(cid, rid) }
        : undefined;

      const result = this.ctx.ext.complianceEvaluator.evaluate(
        frameworkId,
        evalNodes,
        waiverLookup,
      );

      // Emit audit event for compliance scan
      this.emitAudit(frameworkId, result);

      return result;
    }

    // Fallback: use KG's built-in compliance
    this.ctx.logger.info(
      `Evaluating ${frameworkId} via built-in compliance (${evalNodes.length} nodes)`,
    );
    return this.evaluateBuiltIn(frameworkId, evalNodes);
  }

  /**
   * Evaluate all supported frameworks and return aggregated results.
   */
  async evaluateAll(
    filter?: NodeFilter,
  ): Promise<Map<ComplianceFrameworkId, ComplianceEvaluationResult>> {
    const frameworks: ComplianceFrameworkId[] = [
      "soc2", "cis", "hipaa", "pci-dss", "gdpr", "nist-800-53",
    ];
    const results = new Map<ComplianceFrameworkId, ComplianceEvaluationResult>();

    for (const fw of frameworks) {
      try {
        const result = await this.evaluate(fw, filter);
        results.set(fw, result);
      } catch (err) {
        this.ctx.logger.error(`Compliance evaluation failed for ${fw}: ${err}`);
      }
    }

    return results;
  }

  /**
   * Enrich compliance violations with graph context — blast radius and
   * dependency count for each violating resource.
   */
  async enrichViolations(
    violations: ComplianceViolation[],
  ): Promise<Array<ComplianceViolation & { blastRadius: number; dependencyDepth: number }>> {
    const enriched: Array<ComplianceViolation & { blastRadius: number; dependencyDepth: number }> = [];

    for (const v of violations) {
      try {
        const blast = await this.ctx.engine.getBlastRadius(v.resourceNodeId, 3);
        enriched.push({
          ...v,
          blastRadius: blast.nodes.size,
          dependencyDepth: blast.hops.size,
        });
      } catch {
        // Node may have been removed — enrich with zero values
        enriched.push({ ...v, blastRadius: 0, dependencyDepth: 0 });
      }
    }

    return enriched;
  }

  /**
   * Create a compliance waiver — delegates to the compliance extension's
   * waiver store if available.
   */
  createWaiver(opts: {
    controlId: string;
    resourceId: string;
    reason: string;
    approvedBy: string;
    expiresAt: string;
  }): { id: string } | null {
    if (!this.ctx.ext.waiverStore) {
      this.ctx.logger.warn("Waiver store unavailable — cannot create waiver");
      return null;
    }

    const waiver = this.ctx.ext.waiverStore.create(opts);

    // Audit the waiver creation
    if (this.ctx.ext.auditLogger) {
      this.ctx.ext.auditLogger.log({
        eventType: "compliance_scanned",
        severity: "warn",
        actor: { id: opts.approvedBy, name: opts.approvedBy, roles: [] },
        operation: "kg.compliance.createWaiver",
        resource: { type: "compliance-waiver", id: waiver.id },
        result: "success",
        metadata: {
          bridge: "compliance",
          controlId: opts.controlId,
          resourceId: opts.resourceId,
          reason: opts.reason,
          expiresAt: opts.expiresAt,
        },
      });
    }

    return waiver;
  }

  /**
   * List active waivers.
   */
  listWaivers(): Array<{
    id: string;
    controlId: string;
    resourceId: string;
    reason: string;
    approvedBy: string;
    expiresAt: string;
  }> {
    if (!this.ctx.ext.waiverStore) return [];
    return this.ctx.ext.waiverStore.list();
  }

  /**
   * Get a compliance trend — evaluate now and compare with previous results
   * stored in the graph's change log.
   */
  async getComplianceSummary(
    filter?: NodeFilter,
  ): Promise<{
    frameworks: Array<{
      id: ComplianceFrameworkId;
      score: number;
      violations: number;
      passed: number;
      failed: number;
    }>;
    totalViolations: number;
    averageScore: number;
  }> {
    const results = await this.evaluateAll(filter);
    const frameworks: Array<{
      id: ComplianceFrameworkId;
      score: number;
      violations: number;
      passed: number;
      failed: number;
    }> = [];

    let totalViolations = 0;
    let totalScore = 0;

    for (const [id, result] of results.entries()) {
      frameworks.push({
        id,
        score: result.score,
        violations: result.violations.length,
        passed: result.passedControls,
        failed: result.failedControls,
      });
      totalViolations += result.violations.filter((v) => v.status === "open").length;
      totalScore += result.score;
    }

    return {
      frameworks,
      totalViolations,
      averageScore: frameworks.length > 0 ? Math.round(totalScore / frameworks.length) : 100,
    };
  }

  // -- Private helpers --------------------------------------------------------

  /**
   * Fall back to KG's built-in compliance evaluator.
   * Uses dynamic import to avoid hard dependency.
   */
  private async evaluateBuiltIn(
    frameworkId: ComplianceFrameworkId,
    _nodes: ControlEvalNode[],
  ): Promise<ComplianceEvaluationResult> {
    // Use the KG's own compliance module
    const { runComplianceAssessment, SUPPORTED_FRAMEWORKS } = await import(
      "../analysis/compliance.js"
    );

    // Map framework ID to KG's ComplianceFramework type
    type BuiltInFramework = (typeof SUPPORTED_FRAMEWORKS)[number];
    const kgFrameworkId = frameworkId as unknown as BuiltInFramework;
    if (!SUPPORTED_FRAMEWORKS.includes(kgFrameworkId)) {
      return {
        framework: frameworkId,
        frameworkVersion: "unknown",
        totalControls: 0,
        passedControls: 0,
        failedControls: 0,
        waivedControls: 0,
        notApplicable: 0,
        score: 100,
        violations: [],
        byCategory: {},
        bySeverity: {},
      };
    }

    // KG's built-in runComplianceAssessment expects (frameworks[], storage, filter?)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await runComplianceAssessment(
      [kgFrameworkId],
      this.ctx.storage,
    );

    // Map KG report format to our unified format
    const fwReport = report.frameworks?.find((r: { framework: string }) => r.framework === kgFrameworkId);
    if (!fwReport) {
      return {
        framework: frameworkId,
        frameworkVersion: "1.0",
        totalControls: 0,
        passedControls: 0,
        failedControls: 0,
        waivedControls: 0,
        notApplicable: 0,
        score: 100,
        violations: [],
        byCategory: {},
        bySeverity: {},
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
      framework: frameworkId,
      frameworkVersion: "1.0",
      totalControls: fwReport.totalControls ?? 0,
      passedControls: fwReport.passed ?? 0,
      failedControls: fwReport.failed ?? 0,
      waivedControls: 0,
      notApplicable: fwReport.notApplicable ?? 0,
      score: fwReport.score ?? 100,
      violations: (fwReport.results ?? [])
        .filter((r: Record<string, unknown>) => r.status === "fail")
        .map((v: Record<string, unknown>) => ({
        controlId: v.controlId as string,
        controlTitle: v.controlTitle as string,
        framework: frameworkId,
        resourceNodeId: v.resourceNodeId as string ?? v.nodeId as string ?? "",
        resourceName: v.resourceName as string ?? "",
        resourceType: v.resourceType as string ?? "",
        severity: (v.severity ?? "medium") as "critical" | "high" | "medium" | "low" | "info",
        description: v.description as string ?? "",
        remediation: v.remediation as string ?? "",
        status: (v.status as string ?? "open") as "open" | "remediated" | "waived" | "accepted",
        detectedAt: v.detectedAt as string ?? new Date().toISOString(),
      })),
      byCategory: {},
      bySeverity: (fwReport as unknown as Record<string, unknown>).failureBySeverity as Record<string, number> ?? {},
    };
  }

  private emitAudit(
    frameworkId: ComplianceFrameworkId,
    result: ComplianceEvaluationResult,
  ): void {
    if (!this.ctx.ext.auditLogger) return;

    this.ctx.ext.auditLogger.log({
      eventType: "compliance_scanned",
      severity: result.failedControls > 0 ? "warn" : "info",
      actor: { id: "system", name: "compliance-bridge", roles: [] },
      operation: "kg.compliance.evaluate",
      result: "success",
      metadata: {
        bridge: "compliance",
        framework: frameworkId,
        score: result.score,
        totalControls: result.totalControls,
        passedControls: result.passedControls,
        failedControls: result.failedControls,
        waivedControls: result.waivedControls,
        violationCount: result.violations.length,
      },
    });
  }
}

// =============================================================================
// Format Helpers
// =============================================================================

/**
 * Format a compliance evaluation result as markdown.
 */
export function formatComplianceBridgeMarkdown(
  result: ComplianceEvaluationResult,
): string {
  const lines: string[] = [
    `# Compliance Report: ${result.framework.toUpperCase()}`,
    "",
    `**Score:** ${result.score}%`,
    `**Version:** ${result.frameworkVersion}`,
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total Controls | ${result.totalControls} |`,
    `| Passed | ${result.passedControls} |`,
    `| Failed | ${result.failedControls} |`,
    `| Waived | ${result.waivedControls} |`,
    `| N/A | ${result.notApplicable} |`,
    "",
  ];

  if (result.violations.length > 0) {
    lines.push(
      "## Violations",
      "",
      "| Severity | Control | Resource | Status |",
      "|----------|---------|----------|--------|",
      ...result.violations.map((v) =>
        `| ${v.severity} | ${v.controlId}: ${v.controlTitle} | ${v.resourceName} (${v.resourceType}) | ${v.status} |`,
      ),
      "",
    );
  }

  return lines.join("\n");
}
