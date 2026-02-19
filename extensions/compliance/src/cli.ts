/**
 * Compliance — CLI Commands
 */

import type { Command } from "commander";
import type { ControlEvalNode, FrameworkId } from "./types.js";
import { evaluate } from "./evaluator.js";
import { generateReport, exportMarkdown, filterViolations } from "./reporter.js";
import type { WaiverStore } from "./waivers.js";
import { createWaiver } from "./waivers.js";
import type { ReportStore } from "./storage.js";

const VALID_FRAMEWORKS = ["soc2", "cis", "hipaa", "pci-dss", "gdpr", "nist-800-53"];

export function createComplianceCli(
  getNodes: () => ControlEvalNode[],
  waiverStore: WaiverStore,
  reportStore?: ReportStore,
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

        // Auto-save report for trend tracking
        if (reportStore) {
          const reportId = reportStore.save(report);
          if (!opts.json) console.log(`  Report saved: ${reportId}`);
        }

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
      .description("Show compliance score trend over time")
      .requiredOption("--framework <id>", `Framework: ${VALID_FRAMEWORKS.join(", ")}`)
      .option("--limit <n>", "Number of data points", "20")
      .option("--json", "Output as JSON")
      .action(async (opts: { framework: string; limit: string; json?: boolean }) => {
        if (!VALID_FRAMEWORKS.includes(opts.framework)) {
          console.error(`Unknown framework: ${opts.framework}`);
          return;
        }

        if (!reportStore) {
          console.log("Trend analysis requires a report store. Reports are stored automatically when running scans.");
          return;
        }

        const limit = parseInt(opts.limit) || 20;
        const trends = reportStore.getTrend(opts.framework as FrameworkId, limit);

        if (trends.length === 0) {
          console.log(`No stored reports for ${opts.framework}. Run \`compliance scan --framework ${opts.framework}\` to build trend data.`);
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(trends, null, 2));
          return;
        }

        console.log(`\n📈 ${opts.framework.toUpperCase()} Compliance Trend (${trends.length} data points)\n`);

        // ASCII trend display
        const maxScore = 100;
        const barWidth = 30;
        for (const point of trends) {
          const filled = Math.round((point.score / maxScore) * barWidth);
          const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
          const date = point.date.split("T")[0];
          const icon = point.score >= 90 ? "✅" : point.score >= 70 ? "⚠️" : "❌";
          console.log(`  ${date}  ${bar}  ${icon} ${point.score}%  (${point.violations} violations)`);
        }

        // Summary
        const first = trends[0];
        const last = trends[trends.length - 1];
        const delta = last.score - first.score;
        const direction = delta > 0 ? "📈 improving" : delta < 0 ? "📉 declining" : "➡️ stable";
        console.log(`\n  Trend: ${direction} (${delta > 0 ? "+" : ""}${delta}% over ${trends.length} scans)`);
      });

    // ── history ───────────────────────────────────────────────────
    comp
      .command("history")
      .description("List stored compliance reports")
      .option("--framework <id>", "Filter by framework")
      .option("--limit <n>", "Max reports to show", "10")
      .action(async (opts: { framework?: string; limit: string }) => {
        if (!reportStore) {
          console.log("Report storage not configured.");
          return;
        }

        const limit = parseInt(opts.limit) || 10;
        const reports = reportStore.list(opts.framework as FrameworkId | undefined, limit);

        if (reports.length === 0) {
          console.log("No stored reports.");
          return;
        }

        console.log(`\n  Stored compliance reports (${reports.length}/${reportStore.count()} total):\n`);
        for (const r of reports) {
          const icon = r.report.score >= 90 ? "✅" : r.report.score >= 70 ? "⚠️" : "❌";
          const open = r.report.violations.filter((v) => v.status === "open").length;
          console.log(`  ${icon} ${r.id}  ${r.report.framework.toUpperCase().padEnd(12)}  Score: ${r.report.score}%  Violations: ${open}  ${r.report.generatedAt}`);
        }
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
