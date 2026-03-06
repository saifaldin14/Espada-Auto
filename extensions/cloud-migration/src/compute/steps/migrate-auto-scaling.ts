/**
 * Auto Scaling Group Migration Step Handler
 *
 * Migrates auto scaling configurations:
 *   AWS ASG → Azure VMSS / GCP Managed Instance Group
 *
 * Translates scaling policies, health checks, and launch templates.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateAutoScalingHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const groups = (params.groups ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-auto-scaling] Migrating ${groups.length} auto scaling group(s) to ${targetProvider}`);

    const migrated: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetType: string;
      minSize: number;
      maxSize: number;
      desiredSize: number;
      policiesTranslated: number;
    }> = [];
    const warnings: string[] = [];

    const TARGET_TYPE_MAP: Record<string, string> = {
      azure: "Virtual Machine Scale Set (VMSS)",
      gcp: "Managed Instance Group (MIG)",
      "on-premises": "Kubernetes Horizontal Pod Autoscaler",
    };

    for (const group of groups) {
      const name = String(group.name ?? "");
      const minSize = Number(group.minSize ?? 1);
      const maxSize = Number(group.maxSize ?? 4);
      const desiredSize = Number(group.desiredSize ?? 2);
      const policies = (group.scalingPolicies ?? []) as Array<Record<string, unknown>>;
      const targetType = TARGET_TYPE_MAP[targetProvider] ?? "Auto Scaling Group";

      // Translate scaling policies
      const translatedPolicies = policies.map((p) => translateScalingPolicy(p, targetProvider));

      // Check target group dependencies
      const targetGroupArns = (group.targetGroupArns ?? []) as string[];
      if (targetGroupArns.length > 0) {
        warnings.push(
          `ASG "${name}": Has ${targetGroupArns.length} target group association(s); ` +
          `ensure load balancer migration completes before ASG attachment`,
        );
      }

      migrated.push({
        sourceId: String(group.id ?? ""),
        sourceName: name,
        targetId: `simulated-asg-${name}`,
        targetType,
        minSize,
        maxSize,
        desiredSize,
        policiesTranslated: translatedPolicies.length,
      });
    }

    log.info(`[migrate-auto-scaling] Migrated ${migrated.length} auto scaling groups`);

    return {
      migratedGroups: migrated,
      groupsCount: migrated.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    log.info("[migrate-auto-scaling] Rollback — target auto scaling groups should be deleted");
  },
};

function translateScalingPolicy(policy: Record<string, unknown>, targetProvider: string): Record<string, unknown> {
  const type = String(policy.type ?? "target-tracking");
  const metric = String(policy.metric ?? "CPUUtilization");

  const METRIC_MAP: Record<string, Record<string, string>> = {
    azure: {
      CPUUtilization: "Percentage CPU",
      NetworkIn: "Network In Total",
      NetworkOut: "Network Out Total",
      DiskReadOps: "Disk Read Operations/Sec",
    },
    gcp: {
      CPUUtilization: "compute.googleapis.com/instance/cpu/utilization",
      NetworkIn: "compute.googleapis.com/instance/network/received_bytes_count",
      NetworkOut: "compute.googleapis.com/instance/network/sent_bytes_count",
    },
  };

  const POLICY_TYPE_MAP: Record<string, Record<string, string>> = {
    azure: { "target-tracking": "PercentileBased", step: "StepScaling", simple: "BasicScaling" },
    gcp: { "target-tracking": "TARGET_CPU_UTILIZATION", step: "STEP", simple: "FIXED" },
  };

  return {
    ...policy,
    type: POLICY_TYPE_MAP[targetProvider]?.[type] ?? type,
    metric: METRIC_MAP[targetProvider]?.[metric] ?? metric,
  };
}
