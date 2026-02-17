/**
 * Azure Activity Log Manager — Audit trail for Azure resource operations
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import { withAzureRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

export type ActivityLogEntry = {
  id: string;
  operationName: string;
  status: string;
  caller: string;
  timestamp: string;
  resourceId?: string;
  resourceGroup?: string;
  level: string;
  description?: string;
  correlationId?: string;
  subscriptionId?: string;
};

export type ActivityLogFilter = {
  resourceGroup?: string;
  resourceId?: string;
  startTime?: Date;
  endTime?: Date;
  status?: string;
  caller?: string;
  maxResults?: number;
};

// =============================================================================
// Activity Log Manager
// =============================================================================

export class AzureActivityLogManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
  }

  /**
   * Query activity log events.
   */
  async getEvents(filter?: ActivityLogFilter): Promise<ActivityLogEntry[]> {
    const { credential } = await this.credentialsManager.getCredential();

    const { MonitorClient } = await import("@azure/arm-monitor");
    const client = new MonitorClient(credential, this.subscriptionId);

    return withAzureRetry(async () => {
      const events: ActivityLogEntry[] = [];
      const now = new Date();
      const startTime = filter?.startTime ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const endTime = filter?.endTime ?? now;

      let filterStr = `eventTimestamp ge '${startTime.toISOString()}' and eventTimestamp le '${endTime.toISOString()}'`;
      if (filter?.resourceGroup) {
        filterStr += ` and resourceGroupName eq '${filter.resourceGroup}'`;
      }
      if (filter?.status) {
        filterStr += ` and status eq '${filter.status}'`;
      }

      for await (const event of client.activityLogs.list(filterStr)) {
        if (filter?.maxResults && events.length >= filter.maxResults) break;

        events.push({
          id: event.id ?? "",
          operationName: event.operationName?.localizedValue ?? event.operationName?.value ?? "",
          status: event.status?.localizedValue ?? event.status?.value ?? "",
          caller: event.caller ?? "",
          timestamp: event.eventTimestamp?.toISOString() ?? "",
          resourceId: event.resourceId,
          resourceGroup: event.resourceGroupName,
          level: event.level?.toString() ?? "",
          description: event.description,
          correlationId: event.correlationId,
          subscriptionId: event.subscriptionId,
        });
      }

      return events;
    });
  }

  /**
   * Get recent operations for a specific resource.
   */
  async getResourceOperations(resourceId: string, hours = 24): Promise<ActivityLogEntry[]> {
    return this.getEvents({
      resourceId,
      startTime: new Date(Date.now() - hours * 60 * 60 * 1000),
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createActivityLogManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
): AzureActivityLogManager {
  return new AzureActivityLogManager(credentialsManager, subscriptionId);
}
