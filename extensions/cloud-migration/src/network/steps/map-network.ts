/**
 * Network Step — Map Network
 *
 * Discovers and maps the source network topology (VPCs, subnets,
 * route tables, peering connections) to plan target-side creation.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import type { NormalizedVPC } from "../types.js";

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

  // In real impl: query provider API to discover VPCs, subnets, route tables
  // AWS: ec2.DescribeVpcs, DescribeSubnets, DescribeRouteTables
  // Azure: network.virtualNetworks.list
  // GCP: compute.networks.list, compute.subnetworks.list

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
