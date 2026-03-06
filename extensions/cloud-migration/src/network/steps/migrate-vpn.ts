/**
 * Network Step — Migrate VPN
 *
 * Migrates VPN connections (site-to-site and client VPN) to the target
 * provider (Azure VPN Gateway / GCP Cloud VPN).
 * Handles:
 *   - Site-to-site tunnel configuration
 *   - Static route migration
 *   - BGP configuration translation
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** VPN type mapping across providers. */
const VPN_TYPE_MAP: Record<string, Record<string, string>> = {
  azure: {
    "site-to-site": "VpnSite",
    client: "P2SVpnGateway",
  },
  gcp: {
    "site-to-site": "CLASSIC_VPN",
    client: "HA_VPN",
  },
};

export const migrateVPNHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-vpn] Migrating VPN connections → ${targetProvider}`);

    const vpnConnections = (params.vpnConnections ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      customerGatewayIp: string;
      customerGatewayAsn: number;
      tunnels: Array<{
        outsideIp: string;
        insideCidr: string;
        preSharedKey?: string;
        status: string;
      }>;
      staticRoutes: Array<{ destinationCidr: string }>;
      bgpEnabled: boolean;
      transitGatewayId?: string;
      tags?: Record<string, string>;
    }>;

    const migratedVPNs: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      sourceType: string;
      targetType: string;
      tunnelCount: number;
      bgpEnabled: boolean;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          network?: {
            createVPNConnection: (vpn: unknown) => Promise<{ id: string }>;
            deleteVPNConnection: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const vpn of vpnConnections) {
      const name = String(vpn.name ?? "");
      const sourceType = String(vpn.type ?? "site-to-site");
      const targetType = translateVPNType(sourceType, targetProvider);

      // Pre-shared keys cannot be transferred — they need re-negotiation
      const tunnelsWithKeys = (vpn.tunnels ?? []).filter((t) => t.preSharedKey);
      if (tunnelsWithKeys.length > 0) {
        warnings.push(
          `VPN "${name}": ${tunnelsWithKeys.length} tunnel(s) have pre-shared keys that must be re-negotiated with the remote peer`,
        );
      }

      // BGP ASN coordination
      if (vpn.bgpEnabled) {
        warnings.push(
          `VPN "${name}": BGP is enabled with ASN ${vpn.customerGatewayAsn}; ` +
            `ASN must be coordinated with network team for ${targetProvider}`,
        );
      }

      // Client VPN requires certificate re-issuance
      if (sourceType === "client") {
        warnings.push(
          `VPN "${name}": client VPN requires certificate re-issuance on ${targetProvider}`,
        );
      }

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createVPNConnection({
          name,
          type: targetType,
          customerGatewayIp: vpn.customerGatewayIp,
          customerGatewayAsn: vpn.customerGatewayAsn,
          tunnels: (vpn.tunnels ?? []).map((t) => ({
            outsideIp: t.outsideIp,
            insideCidr: t.insideCidr,
            status: t.status,
            // Pre-shared key intentionally omitted — must be re-negotiated
          })),
          staticRoutes: vpn.staticRoutes,
          bgpEnabled: vpn.bgpEnabled,
          transitGatewayId: vpn.transitGatewayId,
          tags: vpn.tags,
        });

        migratedVPNs.push({
          sourceId: vpn.id,
          sourceName: name,
          targetId: result.id,
          sourceType,
          targetType,
          tunnelCount: vpn.tunnels?.length ?? 0,
          bgpEnabled: vpn.bgpEnabled,
        });
      } else {
        migratedVPNs.push({
          sourceId: vpn.id,
          sourceName: name,
          targetId: `simulated-vpn-${name}`,
          sourceType,
          targetType,
          tunnelCount: vpn.tunnels?.length ?? 0,
          bgpEnabled: vpn.bgpEnabled,
        });
      }
    }

    log.info(`[migrate-vpn] Migrated ${migratedVPNs.length} VPN connection(s)`);

    return {
      migratedVPNs,
      vpnCount: migratedVPNs.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedVPNs = (outputs.migratedVPNs ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-vpn] Rolling back ${migratedVPNs.length} VPN connection(s)`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteVPNConnection: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const vpn of migratedVPNs) {
        await targetAdapter.network.deleteVPNConnection(vpn.targetId);
      }
    }

    log.info("[migrate-vpn] Rollback complete");
  },
};

function translateVPNType(type: string, targetProvider: string): string {
  const map = VPN_TYPE_MAP[targetProvider];
  if (!map) return type;
  return map[type] ?? type;
}
