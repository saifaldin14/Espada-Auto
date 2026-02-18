/**
 * Persistent Audit Trail — In-Memory Storage
 *
 * Lightweight in-memory implementation for testing and development.
 */

import type {
  AuditStorage,
  AuditEvent,
  AuditQuery,
  AuditSummary,
  AuditSeverity,
  AuditEventType,
  AuditResult,
} from "./types.js";

export class InMemoryAuditStorage implements AuditStorage {
  private events: AuditEvent[] = [];

  async initialize(): Promise<void> {
    // No-op for in-memory
  }

  save(event: AuditEvent): void {
    this.events.push(event);
  }

  saveBatch(events: AuditEvent[]): void {
    this.events.push(...events);
  }

  query(filter: AuditQuery): AuditEvent[] {
    let results = [...this.events];

    if (filter.startDate) {
      results = results.filter((e) => e.timestamp >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter((e) => e.timestamp <= filter.endDate!);
    }
    if (filter.eventTypes?.length) {
      results = results.filter((e) => filter.eventTypes!.includes(e.eventType));
    }
    if (filter.actorIds?.length) {
      results = results.filter((e) => filter.actorIds!.includes(e.actor.id));
    }
    if (filter.resourceTypes?.length) {
      results = results.filter((e) => e.resource && filter.resourceTypes!.includes(e.resource.type));
    }
    if (filter.severity?.length) {
      results = results.filter((e) => filter.severity!.includes(e.severity));
    }
    if (filter.result?.length) {
      results = results.filter((e) => filter.result!.includes(e.result));
    }
    if (filter.correlationId) {
      results = results.filter((e) => e.correlationId === filter.correlationId);
    }
    if (filter.operation) {
      const op = filter.operation.toLowerCase();
      results = results.filter((e) => e.operation.toLowerCase().includes(op));
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  getById(id: string): AuditEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  getTimeline(resourceId: string, limit = 50): AuditEvent[] {
    return this.events
      .filter((e) => e.resource?.id === resourceId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getActorActivity(actorId: string, limit = 50): AuditEvent[] {
    return this.events
      .filter((e) => e.actor.id === actorId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getSummary(startDate: string, endDate: string): AuditSummary {
    const filtered = this.events.filter((e) => e.timestamp >= startDate && e.timestamp <= endDate);

    const byType: Partial<Record<AuditEventType, number>> = {};
    const byResult: Partial<Record<AuditResult, number>> = {};
    const bySeverity: Partial<Record<AuditSeverity, number>> = {};
    const actorCounts = new Map<string, { name: string; count: number }>();
    const resourceCounts = new Map<string, { type: string; count: number }>();
    const opCounts = new Map<string, number>();

    for (const e of filtered) {
      byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
      byResult[e.result] = (byResult[e.result] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;

      const ac = actorCounts.get(e.actor.id);
      if (ac) ac.count++;
      else actorCounts.set(e.actor.id, { name: e.actor.name, count: 1 });

      if (e.resource) {
        const rc = resourceCounts.get(e.resource.id);
        if (rc) rc.count++;
        else resourceCounts.set(e.resource.id, { type: e.resource.type, count: 1 });
      }

      opCounts.set(e.operation, (opCounts.get(e.operation) ?? 0) + 1);
    }

    const topActors = [...actorCounts.entries()]
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topResources = [...resourceCounts.entries()]
      .map(([id, { type, count }]) => ({ id, type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topOperations = [...opCounts.entries()]
      .map(([operation, count]) => ({ operation, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: filtered.length,
      timeRange: { start: startDate, end: endDate },
      byType,
      byResult,
      bySeverity,
      topActors,
      topResources,
      topOperations,
    };
  }

  getEventCount(): number {
    return this.events.length;
  }

  prune(beforeDate: string): number {
    const before = this.events.length;
    this.events = this.events.filter((e) => e.timestamp >= beforeDate);
    return before - this.events.length;
  }

  close(): void {
    this.events = [];
  }
}
