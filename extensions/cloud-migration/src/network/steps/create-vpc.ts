/**
 * VPC Creation Step Handler
 *
 * Creates VPC/VNet infrastructure on the target provider to mirror
 * the source network topology. This is a critical step that must
 * run before VM provisioning and security rule creation.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const createVPCHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const targetRegion = (params.targetRegion ?? ctx.globalParams.targetRegion) as string;

    const vpcs = (params.sourceVPCs ?? []) as Array<Record<string, unknown>>;

    log.info(`[create-vpc] Creating ${vpcs.length} VPC(s) on ${targetProvider} in ${targetRegion}`);

    const createdVPCs: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetName: string;
      cidrBlock: string;
      subnetsCreated: number;
    }> = [];

    const targetAdapter = ctx.targetCredentials as
      | { network?: {
          createVPC: (p: unknown) => Promise<{ id: string; name: string; cidrBlocks: string[] }>;
          createSubnet: (p: unknown) => Promise<{ id: string }>;
          createRouteTable?: (p: unknown) => Promise<{ id: string }>;
        } }
      | undefined;

    for (const vpc of vpcs) {
      const name = String(vpc.name ?? "migrated-vpc");
      const cidrBlocks = (vpc.cidrBlocks ?? [vpc.cidrBlock ?? "10.0.0.0/16"]) as string[];
      const subnets = (vpc.subnets ?? []) as Array<Record<string, unknown>>;

      if (targetAdapter?.network) {
        const created = await targetAdapter.network.createVPC({
          name: `${name}-migrated`,
          cidrBlock: cidrBlocks[0],
          region: targetRegion,
          enableDnsHostnames: true,
          enableInternetGateway: Boolean(vpc.internetGateway),
          tags: { ...(vpc.tags as Record<string, string> ?? {}), "migration-source": String(vpc.id) },
        });

        // Create subnets within the VPC
        let subnetCount = 0;
        for (const subnet of subnets) {
          await targetAdapter.network.createSubnet({
            vpcId: created.id,
            name: String(subnet.name ?? `subnet-${subnetCount}`),
            cidrBlock: String(subnet.cidrBlock ?? ""),
            availabilityZone: String(subnet.availabilityZone ?? ""),
            public: Boolean(subnet.public),
          });
          subnetCount++;
        }

        createdVPCs.push({
          sourceId: String(vpc.id),
          sourceName: name,
          targetId: created.id,
          targetName: `${name}-migrated`,
          cidrBlock: cidrBlocks[0],
          subnetsCreated: subnetCount,
        });
      } else {
        createdVPCs.push({
          sourceId: String(vpc.id),
          sourceName: name,
          targetId: `simulated-vpc-${name}`,
          targetName: `${name}-migrated`,
          cidrBlock: cidrBlocks[0],
          subnetsCreated: subnets.length,
        });
      }
    }

    log.info(`[create-vpc] Created ${createdVPCs.length} VPCs with subnets`);

    return {
      createdVPCs,
      vpcsCreated: createdVPCs.length,
      totalSubnetsCreated: createdVPCs.reduce((s, v) => s + v.subnetsCreated, 0),
      vpcMapping: Object.fromEntries(createdVPCs.map((v) => [v.sourceId, v.targetId])),
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const createdVPCs = (outputs.createdVPCs ?? []) as Array<{ targetId: string }>;

    log.info(`[create-vpc] Rolling back ${createdVPCs.length} VPCs`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteVPC: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      // Delete in reverse order (VPCs last, subnets first)
      for (const vpc of createdVPCs.reverse()) {
        await targetAdapter.network.deleteVPC(vpc.targetId);
      }
    }

    log.info("[create-vpc] Rollback complete");
  },
};
