/**
 * Compliance — CLI Commands
 */

import type { Command } from "commander";
import type { ControlEvalNode, FrameworkId } from "./types.js";
import { evaluate } from "./evaluator.js";
import { generateReport, exportMarkdown, filterViolations } from "./reporter.js";
import type { WaiverStore } from "./waivers.js";
import { createWaiver } from "./waivers.js";

const VALID_FRAMEWORKS = ["soc2", "cis", "hipaa", "pci-dss", "gdpr", "nist-800-53"];

export function createComplianceCli(
  getNodes: () => ControlEvalNode[],
  waiverStore: WaiverStore,
) {
  return (program: Command) => {
    const comp = program.command("compliance").description("Compliance scanning and reporting");

    // ── scan ─────────────────────────────────────────────────────
    comp
      .command("scan")
      .description("Run compliance scan against a framework")
      .requiredOption("--framework <id>", `Framework: ${VALID_FRAMEWORKS.join(", ")}`)
      .option("--json", "Output as JSON")
      .action(async (opts: { framework: string; json?: boolean }) => {
        if (!VALID_FRAMEWORKS.includes(opts.framework)) {
          console.error(`Unknown framework: ${opts.framework}`);
          return;
        }

        const nodes = getNodes();
        if (nodes.length === 0) {
          console.log("No graph nodes available.");
          return;
        }

        const result = evaluate(opts.framework as FrameworkId, nodes, waiverStore);
        const report = generateReport(result);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        const icon = report.score >= 90 ? "✅" : report.score >= 70 ? "⚠️" : "❌";
        console.log(`\n${icon} ${opts.framework.toUpperCase()} Compliance Score: ${report.score}%`);
        console.log(`  Passed: ${report.passedControls} | Failed: ${report.failedControls} | Waived: ${report.waivedControls} | N/A: ${report.notApplicable}`);

        if (report.violations.length > 0) {
          const open = report.violations.filter((v) => v.status === "open");
          console.log(`\n  ${open.length} open violations:`);
          for (const v of open.slice(0, 10)) {
            console.log(`    ${severityIcon(v.severity)} ${v.controlTitle} — ${v.resourceName} (${v.resourceType})`);
          }
          if (open.length > 10) console.log(`    ... and ${open.length - 10} more`);
        }
      });

    // ── report ───────────────────────────────────────────────────
    comp
      .command("report")
      .description("Generate a formatted compliance report")
      .requiredOption("--framework <id>", "Framework ID")
      .option("--format <fmt>", "Output format: md or json", "md")
      .action(async (opts: { framework: string; format: string }) => {
        if (!VALID_FRAMEWORKS.includes(opts.framework)) {
          console.error(`Unknown framework: ${opts.framework}`);
          return;
        }

        const nodes = getNodes();
        const result = evaluate(opts.framework as FrameworkId, nodes, waiverStore);
        const report = generateReport(result);

        if (opts.format === "json") {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(exportMarkdown(report));
        }
      });

    // ── violations ───────────────────────────────────────────────
    const violations = comp.command("violations").description("Compliance violations");

    violations
      .command("list")
      .description("List open compliance violations")
      .requiredOption("--framework <id>", "Framework ID")
      .option("--severity <level>", "Filter by severity")
      .option("--type <resourceType>", "Filter by resource type")
      .action(async (opts: { framework: string; severity?: string; type?: string }) => {
        if (!VALID_FRAMEWORKS.includes(opts.framework)) {
          console.error(`Unknown framework: ${opts.framework}`);
          return;
        }

        const nodes = getNodes();
        const result = evaluate(opts.framework as FrameworkId, nodes, waiverStore);
        const filtered = filterViolations(result.violations, {
          status: "open",
          severity: opts.severity,
          resourceType: opts.type,
        });

        if (filtered.length === 0) {
          console.log("No violations match the given filters.");
          return;
        }

        for (const v of filtered) {
          console.log(`  ${severityIcon(v.severity)} [${v.controlId}] ${v.controlTitle}`);
          console.log(`    Resource: ${v.resourceName} (${v.resourceType})`);
          console.log(`    Fix: ${v.remediation}\n`);
        }
      });

    // ── waiver ───────────────────────────────────────────────────
    const waiver = comp.command("waiver").description("Manage compliance waivers");

    waiver
      .command("add")
      .description("Add a compliance waiver")
      .requiredOption("--control <id>", "Control ID to waive")
      .requiredOption("--resource <id>", "Resource node ID")
      .requiredOption("--reason <text>", "Reason for waiver")
      .option("--approved-by <name>", "Approver name", "operator")
      .option("--expires <days>", "Days until expiry", "90")
      .action(async (opts: { control: string; resource: string; reason: string; approvedBy: string; expires: string }) => {
        const w = createWaiver({
          controlId: opts.control,
          resourceId: opts.resource,
          reason: opts.reason,
          approvedBy: opts.approvedBy,
          expiresInDays: parseInt(opts.expires),
        });
        waiverStore.add(w);
        console.log(`Waiver created: ${w.id}`);
        console.log(`  Control: ${w.controlId} | Resource: ${w.resourceId}`);
        console.log(`  Expires: ${w.expiresAt}`);
      });

    waiver
      .command("list")
      .description("List active waivers")
      .action(async () => {
        const active = waiverStore.listActive();
        if (active.length === 0) {
          console.log("No active waivers.");
          return;
        }
        for (const w of active) {
          console.log(`  ${w.id} — ${w.controlId} → ${w.resourceId} (expires ${w.expiresAt})`);
        }
      });

    waiver
      .command("remove")
      .description("Remove a waiver")
      .argument("<id>", "Waiver ID")
      .action(async (id: string) => {
        const removed = waiverStore.remove(id);
        console.log(removed ? `Waiver ${id} removed.` : `Waiver ${id} not found.`);
      });

    // ── trend ────────────────────────────────────────────────────
    comp
      .command("trend")
      .description("Show compliance score trend (requires stored reports)")
      .action(async () => {
        // Trend requires historical reports stored externally
        console.log("Trend analysis requires stored report history. Run scans periodically to build trend data.");
        console.log("Use `compliance report --framework <id> --format json` to capture snapshots.");
      });
  };
}

function severityIcon(severity: string): string {
  switch (severity) {
    case "critical": return "🔴";
    case "high": return "🟠";
    case "medium": return "🟡";
    case "low": return "🔵";
    default: return "⚪";
  }
}
