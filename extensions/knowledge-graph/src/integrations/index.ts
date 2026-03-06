/**
 * Integration Registry — Initialization & Lifecycle
 *
 * Central module that detects available sibling extensions, initializes
 * bridge classes, and exposes a composed IntegrationManager for the
 * plugin entry point to consume.
 *
 * Design principles:
 *   1. Zero hard dependencies — every bridge degrades gracefully
 *   2. Detection at startup via gateway probes (no dynamic import needed)
 *   3. Single IntegrationManager owns all bridge instances
 *   4. Storage composition: raw → auth-wrapped → audit-wrapped
 */

import type { GraphEngine } from "../core/engine.js";
import type { GraphStorage } from "../types.js";

import {
  type ExtensionAvailability,
  type IntegrationContext,
  type BridgeLogger,
  type AuthEngine,
  type AuditLoggerLike,
  type ComplianceEvaluator,
  type WaiverStore,
  type PolicyEvaluationEngine,
  type BudgetManagerLike,
  type TerraformGraphBridge,
  type AlertIngestor,
  NOOP_LOGGER,
} from "./types.js";

import { withEnterpriseAuth } from "./auth-bridge.js";
import { withAuditTrail } from "./audit-bridge.js";
import { ComplianceBridge } from "./compliance-bridge.js";
import { PolicyBridge } from "./policy-bridge.js";
import { CostBridge } from "./cost-bridge.js";
import { TerraformBridge } from "./terraform-bridge.js";
import { AlertingBridge } from "./alerting-bridge.js";

// Re-export all bridge types & classes
export type { IntegrationContext, ExtensionAvailability } from "./types.js";
export { AuthenticatedGraphStorage, withEnterpriseAuth } from "./auth-bridge.js";
export { AuditedGraphStorage, withAuditTrail } from "./audit-bridge.js";
export { ComplianceBridge } from "./compliance-bridge.js";
export { PolicyBridge } from "./policy-bridge.js";
export { CostBridge } from "./cost-bridge.js";
export { TerraformBridge } from "./terraform-bridge.js";
export { AlertingBridge } from "./alerting-bridge.js";
export {
  graphNodeToControlEvalNode,
  graphNodeToPolicyResource,
  buildGraphContext,
  NO_EXTENSIONS,
  NOOP_LOGGER,
} from "./types.js";

// =============================================================================
// Extension Probe — optional interface injected by the plugin register()
// =============================================================================

/**
 * Generic gateway probe — calls a gateway method and returns the result
 * or undefined if the extension is not available.
 */
export type GatewayProbe = (method: string, params?: Record<string, unknown>) => Promise<unknown | undefined>;

/**
 * ExternalExtensions holds the actual extension interface references.
 * The plugin entry point populates these after calling api.getService()
 * or similar for each sibling extension.
 */
export type ExternalExtensions = {
  authEngine?: AuthEngine;
  auditLogger?: AuditLoggerLike;
  complianceEvaluator?: ComplianceEvaluator;
  waiverStore?: WaiverStore;
  policyEngine?: PolicyEvaluationEngine;
  budgetManager?: BudgetManagerLike;
  terraformBridge?: TerraformGraphBridge;
  alertIngestor?: AlertIngestor;
};

// =============================================================================
// Integration Manager
// =============================================================================

export type IntegrationManagerOptions = {
  engine: GraphEngine;
  storage: GraphStorage;
  logger?: BridgeLogger;
  /**
   * Pre-populated external interfaces. The plugin entry point resolves
   * these from gateway calls / service references.
   */
  extensions?: ExternalExtensions;
};

/**
 * IntegrationManager owns all bridge instances and provides convenience
 * methods for the plugin entry point and agent tools.
 */
export class IntegrationManager {
  readonly ctx: IntegrationContext;
  readonly compliance: ComplianceBridge;
  readonly policy: PolicyBridge;
  readonly cost: CostBridge;
  readonly terraform: TerraformBridge;
  readonly alerting: AlertingBridge;

  private readonly logger: BridgeLogger;

  constructor(opts: IntegrationManagerOptions) {
    this.logger = opts.logger ?? NOOP_LOGGER;

    const ext = opts.extensions ?? {};
    const available = detectAvailability(ext);

    this.ctx = {
      engine: opts.engine,
      storage: opts.storage,
      logger: this.logger,
      available,
      ext,
    };

    this.compliance = new ComplianceBridge(this.ctx);
    this.policy = new PolicyBridge(this.ctx);
    this.cost = new CostBridge(this.ctx);
    this.terraform = new TerraformBridge(this.ctx);
    this.alerting = new AlertingBridge(this.ctx);

    this.logger.info(
      `IntegrationManager initialized — available: ${formatAvailable(available)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Availability
  // ---------------------------------------------------------------------------

  get available(): ExtensionAvailability {
    return this.ctx.available;
  }

  /** Summary string: e.g. "auth, audit, compliance, policy" */
  get availableSummary(): string {
    return formatAvailable(this.ctx.available);
  }

  // ---------------------------------------------------------------------------
  // Storage Composition
  // ---------------------------------------------------------------------------

  /**
   * Returns a storage instance wrapped with enterprise-auth (if available)
   * and audit-trail (if available) for a given actor.
   *
   *   raw storage → AuthenticatedGraphStorage → AuditedGraphStorage
   */
  getSecureStorage(userId: string): GraphStorage {
    let storage = this.ctx.storage;
    storage = withEnterpriseAuth(storage, this.ctx, userId);
    storage = withAuditTrail(storage, this.ctx, userId);
    return storage;
  }

  /**
   * Returns a storage instance wrapped only with audit-trail (no auth check).
   * Useful for internal / system operations that still need to be audited.
   */
  getAuditedStorage(actorId: string = "system"): GraphStorage {
    return withAuditTrail(this.ctx.storage, this.ctx, actorId);
  }

  // ---------------------------------------------------------------------------
  // Convenience — Drift + Alerting pipeline
  // ---------------------------------------------------------------------------

  /**
   * Run drift detection and, if the alerting bridge is available,
   * automatically route any drift/disappeared alerts.
   */
  async detectDriftAndAlert(): Promise<{
    driftedCount: number;
    disappearedCount: number;
    alertsSent: number;
  }> {
    const drift = await this.ctx.engine.detectDrift();
    let alertsSent = 0;

    if (
      this.alerting.available &&
      (drift.driftedNodes.length > 0 || drift.disappearedNodes.length > 0)
    ) {
      const result = await this.alerting.alertDrift(drift);
      alertsSent = result.sent;
    }

    return {
      driftedCount: drift.driftedNodes.length,
      disappearedCount: drift.disappearedNodes.length,
      alertsSent,
    };
  }

  // ---------------------------------------------------------------------------
  // Convenience — Compliance + Alerting pipeline
  // ---------------------------------------------------------------------------

  /**
   * Run compliance evaluation across all frameworks and optionally
   * alert on critical/high violations.
   */
  async evaluateComplianceAndAlert(opts?: {
    frameworks?: string[];
    alertOnViolations?: boolean;
  }): Promise<{
    results: Awaited<ReturnType<ComplianceBridge["evaluateAll"]>>;
    alertsSent: number;
  }> {
    const results = await this.compliance.evaluateAll(
      opts?.frameworks ? { provider: undefined } : undefined,
    );

    let alertsSent = 0;
    if (opts?.alertOnViolations !== false && this.alerting.available) {
      const violations = [...results.values()].flatMap((r) =>
        r.violations.map((v) => ({
          controlId: v.controlId,
          controlTitle: v.controlTitle,
          framework: v.framework,
          resourceNodeId: v.resourceNodeId,
          resourceName: v.resourceName,
          severity: v.severity,
        })),
      );
      if (violations.length > 0) {
        const alertResult = await this.alerting.alertComplianceViolations(violations);
        alertsSent = alertResult.sent;
      }
    }

    return { results, alertsSent };
  }

  // ---------------------------------------------------------------------------
  // Hot-reload extensions (e.g. if a sibling starts later)
  // ---------------------------------------------------------------------------

  /**
   * Update external extension references (e.g. when a sibling extension
   * starts after KG). Re-detects availability.
   */
  updateExtensions(ext: Partial<ExternalExtensions>): void {
    Object.assign(this.ctx.ext, ext);
    Object.assign(this.ctx.available, detectAvailability(this.ctx.ext));
    this.logger.info(
      `Extensions updated — available: ${formatAvailable(this.ctx.available)}`,
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

function detectAvailability(ext: ExternalExtensions): ExtensionAvailability {
  return {
    enterpriseAuth: !!ext.authEngine,
    auditTrail: !!ext.auditLogger,
    compliance: !!ext.complianceEvaluator,
    policyEngine: !!ext.policyEngine,
    costGovernance: !!ext.budgetManager,
    terraform: !!ext.terraformBridge,
    alertingIntegration: !!ext.alertIngestor,
  };
}

function formatAvailable(a: ExtensionAvailability): string {
  const names: string[] = [];
  if (a.enterpriseAuth) names.push("auth");
  if (a.auditTrail) names.push("audit");
  if (a.compliance) names.push("compliance");
  if (a.policyEngine) names.push("policy");
  if (a.costGovernance) names.push("cost");
  if (a.terraform) names.push("terraform");
  if (a.alertingIntegration) names.push("alerting");
  return names.length > 0 ? names.join(", ") : "none";
}
