/**
 * Compliance — Agent Tools
 *
 * 4 tools: compliance_scan, compliance_report, compliance_violations, compliance_waiver
 */

import { Type } from "@sinclair/typebox";
import type { ControlEvalNode, FrameworkId } from "./types.js";
import { evaluate } from "./evaluator.js";
import { generateReport, exportMarkdown, filterViolations } from "./reporter.js";
import type { WaiverStore } from "./waivers.js";
import { createWaiver } from "./waivers.js";

const FRAMEWORK_VALUES = ["soc2", "cis", "hipaa", "pci-dss", "gdpr", "nist-800-53"];

export function createComplianceTools(
  getNodes: () => ControlEvalNode[],
  waiverStore: WaiverStore,
) {
  return [
    // ── compliance_scan ────────────────────────────────────────
    {
      name: "compliance_scan",
      description:
        "Run a full compliance scan against a framework (SOC2, CIS, HIPAA, PCI-DSS, GDPR, NIST 800-53) " +
        "using knowledge-graph nodes.",
      inputSchema: Type.Object({
        framework: Type.String({ description: "Framework ID: soc2, cis, hipaa, pci-dss, gdpr, nist-800-53" }),
        scope: Type.Optional(Type.String({ description: "Scope description (for report labeling)" })),
      }),
      execute: async (input: { framework: string; scope?: string }) => {
        if (!FRAMEWORK_VALUES.includes(input.framework)) {
          return { content: [{ type: "text" as const, text: `Unknown framework "${input.framework}". Valid: ${FRAMEWORK_VALUES.join(", ")}` }] };
        }

        const nodes = getNodes();
        if (nodes.length === 0) {
          return { content: [{ type: "text" as const, text: "No graph nodes available. Populate the knowledge graph first." }] };
        }

        const result = evaluate(input.framework as FrameworkId, nodes, waiverStore);
        const report = generateReport(result, input.scope);

        const icon = report.score >= 90 ? "✅" : report.score >= 70 ? "⚠️" : "❌";
        const summary = [
          `${icon} **${input.framework.toUpperCase()}** Compliance Score: **${report.score}%**`,
          "",
          `| Passed | Failed | Waived | N/A |`,
          `|--------|--------|--------|-----|`,
          `| ${report.passedControls} | ${report.failedControls} | ${report.waivedControls} | ${report.notApplicable} |`,
          "",
          report.violations.length > 0
            ? `**${report.violations.filter((v) => v.status === "open").length} open violations** (${report.violations.filter((v) => v.severity === "critical").length} critical)`
            : "No violations found.",
        ].join("\n");

        return { content: [{ type: "text" as const, text: summary }] };
      },
    },

    // ── compliance_report ──────────────────────────────────────
    {
      name: "compliance_report",
      description: "Generate a detailed compliance report in Markdown format.",
      inputSchema: Type.Object({
        framework: Type.String({ description: "Framework ID" }),
        scope: Type.Optional(Type.String({ description: "Scope description" })),
      }),
      execute: async (input: { framework: string; scope?: string }) => {
        if (!FRAMEWORK_VALUES.includes(input.framework)) {
          return { content: [{ type: "text" as const, text: `Unknown framework: ${input.framework}` }] };
        }

        const nodes = getNodes();
        const result = evaluate(input.framework as FrameworkId, nodes, waiverStore);
        const report = generateReport(result, input.scope);
        const md = exportMarkdown(report);

        return { content: [{ type: "text" as const, text: md }] };
      },
    },

    // ── compliance_violations ──────────────────────────────────
    {
      name: "compliance_violations",
      description: "List open compliance violations with remediation guidance.",
      inputSchema: Type.Object({
        framework: Type.String({ description: "Framework ID" }),
        severity: Type.Optional(Type.String({ description: "Filter by severity: critical, high, medium, low, info" })),
        status: Type.Optional(Type.String({ description: "Filter by status: open, waived, remediated, accepted" })),
      }),
      execute: async (input: { framework: string; severity?: string; status?: string }) => {
        if (!FRAMEWORK_VALUES.includes(input.framework)) {
          return { content: [{ type: "text" as const, text: `Unknown framework: ${input.framework}` }] };
        }

        const nodes = getNodes();
        const result = evaluate(input.framework as FrameworkId, nodes, waiverStore);
        const filtered = filterViolations(result.violations, {
          severity: input.severity,
          status: input.status ?? "open",
        });

        if (filtered.length === 0) {
          return { content: [{ type: "text" as const, text: "No violations match the given filters." }] };
        }

        const lines = filtered.map(
          (v) =>
            `• **${v.controlTitle}** (${v.controlId}) — ${v.severity}\n  Resource: ${v.resourceName} (${v.resourceType})\n  Remediation: ${v.remediation}`,
        );

        return { content: [{ type: "text" as const, text: `${filtered.length} violations:\n\n${lines.join("\n\n")}` }] };
      },
    },

    // ── compliance_waiver ──────────────────────────────────────
    {
      name: "compliance_waiver",
      description: "Add, list, or remove compliance waivers.",
      inputSchema: Type.Object({
        action: Type.String({ description: "Action: add, list, remove" }),
        controlId: Type.Optional(Type.String({ description: "Control ID (for add)" })),
        resourceId: Type.Optional(Type.String({ description: "Resource node ID (for add)" })),
        reason: Type.Optional(Type.String({ description: "Waiver reason (for add)" })),
        approvedBy: Type.Optional(Type.String({ description: "Approver name (for add)" })),
        expiresInDays: Type.Optional(Type.Number({ description: "Expiry in days (default 90)" })),
        waiverId: Type.Optional(Type.String({ description: "Waiver ID (for remove)" })),
      }),
      execute: async (input: {
        action: string;
        controlId?: string;
        resourceId?: string;
        reason?: string;
        approvedBy?: string;
        expiresInDays?: number;
        waiverId?: string;
      }) => {
        switch (input.action) {
          case "add": {
            if (!input.controlId || !input.resourceId || !input.reason) {
              return { content: [{ type: "text" as const, text: "Missing required fields: controlId, resourceId, reason" }] };
            }
            const waiver = createWaiver({
              controlId: input.controlId,
              resourceId: input.resourceId,
              reason: input.reason,
              approvedBy: input.approvedBy ?? "system",
              expiresInDays: input.expiresInDays,
            });
            waiverStore.add(waiver);
            return { content: [{ type: "text" as const, text: `Waiver created: ${waiver.id} (expires ${waiver.expiresAt})` }] };
          }

          case "list": {
            const active = waiverStore.listActive();
            if (active.length === 0) {
              return { content: [{ type: "text" as const, text: "No active waivers." }] };
            }
            const lines = active.map(
              (w) => `• ${w.id} — control: ${w.controlId}, resource: ${w.resourceId}, expires: ${w.expiresAt}`,
            );
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          case "remove": {
            if (!input.waiverId) {
              return { content: [{ type: "text" as const, text: "Missing waiverId for remove action." }] };
            }
            const removed = waiverStore.remove(input.waiverId);
            return { content: [{ type: "text" as const, text: removed ? `Waiver ${input.waiverId} removed.` : `Waiver ${input.waiverId} not found.` }] };
          }

          default:
            return { content: [{ type: "text" as const, text: `Unknown action: ${input.action}. Use add, list, or remove.` }] };
        }
      },
    },
  ];
}
