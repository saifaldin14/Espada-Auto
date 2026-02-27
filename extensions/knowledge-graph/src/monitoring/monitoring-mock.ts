/**
 * Infrastructure Knowledge Graph — Monitoring Mock Mode
 *
 * Provides mock event generators and a ready-to-use monitor factory
 * for testing, demos, and development without real cloud credentials.
 *
 * Includes:
 * - MockEventSourceAdapter: configurable synthetic CloudEvent generator
 * - Scenario-based event presets (orphan, SPOF, cost spike, drift, disappearance)
 * - MockAlertCollector: captures alerts for assertion
 * - createMockMonitor(): one-call factory wiring storage + engine + monitor
 */

import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
  CloudProvider,
} from "../types.js";
import { GraphEngine } from "../core/engine.js";
import {
  InfraMonitor,
  type EventSourceAdapter,
  type EventSourceType,
  type CloudEvent,
  type AlertInstance,
  type AlertDestination,
  type MonitorConfig,
  type AlertRule,
} from "./monitoring.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";

// =============================================================================
// Mock Event Source Adapter
// =============================================================================

/** Configuration for MockEventSourceAdapter event generation. */
export type MockEventGeneratorConfig = {
  /** Provider to tag events with. */
  provider: CloudProvider;
  /** Source type for the adapter. */
  sourceType: EventSourceType;
  /** Events returned by fetchEvents(). If a function, called each time. */
  events: CloudEvent[] | ((since: string) => CloudEvent[]);
  /** Whether healthCheck returns ok. Default true. */
  healthy?: boolean;
  /** Health-check message when unhealthy. */
  healthMessage?: string;
};

/**
 * A mock EventSourceAdapter that returns pre-configured or dynamically
 * generated CloudEvents without touching any real cloud API.
 */
export class MockEventSourceAdapter implements EventSourceAdapter {
  readonly type: EventSourceType;
  readonly provider: CloudProvider;

  private eventSource: CloudEvent[] | ((since: string) => CloudEvent[]);
  private healthy: boolean;
  private healthMessage?: string;

  /** Number of times fetchEvents was called. */
  fetchCount = 0;
  /** Number of times healthCheck was called. */
  healthCheckCount = 0;

  constructor(config: MockEventGeneratorConfig) {
    this.type = config.sourceType;
    this.provider = config.provider;
    this.eventSource = config.events;
    this.healthy = config.healthy ?? true;
    this.healthMessage = config.healthMessage;
  }

  async fetchEvents(since: string): Promise<CloudEvent[]> {
    this.fetchCount++;
    if (typeof this.eventSource === "function") {
      return this.eventSource(since);
    }
    // Filter events after `since`
    return this.eventSource.filter((e) => e.timestamp >= since);
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    this.healthCheckCount++;
    return { ok: this.healthy, message: this.healthMessage };
  }

  /** Replace event source at runtime (for multi-step scenarios). */
  setEvents(events: CloudEvent[] | ((since: string) => CloudEvent[])): void {
    this.eventSource = events;
  }

  /** Toggle health status. */
  setHealthy(healthy: boolean, message?: string): void {
    this.healthy = healthy;
    this.healthMessage = message;
  }
}

// =============================================================================
// Mock Alert Collector
// =============================================================================

/**
 * Captures dispatched alerts for inspection and assertion in tests.
 * Install as an AlertDestination with type "callback".
 */
export class MockAlertCollector {
  /** All alerts received, in order. */
  readonly alerts: AlertInstance[] = [];
  /** Number of dispatch calls. */
  dispatchCount = 0;

  /** AlertDestination to pass to MonitorConfig. */
  get destination(): AlertDestination {
    return {
      type: "callback",
      callback: async (alerts: AlertInstance[]) => {
        this.dispatchCount++;
        this.alerts.push(...alerts);
      },
    };
  }

  /** Alerts filtered by category. */
  byCategory(category: string): AlertInstance[] {
    return this.alerts.filter((a) => a.category === category);
  }

  /** Alerts filtered by severity. */
  bySeverity(severity: string): AlertInstance[] {
    return this.alerts.filter((a) => a.severity === severity);
  }

  /** Alerts filtered by rule ID. */
  byRuleId(ruleId: string): AlertInstance[] {
    return this.alerts.filter((a) => a.ruleId === ruleId);
  }

  /** Reset collected alerts. */
  clear(): void {
    this.alerts.length = 0;
    this.dispatchCount = 0;
  }
}

// =============================================================================
// Cloud Event Factories
// =============================================================================

let eventSeq = 0;

/** Build a CloudEvent with sensible defaults. */
export function mockCloudEvent(overrides: Partial<CloudEvent> = {}): CloudEvent {
  eventSeq++;
  return {
    id: overrides.id ?? `mock-event-${eventSeq}`,
    provider: overrides.provider ?? "aws",
    eventType: overrides.eventType ?? "CreateInstance",
    resourceId: overrides.resourceId ?? `resource-${eventSeq}`,
    resourceType: overrides.resourceType ?? "compute",
    actor: overrides.actor ?? "mock-user@example.com",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    readOnly: overrides.readOnly ?? false,
    success: overrides.success ?? true,
    raw: overrides.raw ?? {},
  };
}

/**
 * Generate a batch of CloudEvents simulating a time range.
 * Creates `count` events evenly spaced between `startTime` and `endTime`.
 */
export function generateEventBatch(options: {
  count: number;
  provider?: CloudProvider;
  eventType?: string;
  resourceType?: string;
  startTime?: string;
  endTime?: string;
}): CloudEvent[] {
  const {
    count,
    provider = "aws",
    eventType = "UpdateResource",
    resourceType = "compute",
  } = options;
  const start = new Date(options.startTime ?? Date.now() - 3600_000).getTime();
  const end = new Date(options.endTime ?? new Date().toISOString()).getTime();
  const step = count > 1 ? (end - start) / (count - 1) : 0;

  return Array.from({ length: count }, (_, i) =>
    mockCloudEvent({
      provider,
      eventType,
      resourceType,
      timestamp: new Date(start + step * i).toISOString(),
    }),
  );
}

// =============================================================================
// Scenario Presets — pre-built graph + event configurations
// =============================================================================

/** Seed data for a scenario: graph nodes, edges, and event source events. */
export type MockScenario = {
  /** Human-readable name. */
  name: string;
  /** Description of what this scenario demonstrates. */
  description: string;
  /** Nodes to seed into the graph. */
  nodes: GraphNodeInput[];
  /** Edges to seed into the graph. */
  edges: GraphEdgeInput[];
  /** Mock event source config. */
  eventSource: MockEventGeneratorConfig;
};

function makeNodeInput(overrides: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id: overrides.id ?? `node-${Date.now()}`,
    provider: overrides.provider ?? "aws",
    resourceType: overrides.resourceType ?? "compute",
    nativeId: overrides.nativeId ?? `arn:aws:ec2:us-east-1:123:instance/${overrides.id ?? "i-default"}`,
    name: overrides.name ?? "mock-resource",
    region: overrides.region ?? "us-east-1",
    account: overrides.account ?? "123456789012",
    status: overrides.status ?? "running",
    tags: overrides.tags ?? {},
    metadata: overrides.metadata ?? {},
    costMonthly: overrides.costMonthly ?? null,
    owner: overrides.owner ?? null,
    createdAt: overrides.createdAt ?? null,
  };
}

function makeEdgeInput(overrides: Partial<GraphEdgeInput>): GraphEdgeInput {
  return {
    id: overrides.id ?? `edge-${Date.now()}`,
    sourceNodeId: overrides.sourceNodeId ?? "node-1",
    targetNodeId: overrides.targetNodeId ?? "node-2",
    relationshipType: overrides.relationshipType ?? "connected-to",
    confidence: overrides.confidence ?? 1.0,
    discoveredVia: overrides.discoveredVia ?? "config-scan",
    metadata: overrides.metadata ?? {},
  };
}

/**
 * Scenario: orphaned resources.
 * Creates isolated VMs with costs but no edges → triggers orphan alert.
 */
export const orphanScenario: MockScenario = {
  name: "Orphan Detection",
  description: "Isolated resources with no connections — triggers orphan alerts",
  nodes: [
    makeNodeInput({ id: "orphan-vm-1", name: "abandoned-web-server", costMonthly: 150, status: "running" }),
    makeNodeInput({ id: "orphan-vm-2", name: "forgotten-db-staging", costMonthly: 200, resourceType: "database", status: "running" }),
    makeNodeInput({ id: "orphan-disk-1", name: "detached-volume", costMonthly: 20, resourceType: "storage", status: "stopped" }),
    makeNodeInput({ id: "connected-vm", name: "production-api", costMonthly: 300, status: "running" }),
    makeNodeInput({ id: "connected-lb", name: "api-load-balancer", costMonthly: 25, resourceType: "network", status: "running" }),
  ],
  edges: [
    makeEdgeInput({ id: "e-lb-vm", sourceNodeId: "connected-lb", targetNodeId: "connected-vm" }),
  ],
  eventSource: {
    provider: "aws",
    sourceType: "cloudtrail",
    events: [
      mockCloudEvent({ eventType: "StopInstances", resourceId: "orphan-vm-1", resourceType: "compute" }),
    ],
  },
};

/**
 * Scenario: single point of failure.
 * Creates a hub-and-spoke topology where one node has many dependents.
 */
export const spofScenario: MockScenario = {
  name: "SPOF Detection",
  description: "Hub-and-spoke topology — central node is a single point of failure",
  nodes: [
    makeNodeInput({ id: "hub-db", name: "central-database", resourceType: "database", costMonthly: 500, status: "running" }),
    makeNodeInput({ id: "spoke-api-1", name: "api-service-1", costMonthly: 100, status: "running" }),
    makeNodeInput({ id: "spoke-api-2", name: "api-service-2", costMonthly: 100, status: "running" }),
    makeNodeInput({ id: "spoke-api-3", name: "api-service-3", costMonthly: 100, status: "running" }),
    makeNodeInput({ id: "spoke-worker", name: "background-worker", costMonthly: 80, status: "running" }),
    makeNodeInput({ id: "spoke-cache", name: "cache-layer", costMonthly: 60, resourceType: "cache", status: "running" }),
  ],
  edges: [
    makeEdgeInput({ id: "e-api1-db", sourceNodeId: "spoke-api-1", targetNodeId: "hub-db", relationshipType: "depends-on" }),
    makeEdgeInput({ id: "e-api2-db", sourceNodeId: "spoke-api-2", targetNodeId: "hub-db", relationshipType: "depends-on" }),
    makeEdgeInput({ id: "e-api3-db", sourceNodeId: "spoke-api-3", targetNodeId: "hub-db", relationshipType: "depends-on" }),
    makeEdgeInput({ id: "e-worker-db", sourceNodeId: "spoke-worker", targetNodeId: "hub-db", relationshipType: "depends-on" }),
    makeEdgeInput({ id: "e-cache-db", sourceNodeId: "spoke-cache", targetNodeId: "hub-db", relationshipType: "depends-on" }),
  ],
  eventSource: {
    provider: "aws",
    sourceType: "cloudtrail",
    events: [
      mockCloudEvent({ eventType: "ModifyDBInstance", resourceId: "hub-db", resourceType: "database" }),
    ],
  },
};

/**
 * Scenario: cost spike.
 * Pre-seeds nodes with moderate costs; events represent cost increases.
 */
export const costSpikeScenario: MockScenario = {
  name: "Cost Spike",
  description: "Sudden cost increase across resources — triggers cost anomaly alert",
  nodes: [
    makeNodeInput({ id: "gpu-cluster", name: "ml-training-cluster", resourceType: "compute", costMonthly: 2000, status: "running" }),
    makeNodeInput({ id: "s3-archive", name: "data-archive", resourceType: "storage", costMonthly: 500, status: "running", provider: "aws" }),
    makeNodeInput({ id: "transfer-node", name: "data-transfer", resourceType: "network", costMonthly: 300, status: "running" }),
  ],
  edges: [
    makeEdgeInput({ id: "e-gpu-s3", sourceNodeId: "gpu-cluster", targetNodeId: "s3-archive", relationshipType: "reads-from" }),
    makeEdgeInput({ id: "e-transfer-s3", sourceNodeId: "transfer-node", targetNodeId: "s3-archive", relationshipType: "writes-to" }),
  ],
  eventSource: {
    provider: "aws",
    sourceType: "cloudtrail",
    events: [
      mockCloudEvent({ eventType: "RunInstances", resourceId: "gpu-cluster", resourceType: "compute" }),
      mockCloudEvent({ eventType: "PutObject", resourceId: "s3-archive", resourceType: "storage", readOnly: false }),
    ],
  },
};

/**
 * Scenario: configuration drift.
 * Nodes report mutations that weren't initiated through approved channels.
 */
export const driftScenario: MockScenario = {
  name: "Configuration Drift",
  description: "Unauthorized changes detected — triggers drift/unauthorized alerts",
  nodes: [
    makeNodeInput({ id: "prod-vm", name: "production-server", costMonthly: 200, status: "running" }),
    makeNodeInput({ id: "prod-db", name: "production-database", resourceType: "database", costMonthly: 400, status: "running" }),
  ],
  edges: [
    makeEdgeInput({ id: "e-vm-db", sourceNodeId: "prod-vm", targetNodeId: "prod-db", relationshipType: "connected-to" }),
  ],
  eventSource: {
    provider: "aws",
    sourceType: "cloudtrail",
    events: [
      mockCloudEvent({
        eventType: "ModifyInstanceAttribute",
        resourceId: "prod-vm",
        resourceType: "compute",
        actor: "unknown-user@external.com",
      }),
      mockCloudEvent({
        eventType: "ModifyDBInstance",
        resourceId: "prod-db",
        resourceType: "database",
        actor: "unknown-user@external.com",
      }),
    ],
  },
};

/**
 * Scenario: resources disappearing.
 * Nodes that existed in previous syncs are no longer found.
 */
export const disappearanceScenario: MockScenario = {
  name: "Resource Disappearance",
  description: "Previously tracked resources vanish — triggers disappeared alert",
  nodes: [
    makeNodeInput({ id: "stable-vm", name: "stable-server", costMonthly: 100, status: "running" }),
    makeNodeInput({ id: "vanishing-vm", name: "ephemeral-server", costMonthly: 50, status: "running" }),
    makeNodeInput({ id: "vanishing-db", name: "temp-database", resourceType: "database", costMonthly: 75, status: "running" }),
  ],
  edges: [
    makeEdgeInput({ id: "e-stable-vanish", sourceNodeId: "stable-vm", targetNodeId: "vanishing-vm", relationshipType: "connected-to" }),
  ],
  eventSource: {
    provider: "aws",
    sourceType: "cloudtrail",
    events: [
      mockCloudEvent({ eventType: "TerminateInstances", resourceId: "vanishing-vm", resourceType: "compute" }),
      mockCloudEvent({ eventType: "DeleteDBInstance", resourceId: "vanishing-db", resourceType: "database" }),
    ],
  },
};

/**
 * Scenario: multi-cloud events.
 * Multiple providers reporting events simultaneously.
 */
export const multiCloudScenario: MockScenario = {
  name: "Multi-Cloud Activity",
  description: "Events from AWS, Azure, and GCP simultaneously",
  nodes: [
    makeNodeInput({ id: "aws-vm", name: "aws-instance", provider: "aws", costMonthly: 100, status: "running" }),
    makeNodeInput({ id: "azure-vm", name: "azure-vm", provider: "azure", costMonthly: 120, status: "running" }),
    makeNodeInput({ id: "gcp-vm", name: "gcp-instance", provider: "gcp", costMonthly: 110, status: "running" }),
  ],
  edges: [],
  eventSource: {
    provider: "aws",
    sourceType: "cloudtrail",
    events: [
      mockCloudEvent({ provider: "aws", eventType: "StopInstances", resourceId: "aws-vm" }),
      mockCloudEvent({ provider: "azure", eventType: "deallocate", resourceId: "azure-vm" }),
      mockCloudEvent({ provider: "gcp", eventType: "instances.stop", resourceId: "gcp-vm" }),
    ],
  },
};

/** All pre-built scenarios. */
export const ALL_SCENARIOS: MockScenario[] = [
  orphanScenario,
  spofScenario,
  costSpikeScenario,
  driftScenario,
  disappearanceScenario,
  multiCloudScenario,
];

// =============================================================================
// Mock Monitor Factory
// =============================================================================

/** Options for createMockMonitor(). */
export type MockMonitorOptions = {
  /** Scenario to seed. If omitted, uses an empty graph. */
  scenario?: MockScenario;
  /** Additional event sources (appended to scenario source). */
  extraEventSources?: MockEventSourceAdapter[];
  /** Override monitor config. */
  config?: Partial<MonitorConfig>;
  /** Custom alert rules (replaces built-ins if provided). */
  alertRules?: AlertRule[];
  /** Whether to attach a MockAlertCollector destination. Default true. */
  collectAlerts?: boolean;
  /** Provide your own storage instance. */
  storage?: GraphStorage;
};

/** Result from createMockMonitor(). */
export type MockMonitorResult = {
  /** The InfraMonitor instance. */
  monitor: InfraMonitor;
  /** GraphEngine backing the monitor. */
  engine: GraphEngine;
  /** Graph storage. */
  storage: GraphStorage;
  /** Alert collector (if collectAlerts was true). */
  alertCollector: MockAlertCollector | null;
  /** Event source adapters wired to the monitor. */
  eventSources: MockEventSourceAdapter[];
};

/**
 * Create a fully-wired InfraMonitor with mock event sources and optional
 * seeded graph data. Returns all component handles for test assertions.
 *
 * @example
 * ```ts
 * const { monitor, alertCollector, storage } = await createMockMonitor({
 *   scenario: orphanScenario,
 * });
 * const result = await monitor.runSyncCycle();
 * expect(alertCollector?.alerts.length).toBeGreaterThan(0);
 * monitor.stop();
 * ```
 */
export async function createMockMonitor(
  options: MockMonitorOptions = {},
): Promise<MockMonitorResult> {
  const {
    scenario,
    extraEventSources = [],
    config = {},
    alertRules,
    collectAlerts = true,
  } = options;

  // 1. Storage
  const storage = options.storage ?? new InMemoryGraphStorage();
  if ("initialize" in storage && typeof (storage as InMemoryGraphStorage).initialize === "function") {
    await (storage as InMemoryGraphStorage).initialize();
  }

  // 2. Seed scenario data
  if (scenario) {
    for (const node of scenario.nodes) {
      await storage.upsertNode(node);
    }
    for (const edge of scenario.edges) {
      await storage.upsertEdge(edge);
    }
  }

  // 3. Build event sources
  const eventSources: MockEventSourceAdapter[] = [];
  if (scenario) {
    eventSources.push(new MockEventSourceAdapter(scenario.eventSource));
  }
  eventSources.push(...extraEventSources);

  // 4. Alert collector
  const alertCollector = collectAlerts ? new MockAlertCollector() : null;
  const destinations: AlertDestination[] = [];
  if (alertCollector) {
    destinations.push(alertCollector.destination);
  }

  // 5. Engine
  const engine = new GraphEngine({ storage });

  // 6. Monitor
  const monitorConfig: Partial<MonitorConfig> = {
    ...config,
    alertDestinations: [
      ...destinations,
      ...(config.alertDestinations ?? []),
    ],
  };
  if (alertRules) {
    monitorConfig.alertRules = alertRules;
  }

  const monitor = new InfraMonitor({
    engine,
    storage,
    config: monitorConfig,
    eventSources,
  });

  return {
    monitor,
    engine,
    storage,
    alertCollector,
    eventSources,
  };
}
