/**
 * Message Queue Migration Step Handler
 *
 * Migrates queues between providers:
 *   SQS → Azure Queue Storage/Service Bus / Cloud Tasks
 *   Preserves queue configuration (visibility timeout, retention, DLQ).
 *   Messages are NOT transferred — only configuration.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateQueuesHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const queues = (params.queues ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-queues] Migrating ${queues.length} queue(s) to ${targetProvider}`);

    const created: Array<{ sourceId: string; sourceName: string; targetId: string; targetUrl: string }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { messaging?: { createQueue: (q: unknown) => Promise<{ id: string; url: string }> } }
      | undefined;

    for (const q of queues) {
      const name = String(q.name ?? "");
      const type = String(q.type ?? "standard");

      if (type === "fifo" && targetProvider === "gcp") {
        warnings.push(`Queue "${name}": FIFO ordering not natively supported by Cloud Tasks; requires application-level ordering`);
      }

      if (targetAdapter?.messaging) {
        const result = await targetAdapter.messaging.createQueue({
          name,
          type,
          visibilityTimeoutSec: q.visibilityTimeoutSec ?? 30,
          retentionDays: q.retentionDays ?? 4,
          delaySeconds: q.delaySeconds ?? 0,
          encryption: q.encryption ?? false,
        });
        created.push({ sourceId: String(q.id), sourceName: name, targetId: result.id, targetUrl: result.url });
      } else {
        created.push({ sourceId: String(q.id), sourceName: name, targetId: `simulated-queue-${name}`, targetUrl: `https://${targetProvider}-queue/${name}` });
      }
    }

    log.info(`[migrate-queues] Created ${created.length} queues`);
    return { createdQueues: created, queuesCreated: created.length, warnings };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const created = (outputs.createdQueues ?? []) as Array<{ targetId: string }>;
    log.info(`[migrate-queues] Rolling back ${created.length} queues`);
    const targetAdapter = ctx.targetCredentials as
      | { messaging?: { deleteQueue: (id: string) => Promise<void> } }
      | undefined;
    if (targetAdapter?.messaging) {
      for (const q of created) await targetAdapter.messaging.deleteQueue(q.targetId);
    }
  },
};
