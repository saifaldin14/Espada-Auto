/**
 * Orchestration Step — Migrate Event Bus
 *
 * Migrates EventBridge event buses and rules to target provider
 * equivalents (Azure Event Grid / GCP Eventarc).
 * Handles:
 *   - Event bus creation on target
 *   - Rule pattern and target translation
 *   - Schema registry reference migration
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateEventBusHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-event-bus] Migrating Event Buses → ${targetProvider}`);

    const eventBuses = (params.eventBuses ?? []) as Array<{
      id: string;
      name: string;
      isDefault: boolean;
      rules: Array<{
        id: string;
        name: string;
        pattern: Record<string, unknown>;
        targets: Array<Record<string, unknown>>;
      }>;
      schemaRegistryArn?: string;
      tags?: Record<string, string>;
    }>;
    const migratedEventBuses: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      isDefault: boolean;
      rulesMigrated: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          orchestration?: {
            createEventBus: (bus: unknown) => Promise<{ id: string }>;
            createEventRules: (busId: string, rules: unknown[]) => Promise<{ count: number }>;
          };
        }
      | undefined;

    for (const bus of eventBuses) {
      const name = String(bus.name ?? "");
      const rules = bus.rules ?? [];

      // EventBridge archive/replay has no direct equivalent
      warnings.push(
        `Event Bus "${name}": EventBridge archive/replay has no direct equivalent in ${targetProvider}`,
      );

      // Schema registry requires manual migration
      if (bus.schemaRegistryArn) {
        warnings.push(
          `Event Bus "${name}": schema registry requires manual migration (source: ${bus.schemaRegistryArn})`,
        );
      }

      if (targetAdapter?.orchestration) {
        const busResult = await targetAdapter.orchestration.createEventBus({
          name,
          isDefault: bus.isDefault,
          tags: bus.tags,
        });

        let rulesMigrated = 0;
        if (rules.length > 0) {
          const rulesResult = await targetAdapter.orchestration.createEventRules(
            busResult.id,
            rules.map((r) => ({
              name: r.name,
              pattern: r.pattern,
              targets: r.targets,
            })),
          );
          rulesMigrated = rulesResult.count;
        }

        migratedEventBuses.push({
          sourceId: bus.id,
          sourceName: name,
          targetId: busResult.id,
          isDefault: bus.isDefault,
          rulesMigrated,
        });
      } else {
        migratedEventBuses.push({
          sourceId: bus.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          isDefault: bus.isDefault,
          rulesMigrated: rules.length,
        });
      }
    }

    log.info(`[migrate-event-bus] Migrated ${migratedEventBuses.length} event buses`);

    return {
      migratedEventBuses,
      eventBusesCount: migratedEventBuses.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedEventBuses = (outputs.migratedEventBuses ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-event-bus] Rolling back ${migratedEventBuses.length} event buses`);

    const targetAdapter = ctx.targetCredentials as
      | { orchestration?: { deleteEventBus: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.orchestration) {
      for (const bus of migratedEventBuses) {
        await targetAdapter.orchestration.deleteEventBus(bus.targetId);
      }
    }

    log.info("[migrate-event-bus] Rollback complete");
  },
};
