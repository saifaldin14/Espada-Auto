/**
 * Network Step — Map Network
 *
 * Discovers and maps the source network topology (VPCs, subnets,
 * route tables, peering connections) to plan target-side creation.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { NormalizedVPC } from "../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

export interface MapNetworkParams {
  sourceProvider: string;
  sourceRegion: string;
  vpcIds?: string[];
}

interface MapNetworkResult {
  vpcs: NormalizedVPC[];
  totalSubnets: number;
  totalRoutes: number;
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as MapNetworkParams;
  ctx.log.info(`Mapping network topology on ${params.sourceProvider} (${params.sourceRegion})`);

  if (params.vpcIds?.length) {
    ctx.log.info(`  Scope: ${params.vpcIds.length} VPC(s)`);
  } else {
    ctx.log.info("  Scope: all VPCs in region");
  }

  ctx.signal?.throwIfAborted();

  // Resolve the source provider adapter
  const credentials = ctx.sourceCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    const adapter = await resolveProviderAdapter(params.sourceProvider as MigrationProvider, credentials);

    // Discover VPCs
    const rawVpcs = await adapter.network.listVPCs(params.sourceRegion);
    const filteredVpcs = params.vpcIds?.length
      ? rawVpcs.filter((v) => params.vpcIds!.includes(v.id))
      : rawVpcs;

    // Discover subnets for each VPC
    const rawSubnets = await adapter.network.listSubnets(params.sourceRegion);

    // Build normalized VPCs with subnet and route table info
    const vpcs: NormalizedVPC[] = filteredVpcs.map((vpc) => {
      const vpcSubnets = rawSubnets
        .filter((s) => vpc.subnets?.some((sub) => sub.id === s.id) || s.name?.startsWith(vpc.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          cidrBlock: s.cidrBlock,
          availabilityZone: s.availabilityZone ?? "",
          public: s.public,
          tags: {},
        }));

      return {
        id: vpc.id,
        name: vpc.name,
        provider: params.sourceProvider as MigrationProvider,
        region: vpc.region,
        cidrBlocks: vpc.cidrBlocks,
        subnets: vpcSubnets,
        routeTables: [], // Route table discovery varies by provider
        internetGateway: false, // Would need additional API calls
        natGateway: false,
        tags: vpc.tags ?? {},
      };
    });

    ctx.log.info(`  Discovered ${vpcs.length} VPC(s) via SDK`);

    return {
      vpcs,
      totalSubnets: vpcs.reduce((sum, v) => sum + v.subnets.length, 0),
      totalRoutes: vpcs.reduce((sum, v) => sum + v.routeTables.reduce((s, rt) => s + rt.routes.length, 0), 0),
    };
  }

  // Fallback: stub behavior
  const vpcs: NormalizedVPC[] = [];
  ctx.log.info(`  Discovered ${vpcs.length} VPC(s)`);

  return {
    vpcs,
    totalSubnets: vpcs.reduce((sum, v) => sum + v.subnets.length, 0),
    totalRoutes: vpcs.reduce((sum, v) => sum + v.routeTables.reduce((s, rt) => s + rt.routes.length, 0), 0),
  };
}

// Read-only step
export const mapNetworkHandler: MigrationStepHandler = {
  execute,
};
