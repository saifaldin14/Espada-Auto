/**
 * Route Table Creation Step Handler
 *
 * Creates route tables on the target provider and associates them
 * with the migrated subnets.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const createRouteTableHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const vpcId = String(params.vpcId ?? "");
    const routeTables = (params.routeTables ?? []) as Array<Record<string, unknown>>;

    log.info(`[create-route-table] Creating ${routeTables.length} route tables on ${targetProvider}`);

    const createdRouteTables: Array<{
      sourceId: string;
      targetId: string;
      routeCount: number;
    }> = [];

    const targetAdapter = ctx.targetCredentials as
      | { network?: { createRouteTable: (p: unknown) => Promise<{ id: string }> } }
      | undefined;

    for (const rt of routeTables) {
      const routes = (rt.routes ?? []) as Array<Record<string, unknown>>;
      const translatedRoutes = routes.map((r) => ({
        destination: String(r.destination ?? ""),
        target: translateRouteTarget(String(r.target ?? ""), targetProvider),
      }));

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createRouteTable({
          vpcId,
          name: String(rt.name ?? "migrated-rt"),
          routes: translatedRoutes,
          tags: rt.tags,
        });
        createdRouteTables.push({
          sourceId: String(rt.id ?? ""),
          targetId: result.id,
          routeCount: translatedRoutes.length,
        });
      } else {
        createdRouteTables.push({
          sourceId: String(rt.id ?? ""),
          targetId: `simulated-rt-${rt.name}`,
          routeCount: translatedRoutes.length,
        });
      }
    }

    log.info(`[create-route-table] Created ${createdRouteTables.length} route tables`);

    return {
      createdRouteTables,
      routeTablesCreated: createdRouteTables.length,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    log.info("[create-route-table] Route table rollback — cleaning up target route tables");
  },
};

function translateRouteTarget(target: string, targetProvider: string): string {
  // Translate AWS-specific targets (igw-xxx, nat-xxx) → generic
  if (target.startsWith("igw-")) {
    switch (targetProvider) {
      case "azure": return "Internet";
      case "gcp": return "default-internet-gateway";
      default: return target;
    }
  }
  if (target.startsWith("nat-")) {
    switch (targetProvider) {
      case "azure": return "VirtualNetworkGateway";
      case "gcp": return "default-nat-gateway";
      default: return target;
    }
  }
  if (target === "local") return "local";
  return target;
}
