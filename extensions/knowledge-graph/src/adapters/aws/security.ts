/**
 * AWS Adapter — Security Domain Module
 *
 * Security posture assessment, GuardDuty findings, and CloudTrail-based
 * incremental change detection.
 */

import type { GraphNodeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import type { AwsChangeEvent, AwsIncrementalChanges, AwsSecurityPosture } from "./types.js";

/**
 * Get incremental infrastructure changes since a given time via CloudTrail.
 *
 * Returns changed resources as partial graph updates: creates, modifies,
 * and deletes detected from CloudTrail infrastructure events.
 */
export async function getIncrementalChanges(
  ctx: AwsAdapterContext,
  since: Date,
): Promise<AwsIncrementalChanges | null> {
  if (ctx.config.clientFactory) return null; // Not available in test mode

  const ct = await ctx.getCloudTrailManager();
  if (!ct) return null;

  try {
    const events = await (ct as {
      getInfrastructureEvents: (opts?: { startTime?: Date; endTime?: Date; maxResults?: number }) => Promise<Array<{
        eventId: string;
        eventName: string;
        eventTime: Date;
        eventSource: string;
        awsRegion: string;
        userIdentity: { type?: string; userName?: string; arn?: string };
        requestParameters?: Record<string, unknown>;
        responseElements?: Record<string, unknown>;
        errorCode?: string;
        resources?: Array<{ resourceType?: string; resourceName?: string }>;
      }>>;
    }).getInfrastructureEvents({
      startTime: since,
      endTime: new Date(),
      maxResults: 500,
    });

    const creates: AwsChangeEvent[] = [];
    const modifies: AwsChangeEvent[] = [];
    const deletes: AwsChangeEvent[] = [];

    for (const event of events) {
      if (event.errorCode) continue; // Skip failed actions

      const changeEvent: AwsChangeEvent = {
        eventId: event.eventId,
        eventName: event.eventName,
        eventTime: event.eventTime instanceof Date ? event.eventTime.toISOString() : String(event.eventTime),
        region: event.awsRegion,
        service: event.eventSource.replace(".amazonaws.com", ""),
        actor: event.userIdentity?.userName ?? event.userIdentity?.arn ?? "unknown",
        resources: event.resources?.map((r) => ({
          type: r.resourceType ?? "unknown",
          id: r.resourceName ?? "unknown",
        })) ?? [],
      };

      const name = event.eventName.toLowerCase();
      if (name.startsWith("create") || name.startsWith("run") || name.startsWith("launch")) {
        creates.push(changeEvent);
      } else if (name.startsWith("delete") || name.startsWith("terminate") || name.startsWith("remove")) {
        deletes.push(changeEvent);
      } else if (name.startsWith("modify") || name.startsWith("update") || name.startsWith("put") || name.startsWith("attach") || name.startsWith("detach")) {
        modifies.push(changeEvent);
      }
    }

    return { creates, modifies, deletes, since: since.toISOString(), until: new Date().toISOString() };
  } catch {
    return null;
  }
}

/**
 * Get security posture summary via SecurityManager.
 *
 * Collects IAM findings, Security Hub results, GuardDuty alerts, and
 * access analyzer findings. Returns null if SecurityManager is unavailable.
 */
export async function getSecurityPosture(
  ctx: AwsAdapterContext,
): Promise<AwsSecurityPosture | null> {
  if (ctx.config.clientFactory) return null; // Not available in test mode

  const sm = await ctx.getSecurityManager();
  if (!sm) return null;

  try {
    // Collect IAM roles for policy analysis
    const rolesResult = await (sm as {
      listRoles: (opts?: unknown) => Promise<{ success: boolean; data?: { roles: Array<{ roleName: string; arn: string; createDate?: string }> } }>;
    }).listRoles();

    // Collect security findings if Security Hub is enabled
    let securityFindings: Array<{ title: string; severity: string; resourceId?: string }> = [];
    try {
      const findingsResult = await (sm as {
        listSecurityFindings: (opts?: unknown) => Promise<{
          success: boolean;
          data?: { findings: Array<{ title: string; severity: string; resources?: Array<{ id?: string }> }> };
        }>;
      }).listSecurityFindings({ maxResults: 100 });

      if (findingsResult.success && findingsResult.data?.findings) {
        securityFindings = findingsResult.data.findings.map((f) => ({
          title: f.title,
          severity: f.severity,
          resourceId: f.resources?.[0]?.id,
        }));
      }
    } catch {
      // Security Hub might not be enabled — non-fatal
    }

    // Collect GuardDuty findings
    let guardDutyFindings: Array<{ title: string; severity: string; type?: string }> = [];
    try {
      const gdResult = await (sm as {
        listGuardDutyFindings: (opts?: unknown) => Promise<{
          success: boolean;
          data?: { findings: Array<{ title: string; severity: string; type?: string }> };
        }>;
      }).listGuardDutyFindings({ maxResults: 50 });

      if (gdResult.success && gdResult.data?.findings) {
        guardDutyFindings = gdResult.data.findings.map((f) => ({
          title: f.title,
          severity: f.severity,
          type: f.type,
        }));
      }
    } catch {
      // GuardDuty might not be enabled — non-fatal
    }

    return {
      iamRoles: rolesResult.success ? (rolesResult.data?.roles.length ?? 0) : 0,
      securityFindings,
      guardDutyFindings,
      scannedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Enrich discovered nodes with security metadata from SecurityManager.
 * Attaches findings to matching nodes by resource ARN/ID.
 */
export async function enrichWithSecurity(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
): Promise<void> {
  const posture = await getSecurityPosture(ctx);
  if (!posture) return;

  // Attach security findings to matching nodes
  for (const finding of posture.securityFindings) {
    if (!finding.resourceId) continue;
    for (const node of nodes) {
      if (
        finding.resourceId.includes(node.nativeId) ||
        node.nativeId.includes(finding.resourceId)
      ) {
        const existing = (node.metadata["securityFindings"] as string[] | undefined) ?? [];
        existing.push(`[${finding.severity}] ${finding.title}`);
        node.metadata["securityFindings"] = existing;
        node.metadata["hasSecurityIssues"] = true;
      }
    }
  }
}
