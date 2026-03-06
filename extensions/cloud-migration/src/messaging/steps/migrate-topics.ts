/**
 * Notification Topic Migration Step Handler
 *
 * Migrates topics (SNS → Event Grid/Pub/Sub) and their subscriptions.
 * Messages are NOT transferred — only topic configuration + subscriptions.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateTopicsHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const topics = (params.topics ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-topics] Migrating ${topics.length} topic(s) to ${targetProvider}`);

    const created: Array<{ sourceId: string; sourceName: string; targetId: string; subscriptionsMigrated: number }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { messaging?: { createTopic: (t: unknown) => Promise<{ id: string; arn?: string }> } }
      | undefined;

    for (const t of topics) {
      const name = String(t.name ?? "");
      const subscriptions = (t.subscriptions ?? []) as Array<Record<string, unknown>>;

      // Check subscription protocol compatibility
      for (const sub of subscriptions) {
        const proto = String(sub.protocol ?? "");
        if (proto === "sqs" && targetProvider !== "aws") {
          warnings.push(`Topic "${name}": SQS subscription must be translated to ${targetProvider} queue trigger`);
        }
        if (proto === "lambda" && targetProvider !== "aws") {
          warnings.push(`Topic "${name}": Lambda subscription must be translated to ${targetProvider} function trigger`);
        }
      }

      if (targetAdapter?.messaging) {
        const result = await targetAdapter.messaging.createTopic({
          name,
          subscriptions: subscriptions.map((s) => translateSubscription(s, targetProvider)),
          encryption: t.encryption ?? false,
        });
        created.push({ sourceId: String(t.id), sourceName: name, targetId: result.id, subscriptionsMigrated: subscriptions.length });
      } else {
        created.push({ sourceId: String(t.id), sourceName: name, targetId: `simulated-topic-${name}`, subscriptionsMigrated: subscriptions.length });
      }
    }

    log.info(`[migrate-topics] Created ${created.length} topics`);
    return { createdTopics: created, topicsCreated: created.length, warnings };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const created = (outputs.createdTopics ?? []) as Array<{ targetId: string }>;
    log.info(`[migrate-topics] Rolling back ${created.length} topics`);
    const targetAdapter = ctx.targetCredentials as
      | { messaging?: { deleteTopic: (id: string) => Promise<void> } }
      | undefined;
    if (targetAdapter?.messaging) {
      for (const t of created) await targetAdapter.messaging.deleteTopic(t.targetId);
    }
  },
};

function translateSubscription(sub: Record<string, unknown>, targetProvider: string): Record<string, unknown> {
  const PROTOCOL_MAP: Record<string, Record<string, string>> = {
    azure: { sqs: "storage-queue", lambda: "azure-function", http: "webhook", https: "webhook" },
    gcp: { sqs: "cloud-tasks", lambda: "cloud-function", http: "push", https: "push" },
  };
  const protocol = String(sub.protocol ?? "https");
  const mapped = PROTOCOL_MAP[targetProvider]?.[protocol] ?? protocol;
  return { ...sub, protocol: mapped };
}
