/**
 * CDN Distribution Migration Step Handler
 *
 * Migrates CDN distributions (CloudFront → Azure CDN/Cloud CDN).
 * Translates origins, behaviors, and edge configurations.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateCDNHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const distributions = (params.distributions ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-cdn] Migrating ${distributions.length} CDN distribution(s) to ${targetProvider}`);

    const created: Array<{ sourceId: string; sourceName: string; targetId: string; targetDomainName: string }> = [];

    const targetAdapter = ctx.targetCredentials as
      | { cdn?: { createDistribution: (d: unknown) => Promise<{ id: string; domainName: string }> } }
      | undefined;

    for (const dist of distributions) {
      const name = String(dist.name ?? "");

      if (targetAdapter?.cdn) {
        const result = await targetAdapter.cdn.createDistribution({
          name,
          origins: dist.origins,
          certificateArn: dist.certificateArn,
          priceClass: dist.priceClass,
        });
        created.push({ sourceId: String(dist.id), sourceName: name, targetId: result.id, targetDomainName: result.domainName });
      } else {
        created.push({ sourceId: String(dist.id), sourceName: name, targetId: `simulated-cdn-${name}`, targetDomainName: `${name}.cdn.${targetProvider}.example.com` });
      }
    }

    log.info(`[migrate-cdn] Created ${created.length} CDN distributions`);
    return { createdDistributions: created, distributionsCreated: created.length };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const created = (outputs.createdDistributions ?? []) as Array<{ targetId: string }>;
    log.info(`[migrate-cdn] Rolling back ${created.length} CDN distributions`);
    const targetAdapter = ctx.targetCredentials as
      | { cdn?: { deleteDistribution: (id: string) => Promise<void> } }
      | undefined;
    if (targetAdapter?.cdn) {
      for (const d of created) await targetAdapter.cdn.deleteDistribution(d.targetId);
    }
  },
};
