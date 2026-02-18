/**
 * Plan formatter — formats IaC plan output as Markdown for PR comments.
 */

export interface PlanAction {
  action: "create" | "update" | "delete" | "replace";
  resource: string;
  type: string;
}

export interface PlanCommentInput {
  actions: PlanAction[];
  policyResult?: { passed: boolean; evaluated: number; violations: string[] };
  costDelta?: { current: number; projected: number; delta: number };
}

/**
 * Format a plan summary as a Markdown PR comment.
 */
export function formatPlanComment(input: PlanCommentInput): string {
  const lines: string[] = [];

  lines.push("## Terraform Plan");
  lines.push("");

  if (input.actions.length === 0) {
    lines.push("No changes detected.");
    return lines.join("\n");
  }

  // Action table
  lines.push("| Action | Resource | Type |");
  lines.push("|--------|----------|------|");

  for (const a of input.actions) {
    const symbol = actionSymbol(a.action);
    lines.push(`| ${symbol} ${capitalize(a.action)} | ${a.resource} | ${a.type} |`);
  }

  lines.push("");

  // Summary
  const creates = input.actions.filter((a) => a.action === "create").length;
  const updates = input.actions.filter((a) => a.action === "update").length;
  const deletes = input.actions.filter((a) => a.action === "delete").length;
  const replaces = input.actions.filter((a) => a.action === "replace").length;

  const parts: string[] = [];
  if (creates) parts.push(`${creates} to create`);
  if (updates) parts.push(`${updates} to update`);
  if (deletes) parts.push(`${deletes} to destroy`);
  if (replaces) parts.push(`${replaces} to replace`);

  lines.push(`**Summary**: ${parts.join(", ")}`);

  // Cost delta
  if (input.costDelta) {
    const sign = input.costDelta.delta >= 0 ? "+" : "";
    lines.push(`**Estimated cost change**: ${sign}$${input.costDelta.delta.toFixed(2)}/month`);
  }

  lines.push("");

  // Policy result
  if (input.policyResult) {
    const icon = input.policyResult.passed ? "✅" : "❌";
    const label = input.policyResult.passed ? "PASSED" : "FAILED";
    lines.push(`${icon} Policy check: ${label} (${input.policyResult.evaluated} policies evaluated)`);

    if (input.policyResult.violations.length > 0) {
      lines.push("");
      lines.push("**Violations:**");
      for (const v of input.policyResult.violations) {
        lines.push(`- ${v}`);
      }
    }
  }

  return lines.join("\n");
}

function actionSymbol(action: string): string {
  switch (action) {
    case "create": return "+";
    case "update": return "~";
    case "delete": return "-";
    case "replace": return "±";
    default: return "?";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
