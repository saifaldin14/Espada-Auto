/**
 * Compliance — Evaluator
 *
 * Walks graph nodes, applies framework controls, produces evaluation results.
 */

import type { FrameworkId, ComplianceFramework, ComplianceControl, ComplianceViolation, ControlEvalNode, ControlSeverity, ViolationStatus } from "./types.js";
import { getFramework } from "./controls.js";

// ---------------------------------------------------------------------------
// Evaluation result (before report formatting)
// ---------------------------------------------------------------------------
export interface EvaluationResult {
  framework: FrameworkId;
  frameworkVersion: string;
  totalControls: number;
  passedControls: number;
  failedControls: number;
  waivedControls: number;
  notApplicable: number;
  score: number;
  violations: ComplianceViolation[];
  byCategory: Record<string, { passed: number; failed: number; total: number }>;
  bySeverity: Record<ControlSeverity, number>;
}

// ---------------------------------------------------------------------------
// Waiver lookup (control+resource → waiver info)
// ---------------------------------------------------------------------------
export interface WaiverLookup {
  isWaived: (controlId: string, resourceId: string) => boolean;
}

const NO_WAIVERS: WaiverLookup = { isWaived: () => false };

// ---------------------------------------------------------------------------
// evaluate — main entry point
// ---------------------------------------------------------------------------
export function evaluate(
  frameworkId: FrameworkId,
  nodes: ControlEvalNode[],
  waiverLookup: WaiverLookup = NO_WAIVERS,
): EvaluationResult {
  const framework = getFramework(frameworkId);
  if (!framework) throw new Error(`Unknown framework: ${frameworkId}`);
  return evaluateFramework(framework, nodes, waiverLookup);
}

export function evaluateFramework(
  framework: ComplianceFramework,
  nodes: ControlEvalNode[],
  waiverLookup: WaiverLookup = NO_WAIVERS,
): EvaluationResult {
  const violations: ComplianceViolation[] = [];
  const byCategory: Record<string, { passed: number; failed: number; total: number }> = {};
  const bySeverity: Record<ControlSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  let passedControls = 0;
  let failedControls = 0;
  let waivedControls = 0;
  let notApplicable = 0;

  for (const control of framework.controls) {
    const applicable = nodes.filter((n) => control.applicableResourceTypes.includes(n.resourceType as never));

    if (applicable.length === 0) {
      notApplicable++;
      continue;
    }

    // Ensure category exists
    if (!byCategory[control.category]) {
      byCategory[control.category] = { passed: 0, failed: 0, total: 0 };
    }
    byCategory[control.category].total++;

    const failedNodes = evaluateControl(control, applicable, waiverLookup);

    if (failedNodes.length === 0) {
      passedControls++;
      byCategory[control.category].passed++;
    } else {
      // Check if all failures are waived
      const allWaived = failedNodes.every((v) => v.status === "waived");
      if (allWaived) {
        waivedControls++;
        byCategory[control.category].passed++;
      } else {
        failedControls++;
        byCategory[control.category].failed++;
        bySeverity[control.severity] += failedNodes.filter((v) => v.status === "open").length;
      }
      violations.push(...failedNodes);
    }
  }

  const totalEvaluated = passedControls + failedControls + waivedControls;
  const score = totalEvaluated > 0 ? Math.round(((passedControls + waivedControls) / totalEvaluated) * 100) : 100;

  return {
    framework: framework.id,
    frameworkVersion: framework.version,
    totalControls: framework.controls.length,
    passedControls,
    failedControls,
    waivedControls,
    notApplicable,
    score,
    violations,
    byCategory,
    bySeverity,
  };
}

// ---------------------------------------------------------------------------
// evaluateControl — check one control against applicable nodes
// ---------------------------------------------------------------------------
export function evaluateControl(
  control: ComplianceControl,
  nodes: ControlEvalNode[],
  waiverLookup: WaiverLookup = NO_WAIVERS,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (const node of nodes) {
    const passes = control.evaluate(node);
    if (passes) continue;

    const isWaived = waiverLookup.isWaived(control.id, node.id);
    const status: ViolationStatus = isWaived ? "waived" : "open";

    violations.push({
      controlId: control.id,
      controlTitle: control.title,
      framework: control.id.split("-")[0] as FrameworkId,
      resourceNodeId: node.id,
      resourceName: node.name,
      resourceType: node.resourceType,
      severity: control.severity,
      description: control.description,
      remediation: control.remediation,
      status,
      detectedAt: new Date().toISOString(),
    });
  }

  return violations;
}
