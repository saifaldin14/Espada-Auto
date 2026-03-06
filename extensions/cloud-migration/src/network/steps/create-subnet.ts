/**
 * Subnet Creation Step Handler
 *
 * Creates individual subnets within an already-created VPC.
 * Handles public/private subnet designation and AZ distribution.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const createSubnetHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const vpcId = String(params.vpcId ?? "");
    const subnets = (params.subnets ?? []) as Array<Record<string, unknown>>;

    log.info(`[create-subnet] Creating ${subnets.length} subnets in VPC ${vpcId} on ${targetProvider}`);

    const createdSubnets: Array<{
      sourceId: string;
      targetId: string;
      cidrBlock: string;
      public: boolean;
    }> = [];

    const targetAdapter = ctx.targetCredentials as
      | { network?: { createSubnet: (p: unknown) => Promise<{ id: string }> } }
      | undefined;

    for (const subnet of subnets) {
      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createSubnet({
          vpcId,
          name: String(subnet.name ?? ""),
          cidrBlock: String(subnet.cidrBlock ?? ""),
          availabilityZone: String(subnet.availabilityZone ?? ""),
          public: Boolean(subnet.public),
          tags: subnet.tags,
        });
        createdSubnets.push({
          sourceId: String(subnet.id ?? ""),
          targetId: result.id,
          cidrBlock: String(subnet.cidrBlock ?? ""),
          public: Boolean(subnet.public),
        });
      } else {
        createdSubnets.push({
          sourceId: String(subnet.id ?? ""),
          targetId: `simulated-subnet-${subnet.name}`,
          cidrBlock: String(subnet.cidrBlock ?? ""),
          public: Boolean(subnet.public),
        });
      }
    }

    log.info(`[create-subnet] Created ${createdSubnets.length} subnets`);

    return {
      createdSubnets,
      subnetsCreated: createdSubnets.length,
      subnetMapping: Object.fromEntries(createdSubnets.map((s) => [s.sourceId, s.targetId])),
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const createdSubnets = (outputs.createdSubnets ?? []) as Array<{ targetId: string }>;

    log.info(`[create-subnet] Rolling back ${createdSubnets.length} subnets`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteSubnet: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const subnet of createdSubnets) {
        await targetAdapter.network.deleteSubnet(subnet.targetId);
      }
    }

    log.info("[create-subnet] Rollback complete");
  },
};
