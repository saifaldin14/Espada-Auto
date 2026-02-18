/**
 * Compliance — Reporter
 *
 * Generates compliance reports in JSON and Markdown, compares reports for trends.
 */

import type { ComplianceReport, ComplianceViolation, ComplianceTrend, FrameworkId, ControlSeverity } from "./types.js";
import type { EvaluationResult } from "./evaluator.js";

// ---------------------------------------------------------------------------
// generateReport — from evaluation result
// ---------------------------------------------------------------------------
export function generateReport(result: EvaluationResult, scope = "all resources"): ComplianceReport {
  return {
    framework: result.framework,
    frameworkVersion: result.frameworkVersion,
    generatedAt: new Date().toISOString(),
    scope,
    score: result.score,
    totalControls: result.totalControls,
    passedControls: result.passedControls,
    failedControls: result.failedControls,
    waivedControls: result.waivedControls,
    notApplicable: result.notApplicable,
    violations: result.violations,
    byCategory: result.byCategory,
    bySeverity: result.bySeverity,
  };
}

// ---------------------------------------------------------------------------
// exportReport — format as Markdown
// ---------------------------------------------------------------------------
export function exportMarkdown(report: ComplianceReport): string {
  const lines: string[] = [];
  const grade = scoreToGrade(report.score);

  lines.push(`# Compliance Report — ${frameworkLabel(report.framework)}`);
  lines.push("");
  lines.push(`**Generated**: ${report.generatedAt}`);
  lines.push(`**Scope**: ${report.scope}`);
  lines.push(`**Score**: ${report.score}% (${grade})`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|------:|");
  lines.push(`| Total Controls | ${report.totalControls} |`);
  lines.push(`| Passed | ${report.passedControls} |`);
  lines.push(`| Failed | ${report.failedControls} |`);
  lines.push(`| Waived | ${report.waivedControls} |`);
  lines.push(`| Not Applicable | ${report.notApplicable} |`);
  lines.push("");

  // By category
  if (Object.keys(report.byCategory).length > 0) {
    lines.push("## By Category");
    lines.push("");
    lines.push("| Category | Passed | Failed | Total |");
    lines.push("|----------|-------:|-------:|------:|");
    for (const [cat, scores] of Object.entries(report.byCategory)) {
      lines.push(`| ${cat} | ${scores.passed} | ${scores.failed} | ${scores.total} |`);
    }
    lines.push("");
  }

  // By severity
  const severities: ControlSeverity[] = ["critical", "high", "medium", "low", "info"];
  const hasSeverity = severities.some((s) => (report.bySeverity[s] ?? 0) > 0);
  if (hasSeverity) {
    lines.push("## Violations by Severity");
    lines.push("");
    lines.push("| Severity | Count |");
    lines.push("|----------|------:|");
    for (const s of severities) {
      if ((report.bySeverity[s] ?? 0) > 0) {
        lines.push(`| ${severityIcon(s)} ${s} | ${report.bySeverity[s]} |`);
      }
    }
    lines.push("");
  }

  // Violations detail
  if (report.violations.length > 0) {
    lines.push("## Violations");
    lines.push("");
    for (const v of report.violations) {
      const icon = v.status === "waived" ? "⏸️" : severityIcon(v.severity);
      lines.push(`### ${icon} ${v.controlTitle} (${v.controlId})`);
      lines.push("");
      lines.push(`- **Resource**: ${v.resourceName} (${v.resourceType})`);
      lines.push(`- **Severity**: ${v.severity}`);
      lines.push(`- **Status**: ${v.status}`);
      lines.push(`- **Description**: ${v.description}`);
      lines.push(`- **Remediation**: ${v.remediation}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// compareReports — compute trend
// ---------------------------------------------------------------------------
export function compareReports(reports: ComplianceReport[]): ComplianceTrend[] {
  return reports.map((r) => ({
    date: r.generatedAt,
    score: r.score,
    violations: r.violations.filter((v) => v.status === "open").length,
  }));
}

// ---------------------------------------------------------------------------
// filterViolations — by status, severity, or resource
// ---------------------------------------------------------------------------
export function filterViolations(
  violations: ComplianceViolation[],
  filter?: { status?: string; severity?: string; resourceType?: string },
): ComplianceViolation[] {
  if (!filter) return violations;
  return violations.filter((v) => {
    if (filter.status && v.status !== filter.status) return false;
    if (filter.severity && v.severity !== filter.severity) return false;
    if (filter.resourceType && v.resourceType !== filter.resourceType) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function severityIcon(severity: ControlSeverity): string {
  switch (severity) {
    case "critical": return "🔴";
    case "high": return "🟠";
    case "medium": return "🟡";
    case "low": return "🔵";
    case "info": return "⚪";
  }
}

function frameworkLabel(id: FrameworkId): string {
  const labels: Record<FrameworkId, string> = {
    soc2: "SOC 2 Type II",
    cis: "CIS Benchmarks",
    hipaa: "HIPAA",
    "pci-dss": "PCI-DSS",
    gdpr: "GDPR",
    "nist-800-53": "NIST 800-53",
  };
  return labels[id] ?? id;
}

export { scoreToGrade, severityIcon };
