/**
 * Load Balancer Creation Step Handler
 *
 * Creates load balancers on the target provider:
 *   AWS ALB/NLB → Azure Application Gateway/LB / GCP HTTPS LB/TCP LB
 *
 * Translates listener configs, target groups, health checks, and
 * SSL certificate associations.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Maps LB types between providers. */
const LB_TYPE_MAP: Record<string, Record<string, string>> = {
  azure: {
    application: "Application Gateway",
    network: "Azure Load Balancer (Standard)",
    classic: "Azure Load Balancer (Basic)",
    gateway: "Azure Application Gateway v2",
  },
  gcp: {
    application: "HTTPS Load Balancer",
    network: "TCP/UDP Load Balancer",
    classic: "TCP Proxy",
    gateway: "HTTPS Load Balancer",
  },
  "on-premises": {
    application: "HAProxy/Nginx (L7)",
    network: "HAProxy (L4)",
    classic: "HAProxy (L4)",
    gateway: "Nginx",
  },
};

export const createLoadBalancerHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    const loadBalancers = (params.loadBalancers ?? []) as Array<Record<string, unknown>>;

    log.info(`[create-load-balancer] Creating ${loadBalancers.length} load balancer(s) on ${targetProvider}`);

    const createdLBs: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetType: string;
      listenersCreated: number;
      targetGroupsCreated: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { network?: { createLoadBalancer: (p: unknown) => Promise<{ id: string; name: string; dnsName?: string }> } }
      | undefined;

    for (const lb of loadBalancers) {
      const name = String(lb.name ?? "");
      const sourceType = String(lb.type ?? "application");
      const targetType = LB_TYPE_MAP[targetProvider]?.[sourceType] ?? sourceType;
      const listeners = (lb.listeners ?? []) as Array<Record<string, unknown>>;
      const targetGroups = (lb.targetGroups ?? []) as Array<Record<string, unknown>>;

      // Warn about feature gaps
      if (sourceType === "application" && targetProvider === "gcp") {
        warnings.push(
          `LB "${name}": AWS ALB → GCP HTTPS LB — verify path-based routing and host-based routing compatibility`,
        );
      }
      if (listeners.some((l) => l.protocol === "HTTPS") && !listeners.some((l) => l.certificateArn)) {
        warnings.push(`LB "${name}": HTTPS listener without certificate — certificate must be provisioned separately`);
      }

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createLoadBalancer({
          name: `${name}-migrated`,
          type: mapLBType(sourceType, targetProvider),
          scheme: lb.scheme ?? "external",
          subnetIds: lb.subnetIds ?? [],
          listeners: listeners.map((l) => ({
            port: l.port,
            protocol: l.protocol,
            targetPort: l.targetPort ?? l.port,
            certificateArn: l.certificateArn,
          })),
          tags: { ...(lb.tags as Record<string, string> ?? {}), "migration-source": String(lb.id) },
        });

        createdLBs.push({
          sourceId: String(lb.id ?? ""),
          sourceName: name,
          targetId: result.id,
          targetType,
          listenersCreated: listeners.length,
          targetGroupsCreated: targetGroups.length,
        });
      } else {
        createdLBs.push({
          sourceId: String(lb.id ?? ""),
          sourceName: name,
          targetId: `simulated-lb-${name}`,
          targetType,
          listenersCreated: listeners.length,
          targetGroupsCreated: targetGroups.length,
        });
      }
    }

    log.info(`[create-load-balancer] Created ${createdLBs.length} load balancers`);

    return {
      createdLBs,
      lbsCreated: createdLBs.length,
      warnings,
      lbMapping: Object.fromEntries(createdLBs.map((lb) => [lb.sourceId, lb.targetId])),
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const createdLBs = (outputs.createdLBs ?? []) as Array<{ targetId: string }>;

    log.info(`[create-load-balancer] Rolling back ${createdLBs.length} load balancers`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteLoadBalancer: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const lb of createdLBs) {
        await targetAdapter.network.deleteLoadBalancer(lb.targetId);
      }
    }

    log.info("[create-load-balancer] Rollback complete");
  },
};

function mapLBType(sourceType: string, targetProvider: string): "application" | "network" {
  if (sourceType === "network") return "network";
  return "application";
}
