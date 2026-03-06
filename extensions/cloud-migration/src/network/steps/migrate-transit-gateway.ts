/**
 * Network Step — Migrate Transit Gateway
 *
 * Migrates transit gateways to the target provider
 * (Azure Virtual WAN Hub / GCP Cloud Router).
 * Handles:
 *   - Transit gateway creation with ASN configuration
 *   - Route table migration
 *   - Attachment cataloging
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Maps source attachment types to target equivalents. */
const ATTACHMENT_TYPE_MAP: Record<string, Record<string, string>> = {
  azure: {
    vpc: "vnet-connection",
    vpn: "vpn-connection",
    "direct-connect": "expressroute-connection",
    peering: "peering", // Cannot be auto-migrated
    "connect-peer": "bgp-connection",
  },
  gcp: {
    vpc: "router-interface",
    vpn: "vpn-tunnel",
    "direct-connect": "interconnect-attachment",
    peering: "peering", // Cannot be auto-migrated
    "connect-peer": "router-peer",
  },
};

export const migrateTransitGatewayHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-transit-gateway] Migrating transit gateways → ${targetProvider}`);

    const transitGateways = (params.transitGateways ?? []) as Array<{
      id: string;
      name: string;
      asnNumber: number;
      attachments: Array<{
        id: string;
        type: string;
        resourceId: string;
        state: string;
      }>;
      routeTables: Array<{
        id: string;
        name: string;
        routes: Array<{ cidr: string; attachmentId: string; type: string }>;
      }>;
      region: string;
      tags?: Record<string, string>;
    }>;

    const migratedGateways: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetArn?: string;
      asnNumber: number;
      attachmentsCatalogued: number;
      routeTablesMigrated: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          network?: {
            createTransitGateway: (gw: unknown) => Promise<{ id: string; arn?: string }>;
            deleteTransitGateway: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const gw of transitGateways) {
      const name = String(gw.name ?? "");
      const peeringAttachments = (gw.attachments ?? []).filter((a) => a.type === "peering");

      if (peeringAttachments.length > 0) {
        warnings.push(
          `Transit gateway "${name}": ${peeringAttachments.length} peering attachment(s) cannot be auto-migrated; ` +
            `manual configuration required on ${targetProvider}`,
        );
      }

      if (gw.routeTables && gw.routeTables.length > 0) {
        warnings.push(
          `Transit gateway "${name}": ${gw.routeTables.length} route table(s) need manual verification after migration`,
        );
      }

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createTransitGateway({
          name,
          asnNumber: gw.asnNumber,
          attachments: (gw.attachments ?? []).map((a) => ({
            ...a,
            type: translateAttachmentType(a.type, targetProvider),
          })),
          routeTables: gw.routeTables,
          region: gw.region,
          tags: gw.tags,
        });

        migratedGateways.push({
          sourceId: gw.id,
          sourceName: name,
          targetId: result.id,
          targetArn: result.arn,
          asnNumber: gw.asnNumber,
          attachmentsCatalogued: gw.attachments?.length ?? 0,
          routeTablesMigrated: gw.routeTables?.length ?? 0,
        });
      } else {
        migratedGateways.push({
          sourceId: gw.id,
          sourceName: name,
          targetId: `simulated-tgw-${name}`,
          asnNumber: gw.asnNumber,
          attachmentsCatalogued: gw.attachments?.length ?? 0,
          routeTablesMigrated: gw.routeTables?.length ?? 0,
        });
      }
    }

    log.info(`[migrate-transit-gateway] Migrated ${migratedGateways.length} transit gateway(s)`);

    return {
      migratedGateways,
      gatewaysCount: migratedGateways.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedGateways = (outputs.migratedGateways ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-transit-gateway] Rolling back ${migratedGateways.length} transit gateway(s)`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteTransitGateway: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const gw of migratedGateways) {
        await targetAdapter.network.deleteTransitGateway(gw.targetId);
      }
    }

    log.info("[migrate-transit-gateway] Rollback complete");
  },
};

function translateAttachmentType(type: string, targetProvider: string): string {
  const map = ATTACHMENT_TYPE_MAP[targetProvider];
  if (!map) return type;
  return map[type] ?? type;
}
