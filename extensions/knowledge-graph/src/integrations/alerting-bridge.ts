/**
 * Alerting Bridge — Alerting Integration ↔ Knowledge Graph
 *
 * Routes knowledge graph events (drift detection, compliance violations,
 * cost anomalies, disappeared resources) through the alerting-integration
 * extension's routing rules and dispatch channels.
 *
 * This enables KG events to be delivered to:
 *   - Slack, Discord, MS Teams, Telegram, Matrix
 *   - PagerDuty, OpsGenie webhooks
 *   - Custom webhook endpoints
 */

import type {
  GraphNode,
  DriftResult,
} from "../types.js";

import type {
  IntegrationContext,
  AlertSeverity,
  NormalisedAlert,
  DispatchRecord,
} from "./types.js";
import { withTimeout } from "./resilience.js";

// =============================================================================
// Alert Kind — types of KG events that generate alerts
// =============================================================================

export type KGAlertKind =
  | "drift_detected"
  | "resource_disappeared"
  | "compliance_violation"
  | "cost_anomaly"
  | "cost_spike"
  | "spof_detected"
  | "orphan_detected"
  | "sync_failed";

// =============================================================================
// Alerting Bridge
// =============================================================================

export class AlertingBridge {
  private alertCounter = 0;
  private static readonly MAX_ALERT_COUNTER = 1_000_000;

  constructor(
    private readonly ctx: IntegrationContext,
  ) {}

  /**
   * Check if the alerting extension is available.
   */
  get available(): boolean {
    return this.ctx.available.alertingIntegration && !!this.ctx.ext.alertingExtension;
  }

  /**
   * Send drift detection results as alerts.
   */
  async alertDrift(driftResult: DriftResult): Promise<AlertDispatchResult> {
    const alerts: NormalisedAlert[] = [];

    // Drifted nodes
    for (const entry of driftResult.driftedNodes) {
      alerts.push(
        this.buildAlert({
          kind: "drift_detected",
          severity: "high",
          title: `Drift detected: ${entry.node.name}`,
          description: `Resource ${entry.node.name} (${entry.node.resourceType}) has drifted. ` +
            `${entry.changes.length} field(s) changed: ${entry.changes.map((c) => c.field).filter(Boolean).join(", ")}`,
          node: entry.node,
          details: {
            changes: entry.changes.map((c) => ({
              field: c.field,
              from: c.previousValue,
              to: c.newValue,
            })),
          },
        }),
      );
    }

    // Disappeared nodes
    for (const node of driftResult.disappearedNodes) {
      alerts.push(
        this.buildAlert({
          kind: "resource_disappeared",
          severity: "critical",
          title: `Resource disappeared: ${node.name}`,
          description: `Resource ${node.name} (${node.resourceType}) in ${node.provider}/${node.region} ` +
            `was not found during scan. It may have been deleted outside of IaC.`,
          node,
        }),
      );
    }

    return this.dispatchAlerts(alerts);
  }

  /**
   * Send compliance violation alerts.
   */
  async alertComplianceViolations(
    violations: Array<{
      controlId: string;
      controlTitle: string;
      framework: string;
      resourceNodeId: string;
      resourceName: string;
      severity: string;
    }>,
  ): Promise<AlertDispatchResult> {
    if (violations.length === 0) {
      return { sent: 0, failed: 0, alertIds: [] };
    }

    // Group by severity to avoid alert fatigue
    const critical = violations.filter((v) => v.severity === "critical");
    const high = violations.filter((v) => v.severity === "high");
    const other = violations.filter((v) => v.severity !== "critical" && v.severity !== "high");

    const alerts: NormalisedAlert[] = [];

    // Individual alerts for critical violations
    for (const v of critical) {
      alerts.push(
        this.buildAlert({
          kind: "compliance_violation",
          severity: "critical",
          title: `[CRITICAL] ${v.framework}: ${v.controlTitle}`,
          description: `Resource ${v.resourceName} violates ${v.controlId} (${v.framework})`,
          details: v,
        }),
      );
    }

    // Batched alert for high violations
    if (high.length > 0) {
      alerts.push(
        this.buildAlert({
          kind: "compliance_violation",
          severity: "high",
          title: `${high.length} high-severity compliance violations`,
          description: high.map((v) => `${v.resourceName}: ${v.controlTitle}`).join("\n"),
          details: { violations: high },
        }),
      );
    }

    // Single summary for medium/low
    if (other.length > 0) {
      alerts.push(
        this.buildAlert({
          kind: "compliance_violation",
          severity: "medium",
          title: `${other.length} compliance violations (medium/low)`,
          description: `${other.length} additional violations detected across ${new Set(other.map((v) => v.framework)).size} framework(s)`,
          details: { count: other.length },
        }),
      );
    }

    return this.dispatchAlerts(alerts);
  }

  /**
   * Send a cost anomaly alert.
   */
  async alertCostAnomaly(opts: {
    nodeId: string;
    nodeName: string;
    previousCost: number;
    currentCost: number;
    percentChange: number;
  }): Promise<AlertDispatchResult> {
    const severity: AlertSeverity = opts.percentChange > 100 ? "critical" :
      opts.percentChange > 50 ? "high" : "medium";

    const alert = this.buildAlert({
      kind: "cost_anomaly",
      severity,
      title: `Cost anomaly: ${opts.nodeName} (+${opts.percentChange.toFixed(0)}%)`,
      description: `Resource ${opts.nodeName} cost changed from $${opts.previousCost.toFixed(2)} ` +
        `to $${opts.currentCost.toFixed(2)} (+${opts.percentChange.toFixed(0)}%)`,
      details: opts,
    });

    return this.dispatchAlerts([alert]);
  }

  /**
   * Send a sync failure alert.
   */
  async alertSyncFailure(opts: {
    provider: string;
    error: string;
    durationMs: number;
  }): Promise<AlertDispatchResult> {
    const alert = this.buildAlert({
      kind: "sync_failed",
      severity: "high",
      title: `Sync failed: ${opts.provider}`,
      description: `Knowledge graph sync for ${opts.provider} failed after ${opts.durationMs}ms: ${opts.error}`,
      details: opts,
    });

    return this.dispatchAlerts([alert]);
  }

  /**
   * Send a single-point-of-failure detection alert.
   */
  async alertSPOF(opts: {
    nodeId: string;
    nodeName: string;
    dependentCount: number;
    totalCostImpact: number;
  }): Promise<AlertDispatchResult> {
    const alert = this.buildAlert({
      kind: "spof_detected",
      severity: opts.dependentCount > 10 ? "critical" : "high",
      title: `SPOF detected: ${opts.nodeName}`,
      description: `${opts.nodeName} has ${opts.dependentCount} dependent resources. ` +
        `Total cost impact: $${opts.totalCostImpact.toFixed(2)}/mo`,
      details: opts,
    });

    return this.dispatchAlerts([alert]);
  }

  // -- Private helpers --------------------------------------------------------

  /**
   * Build a NormalisedAlert from KG event data.
   */
  private buildAlert(opts: {
    kind: KGAlertKind;
    severity: AlertSeverity;
    title: string;
    description: string;
    node?: GraphNode;
    details?: Record<string, unknown>;
  }): NormalisedAlert {
    this.alertCounter = (this.alertCounter + 1) % AlertingBridge.MAX_ALERT_COUNTER;
    const now = new Date().toISOString();

    return {
      id: `kg-${opts.kind}-${Date.now()}-${this.alertCounter}`,
      externalId: `kg-${opts.kind}-${this.alertCounter}`,
      provider: "pagerduty", // Will be overridden by routing
      severity: opts.severity,
      status: "triggered",
      title: opts.title,
      description: opts.description,
      service: "knowledge-graph",
      environment: opts.node?.tags?.environment ?? opts.node?.tags?.env ?? "unknown",
      raisedAt: now,
      receivedAt: now,
      sourceUrl: "",
      details: {
        kind: opts.kind,
        ...(opts.node ? {
          nodeId: opts.node.id,
          nodeName: opts.node.name,
          provider: opts.node.provider,
          resourceType: opts.node.resourceType,
          region: opts.node.region,
          account: opts.node.account,
        } : {}),
        ...(opts.details ?? {}),
      },
      tags: [
        `kind:${opts.kind}`,
        `source:knowledge-graph`,
        ...(opts.node ? [`provider:${opts.node.provider}`, `type:${opts.node.resourceType}`] : []),
      ],
    };
  }

  /**
   * Dispatch alerts through the alerting-integration extension.
   * Uses resolveRoutes() to find matching routing rules, then
   * dispatchToChannels() to send to matched channels.
   */
  private async dispatchAlerts(alerts: NormalisedAlert[]): Promise<AlertDispatchResult> {
    const ext = this.ctx.ext.alertingExtension;
    const config = this.ctx.alertingConfig;
    if (!ext || !config || alerts.length === 0) {
      return { sent: 0, failed: 0, alertIds: [] };
    }

    let sent = 0;
    let failed = 0;
    const alertIds: string[] = [];
    const sender = config.sender ?? ext.defaultSender;

    for (const alert of alerts) {
      try {
        // Find matching routes for this alert
        const routes = ext.resolveRoutes(alert, config.rules, config.channels);

        let dispatched = 0;
        for (const route of routes) {
          const records: DispatchRecord[] = await withTimeout(
            ext.dispatchToChannels(
              alert,
              route.channels,
              route.rule.id,
              sender,
              route.rule.template,
            ),
            10_000,
            `alerting.dispatch(${alert.id})`,
          );
          dispatched += records.filter((r) => r.status === "sent").length;
        }

        alertIds.push(alert.id);
        if (dispatched > 0) sent++;
        else if (routes.length === 0) sent++; // No routes = alert accepted but no dispatch needed

        // Audit each dispatched alert
        if (this.ctx.ext.auditLogger) {
          this.ctx.ext.auditLogger.log({
            eventType: "alert_triggered",
            severity: alert.severity === "critical" ? "critical" : "warn",
            actor: { id: "system", name: "alerting-bridge", roles: [] },
            operation: "kg.alert.dispatch",
            resource: { type: "alert", id: alert.id },
            result: "success",
            metadata: {
              bridge: "alerting",
              kind: alert.details.kind,
              routes: routes.length,
              dispatched,
            },
          });
        }
      } catch (err) {
        failed++;
        this.ctx.logger.error(`Alert dispatch failed: ${err}`);
      }
    }

    return { sent, failed, alertIds };
  }
}

// =============================================================================
// Types
// =============================================================================

export type AlertDispatchResult = {
  sent: number;
  failed: number;
  alertIds: string[];
};

// =============================================================================
// Format Helper
// =============================================================================

export function formatAlertBridgeMarkdown(result: AlertDispatchResult): string {
  return [
    "# Alert Dispatch Result",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Sent | ${result.sent} |`,
    `| Failed | ${result.failed} |`,
    `| Alert IDs | ${result.alertIds.length} |`,
    "",
    result.alertIds.length > 0
      ? `Alert IDs: ${result.alertIds.join(", ")}`
      : "No alerts dispatched.",
  ].join("\n");
}
