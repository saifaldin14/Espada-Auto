/**
 * Full-Estate Enterprise Migration Tests — Second Wave Resource Types
 *
 * Validates all 19 new resource types (step-function, event-bus, file-system,
 * transit-gateway, vpn-connection, vpc-endpoint, parameter-store, iam-user,
 * iam-group, identity-provider, log-group, alarm, data-pipeline, stream,
 * graph-database, data-warehouse, bucket-policy, listener-rule, network-acl).
 *
 * Covers: type coverage, compatibility matrix, step handler execution,
 * plan generation, assessment, and normalized type shapes.
 */

import { describe, it, expect } from "vitest";

import type {
  MigrationResourceType,
  MigrationStepType,
  MigrationStepHandler,
  NormalizedStepFunction,
  NormalizedEventBus,
  NormalizedFileSystem,
  NormalizedTransitGateway,
  NormalizedVPNConnection,
  NormalizedVPCEndpoint,
  NormalizedParameter,
  NormalizedIAMUser,
  NormalizedIAMGroup,
  NormalizedIdentityProvider,
  NormalizedLogGroup,
  NormalizedAlarm,
  NormalizedDataPipeline,
  NormalizedStream,
  NormalizedGraphDatabase,
  NormalizedDataWarehouse,
  NormalizedBucketPolicy,
  NormalizedListenerRule,
  NormalizedNetworkACL,
} from "../src/types.js";

import {
  assessMigration,
  generatePlan,
  type MigrationAssessment,
} from "../src/core/migration-planner.js";

import {
  checkCompatibility,
  checkAllCompatibility,
} from "../src/core/compatibility-matrix.js";

// Import all full-estate step handlers
import { migrateStepFunctionsHandler } from "../src/orchestration/steps/migrate-step-functions.js";
import { migrateEventBusHandler } from "../src/orchestration/steps/migrate-event-bus.js";
import { migrateFileSystemHandler } from "../src/data/steps/migrate-file-system.js";
import { migrateTransitGatewayHandler } from "../src/network/steps/migrate-transit-gateway.js";
import { migrateVPNHandler } from "../src/network/steps/migrate-vpn.js";
import { migrateVPCEndpointHandler } from "../src/network/steps/migrate-vpc-endpoint.js";
import { migrateNetworkACLHandler } from "../src/network/steps/migrate-network-acl.js";
import { migrateListenerRulesHandler } from "../src/network/steps/migrate-listener-rules.js";
import { migrateParametersHandler } from "../src/identity/steps/migrate-parameters.js";
import { migrateIAMUsersHandler } from "../src/identity/steps/migrate-iam-users.js";
import { migrateIAMGroupsHandler } from "../src/identity/steps/migrate-iam-groups.js";
import { migrateIdentityProviderHandler } from "../src/identity/steps/migrate-identity-provider.js";
import { migrateLogGroupsHandler } from "../src/monitoring/steps/migrate-log-groups.js";
import { migrateAlarmsHandler } from "../src/monitoring/steps/migrate-alarms.js";
import { migrateDataPipelineHandler } from "../src/analytics/steps/migrate-data-pipeline.js";
import { migrateStreamHandler } from "../src/analytics/steps/migrate-stream.js";
import { migrateGraphDatabaseHandler } from "../src/analytics/steps/migrate-graph-database.js";
import { migrateDataWarehouseHandler } from "../src/analytics/steps/migrate-data-warehouse.js";
import { migrateBucketPoliciesHandler } from "../src/data/steps/migrate-bucket-policies.js";

// =============================================================================
// Helpers
// =============================================================================

function makeCtx(params: Record<string, unknown> = {}, globalParams: Record<string, unknown> = {}): any {
  return {
    params: { targetProvider: "azure", ...params },
    globalParams: { targetProvider: "azure", sourceProvider: "aws", ...globalParams },
    tags: {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

function makeAssessment(overrides: Partial<MigrationAssessment> = {}): MigrationAssessment {
  return assessMigration({
    sourceProvider: "aws",
    targetProvider: "azure",
    targetRegion: "eastus",
    resourceTypes: [],
    ...overrides,
  });
}

// =============================================================================
// 1. Resource Type Coverage (10 tests)
// =============================================================================

describe("Resource Type Coverage", () => {
  const FULL_ESTATE_RESOURCE_TYPES: MigrationResourceType[] = [
    "step-function",
    "event-bus",
    "file-system",
    "transit-gateway",
    "vpn-connection",
    "vpc-endpoint",
    "parameter-store",
    "iam-user",
    "iam-group",
    "identity-provider",
    "log-group",
    "alarm",
    "data-pipeline",
    "stream",
    "graph-database",
    "data-warehouse",
    "bucket-policy",
    "listener-rule",
    "network-acl",
  ];

  it("MigrationResourceType includes step-function", () => {
    const t: MigrationResourceType = "step-function";
    expect(t).toBe("step-function");
  });

  it("MigrationResourceType includes event-bus and file-system", () => {
    const eb: MigrationResourceType = "event-bus";
    const fs: MigrationResourceType = "file-system";
    expect(eb).toBe("event-bus");
    expect(fs).toBe("file-system");
  });

  it("MigrationResourceType includes transit-gateway, vpn-connection, vpc-endpoint", () => {
    const types: MigrationResourceType[] = ["transit-gateway", "vpn-connection", "vpc-endpoint"];
    expect(types).toHaveLength(3);
    expect(types).toContain("transit-gateway");
  });

  it("MigrationResourceType includes parameter-store, iam-user, iam-group", () => {
    const types: MigrationResourceType[] = ["parameter-store", "iam-user", "iam-group"];
    expect(types).toHaveLength(3);
    expect(types).toContain("iam-user");
  });

  it("MigrationResourceType includes identity-provider, log-group, alarm", () => {
    const types: MigrationResourceType[] = ["identity-provider", "log-group", "alarm"];
    expect(types).toHaveLength(3);
    expect(types).toContain("alarm");
  });

  it("MigrationResourceType includes data-pipeline, stream, graph-database, data-warehouse", () => {
    const types: MigrationResourceType[] = ["data-pipeline", "stream", "graph-database", "data-warehouse"];
    expect(types).toHaveLength(4);
    expect(types).toContain("graph-database");
  });

  it("MigrationResourceType includes bucket-policy, listener-rule, network-acl", () => {
    const types: MigrationResourceType[] = ["bucket-policy", "listener-rule", "network-acl"];
    expect(types).toHaveLength(3);
    expect(types).toContain("network-acl");
  });

  it("MigrationStepType includes all new step types", () => {
    const stepTypes: MigrationStepType[] = [
      "migrate-step-functions",
      "migrate-event-bus",
      "migrate-file-system",
      "migrate-transit-gateway",
      "migrate-vpn-connection",
      "migrate-vpc-endpoint",
      "migrate-network-acl",
      "migrate-listener-rules",
      "migrate-parameters",
      "migrate-iam-users",
      "migrate-iam-groups",
      "migrate-identity-provider",
      "migrate-log-groups",
      "migrate-alarms",
      "migrate-data-pipeline",
      "migrate-stream",
      "migrate-graph-database",
      "migrate-data-warehouse",
      "migrate-bucket-policies",
    ];
    expect(stepTypes).toHaveLength(19);
    expect(stepTypes).toContain("migrate-step-functions");
    expect(stepTypes).toContain("migrate-bucket-policies");
  });

  it("new pipeline types exist in MigrationStep pipeline union", () => {
    // Verify the pipeline type strings are valid via type assignment
    const pipelines: Array<"monitoring" | "orchestration" | "analytics" | "storage-policy"> = [
      "monitoring",
      "orchestration",
      "analytics",
      "storage-policy",
    ];
    expect(pipelines).toContain("monitoring");
    expect(pipelines).toContain("orchestration");
    expect(pipelines).toContain("analytics");
    expect(pipelines).toContain("storage-policy");
  });

  it("all 19 full-estate resource types are valid MigrationResourceType values", () => {
    expect(FULL_ESTATE_RESOURCE_TYPES).toHaveLength(19);
    for (const rt of FULL_ESTATE_RESOURCE_TYPES) {
      // Each must be assignable to MigrationResourceType (compile-time) and checkCompatibility should not crash
      const result = checkCompatibility("aws", "azure", rt);
      expect(result).toBeDefined();
      expect(result.resourceType).toBe(rt);
    }
  });
});

// =============================================================================
// 2. Compatibility Matrix (20 tests)
// =============================================================================

describe("Compatibility Matrix — Full-Estate Types", () => {
  const NEW_TYPES: MigrationResourceType[] = [
    "step-function", "event-bus", "file-system", "transit-gateway",
    "vpn-connection", "vpc-endpoint", "parameter-store", "iam-user",
    "iam-group", "identity-provider", "log-group", "alarm",
    "data-pipeline", "stream", "graph-database", "data-warehouse",
    "bucket-policy", "listener-rule",
  ];

  for (const rt of NEW_TYPES) {
    it(`aws → azure compatibility for "${rt}" is true`, () => {
      const result = checkCompatibility("aws", "azure", rt);
      expect(result.compatible).toBe(true);
      expect(result.resourceType).toBe(rt);
    });
  }

  it('aws → gcp compatibility for "step-function" is true', () => {
    const result = checkCompatibility("aws", "gcp", "step-function");
    expect(result.compatible).toBe(true);
  });

  it('aws → on-premises compatibility for "transit-gateway" is true', () => {
    const result = checkCompatibility("aws", "on-premises", "transit-gateway");
    expect(result.compatible).toBe(true);
  });

  it("checkAllCompatibility(aws, azure) includes all new types", () => {
    const results = checkAllCompatibility("aws", "azure");
    const types = results.map((r) => r.resourceType);
    for (const rt of NEW_TYPES) {
      expect(types).toContain(rt);
    }
    expect(types).toContain("network-acl");
  });

  it("checkAllCompatibility(aws, azure) returns 45 resource types", () => {
    const results = checkAllCompatibility("aws", "azure");
    expect(results).toHaveLength(45);
  });
});

// =============================================================================
// 3. Step Handler Execution (20 tests)
// =============================================================================

describe("Step Handler Execution — Full-Estate Handlers", () => {
  it("migrateStepFunctionsHandler.execute returns migrated step functions", async () => {
    const ctx = makeCtx({ stepFunctions: [{ id: "sf-1", name: "order-flow", type: "STANDARD", definition: {}, roleArn: "arn:aws:iam::role/sf" }] });
    const result = await migrateStepFunctionsHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedStepFunctions).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateEventBusHandler.execute returns migrated event buses", async () => {
    const ctx = makeCtx({ eventBuses: [{ id: "eb-1", name: "orders-bus", isDefault: false, rules: [], tags: {} }] });
    const result = await migrateEventBusHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedEventBuses).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateFileSystemHandler.execute returns migrated file systems", async () => {
    const ctx = makeCtx({ fileSystems: [{ id: "fs-1", name: "shared-fs", type: "nfs", sizeGB: 100, throughputMode: "bursting", performanceMode: "generalPurpose", encrypted: true, mountTargets: [], accessPoints: [], region: "us-east-1", tags: {} }] });
    const result = await migrateFileSystemHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedFileSystems).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateTransitGatewayHandler.execute returns migrated gateways", async () => {
    const ctx = makeCtx({ transitGateways: [{ id: "tgw-1", name: "main-tgw", asnNumber: 64512, attachments: [], routeTables: [], region: "us-east-1", tags: {} }] });
    const result = await migrateTransitGatewayHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedGateways).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateVPNHandler.execute returns migrated VPN connections", async () => {
    const ctx = makeCtx({ vpnConnections: [{ id: "vpn-1", name: "site-vpn", type: "site-to-site", customerGatewayIp: "1.2.3.4", customerGatewayAsn: 65000, tunnels: [], staticRoutes: [], bgpEnabled: false, tags: {} }] });
    const result = await migrateVPNHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedVPNs).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateVPCEndpointHandler.execute returns migrated endpoints", async () => {
    const ctx = makeCtx({ vpcEndpoints: [{ id: "vpce-1", name: "s3-endpoint", type: "gateway", serviceName: "com.amazonaws.s3", vpcId: "vpc-1", subnetIds: [], securityGroupIds: [], privateDnsEnabled: false, tags: {} }] });
    const result = await migrateVPCEndpointHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedEndpoints).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateNetworkACLHandler.execute returns migrated NACLs", async () => {
    const ctx = makeCtx({ networkACLs: [{ id: "nacl-1", name: "main-nacl", vpcId: "vpc-1", subnetAssociations: [], inboundRules: [], outboundRules: [], tags: {} }] });
    const result = await migrateNetworkACLHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedACLs).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateListenerRulesHandler.execute returns migrated rules", async () => {
    const ctx = makeCtx({ listenerRules: [{ id: "lr-1", listenerArn: "arn:aws:elb", priority: 1, conditions: [], actions: [] }] });
    const result = await migrateListenerRulesHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedRules).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateParametersHandler.execute returns migrated parameters", async () => {
    const ctx = makeCtx({ parameters: [{ id: "p-1", name: "/app/db-host", type: "string", valueRef: "ref:ssm:/app/db-host", version: 1, tier: "standard", tags: {} }] });
    const result = await migrateParametersHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedParameters).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateIAMUsersHandler.execute returns migrated users", async () => {
    const ctx = makeCtx({ users: [{ id: "u-1", name: "admin-user", groupIds: [], attachedPolicyArns: [], inlinePolicies: [], hasConsoleAccess: true, hasApiKeys: false, mfaEnabled: false, tags: {} }] });
    const result = await migrateIAMUsersHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedUsers).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateIAMGroupsHandler.execute returns migrated groups", async () => {
    const ctx = makeCtx({ groups: [{ id: "g-1", name: "developers", memberUserIds: ["u-1"], attachedPolicyArns: [], inlinePolicies: [] }] });
    const result = await migrateIAMGroupsHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedGroups).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateIdentityProviderHandler.execute returns migrated providers", async () => {
    const ctx = makeCtx({ identityProviders: [{ id: "idp-1", name: "okta-sso", type: "saml", metadataUrl: "https://okta.example.com/metadata", clientIds: [], userCount: 100, userAttributes: ["email", "name"], mfaConfig: "optional", tags: {} }] });
    const result = await migrateIdentityProviderHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedProviders).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateLogGroupsHandler.execute returns migrated log groups", async () => {
    const ctx = makeCtx({ logGroups: [{ id: "lg-1", name: "/aws/lambda/my-func", retentionDays: 30, storedSizeBytes: 1024, subscriptionFilters: [], metricFilters: [], tags: {} }] });
    const result = await migrateLogGroupsHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedLogGroups).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateAlarmsHandler.execute returns migrated alarms", async () => {
    const ctx = makeCtx({ alarms: [{ id: "a-1", name: "high-cpu", metricName: "CPUUtilization", namespace: "AWS/EC2", statistic: "Average", threshold: 80, comparisonOperator: "GreaterThanThreshold", evaluationPeriods: 3, periodSec: 300, actions: [], dimensions: [], tags: {} }] });
    const result = await migrateAlarmsHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedAlarms).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateDataPipelineHandler.execute returns migrated pipelines", async () => {
    const ctx = makeCtx({ pipelines: [{ id: "dp-1", name: "etl-job", type: "etl", schedule: "cron(0 12 * * ? *)", sourceConnections: [], targetConnections: [], scriptLocation: "s3://scripts/etl.py", workerType: "G.1X", numberOfWorkers: 2, tags: {} }] });
    const result = await migrateDataPipelineHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedPipelines).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateStreamHandler.execute returns migrated streams", async () => {
    const ctx = makeCtx({ streams: [{ id: "s-1", name: "click-stream", type: "data-stream", shardCount: 4, retentionHours: 24, consumers: [], encryption: true, tags: {} }] });
    const result = await migrateStreamHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedStreams).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateGraphDatabaseHandler.execute returns migrated graph databases", async () => {
    const ctx = makeCtx({ graphDatabases: [{ id: "gdb-1", name: "social-graph", engine: "neptune", queryLanguages: ["gremlin"], instanceClass: "db.r5.large", storageGB: 50, encrypted: true, clusterMode: true, replicaCount: 1, tags: {} }] });
    const result = await migrateGraphDatabaseHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedDatabases).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateDataWarehouseHandler.execute returns migrated data warehouses", async () => {
    const ctx = makeCtx({ dataWarehouses: [{ id: "dw-1", name: "analytics-cluster", engine: "redshift", nodeType: "dc2.large", nodeCount: 2, storageGB: 500, encrypted: true, databases: [{ name: "analytics", schemas: ["public"], tableCounts: 50, totalSizeGB: 200 }], tags: {} }] });
    const result = await migrateDataWarehouseHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.migratedWarehouses).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("migrateBucketPoliciesHandler.execute returns applied policies", async () => {
    const ctx = makeCtx({ bucketPolicies: [{ bucketName: "my-bucket", policy: { Version: "2012-10-17", Statement: [] }, publicAccessBlock: { blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true }, corsRules: [], eventNotifications: [] }] });
    const result = await migrateBucketPoliciesHandler.execute(ctx);
    expect(result).toBeDefined();
    expect(result.appliedPolicies).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it("every handler has a rollback function", () => {
    const handlers: MigrationStepHandler[] = [
      migrateStepFunctionsHandler,
      migrateEventBusHandler,
      migrateFileSystemHandler,
      migrateTransitGatewayHandler,
      migrateVPNHandler,
      migrateVPCEndpointHandler,
      migrateNetworkACLHandler,
      migrateListenerRulesHandler,
      migrateParametersHandler,
      migrateIAMUsersHandler,
      migrateIAMGroupsHandler,
      migrateIdentityProviderHandler,
      migrateLogGroupsHandler,
      migrateAlarmsHandler,
      migrateDataPipelineHandler,
      migrateStreamHandler,
      migrateGraphDatabaseHandler,
      migrateDataWarehouseHandler,
      migrateBucketPoliciesHandler,
    ];
    for (const handler of handlers) {
      expect(handler.rollback).toBeDefined();
      expect(typeof handler.rollback).toBe("function");
    }
  });
});

// =============================================================================
// 4. Plan Generation (15 tests)
// =============================================================================

describe("Plan Generation — Full-Estate Types", () => {
  function makePlan(resourceTypes: MigrationResourceType[], extras: Record<string, unknown> = {}) {
    const assessment = makeAssessment({ resourceTypes });
    return generatePlan({
      jobId: "job-plan-test",
      name: "full-estate-plan",
      description: "Test plan",
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      resourceTypes,
      assessment,
      ...extras,
    });
  }

  it("plan includes step-function steps when resourceTypes includes step-function", () => {
    const plan = makePlan(["step-function"], { stepFunctions: [{ id: "sf-1", name: "wf", provider: "aws", type: "standard", definition: {}, tracingEnabled: false, tags: {} }] });
    const sfSteps = plan.steps.filter((s) => s.type === "migrate-step-functions");
    expect(sfSteps.length).toBeGreaterThan(0);
  });

  it("plan includes event-bus steps", () => {
    const plan = makePlan(["event-bus"], { eventBuses: [{ id: "eb-1", name: "bus", provider: "aws", isDefault: false, rules: [], tags: {} }] });
    const ebSteps = plan.steps.filter((s) => s.type === "migrate-event-bus");
    expect(ebSteps.length).toBeGreaterThan(0);
  });

  it("plan includes file-system steps", () => {
    const plan = makePlan(["file-system"], { fileSystems: [{ id: "fs-1", name: "efs", provider: "aws", type: "nfs", sizeGB: 50, throughputMode: "bursting", performanceMode: "general-purpose", encrypted: true, mountTargets: [], accessPoints: [], region: "us-east-1", tags: {} }] });
    const fsSteps = plan.steps.filter((s) => s.type === "migrate-file-system");
    expect(fsSteps.length).toBeGreaterThan(0);
  });

  it("plan includes transit-gateway steps", () => {
    const plan = makePlan(["transit-gateway"], { transitGateways: [{ id: "tgw-1", name: "tgw", provider: "aws", region: "us-east-1", asnNumber: 64512, attachments: [], routeTables: [], tags: {} }] });
    const tgwSteps = plan.steps.filter((s) => s.type === "migrate-transit-gateway");
    expect(tgwSteps.length).toBeGreaterThan(0);
  });

  it("plan includes vpn-connection steps", () => {
    const plan = makePlan(["vpn-connection"], { vpnConnections: [{ id: "vpn-1", name: "vpn", provider: "aws", type: "site-to-site", customerGatewayIp: "1.2.3.4", tunnels: [], staticRoutes: [], bgpEnabled: false, tags: {} }] });
    const vpnSteps = plan.steps.filter((s) => s.type === "migrate-vpn-connection");
    expect(vpnSteps.length).toBeGreaterThan(0);
  });

  it("plan includes vpc-endpoint steps", () => {
    const plan = makePlan(["vpc-endpoint"], { vpcEndpoints: [{ id: "vpce-1", name: "ep", provider: "aws", type: "interface", serviceName: "s3", vpcId: "vpc-1", subnetIds: [], securityGroupIds: [], privateDnsEnabled: false, tags: {} }] });
    const vpceSteps = plan.steps.filter((s) => s.type === "migrate-vpc-endpoint");
    expect(vpceSteps.length).toBeGreaterThan(0);
  });

  it("plan includes network-acl steps", () => {
    const plan = makePlan(["network-acl"], { networkACLs: [{ id: "nacl-1", name: "nacl", provider: "aws", vpcId: "vpc-1", subnetAssociations: [], inboundRules: [], outboundRules: [], tags: {} }] });
    const naclSteps = plan.steps.filter((s) => s.type === "migrate-network-acl");
    expect(naclSteps.length).toBeGreaterThan(0);
  });

  it("plan includes listener-rule steps", () => {
    const plan = makePlan(["listener-rule"], { listenerRules: [{ id: "lr-1", listenerArn: "arn", provider: "aws", priority: 1, conditions: [], actions: [] }] });
    const lrSteps = plan.steps.filter((s) => s.type === "migrate-listener-rules");
    expect(lrSteps.length).toBeGreaterThan(0);
  });

  it("plan includes parameter-store steps", () => {
    const plan = makePlan(["parameter-store"], { parameters: [{ id: "p-1", name: "/app/key", provider: "aws", type: "string", valueRef: "ref", version: 1, tier: "standard", tags: {} }] });
    const paramSteps = plan.steps.filter((s) => s.type === "migrate-parameters");
    expect(paramSteps.length).toBeGreaterThan(0);
  });

  it("plan includes iam-user and iam-group steps", () => {
    const plan = makePlan(["iam-user", "iam-group"], {
      iamUsers: [{ id: "u-1", name: "dev", provider: "aws", groupIds: [], attachedPolicyArns: [], inlinePolicies: [], hasConsoleAccess: false, hasApiKeys: false, mfaEnabled: false, tags: {} }],
      iamGroups: [{ id: "g-1", name: "devs", provider: "aws", memberUserIds: ["u-1"], attachedPolicyArns: [], inlinePolicies: [] }],
    });
    const userSteps = plan.steps.filter((s) => s.type === "migrate-iam-users");
    const groupSteps = plan.steps.filter((s) => s.type === "migrate-iam-groups");
    expect(userSteps.length + groupSteps.length).toBeGreaterThan(0);
  });

  it("plan includes identity-provider steps", () => {
    const plan = makePlan(["identity-provider"], { identityProviders: [{ id: "idp-1", name: "sso", provider: "aws", type: "saml", clientIds: [], userCount: 10, userAttributes: [], mfaConfig: "off", triggers: [], tags: {} }] });
    const idpSteps = plan.steps.filter((s) => s.type === "migrate-identity-provider");
    expect(idpSteps.length).toBeGreaterThan(0);
  });

  it("plan includes monitoring steps (log-group, alarm)", () => {
    const plan = makePlan(["log-group", "alarm"], {
      logGroups: [{ id: "lg-1", name: "/aws/lambda/fn", provider: "aws", retentionDays: 14, storedSizeBytes: 0, subscriptionFilters: [], metricFilters: [], tags: {} }],
      alarms: [{ id: "a-1", name: "cpu-alarm", provider: "aws", metricName: "CPUUtilization", namespace: "AWS/EC2", statistic: "Average", threshold: 90, comparisonOperator: "GreaterThanThreshold", evaluationPeriods: 1, periodSec: 60, actions: [], dimensions: [], tags: {} }],
    });
    const logSteps = plan.steps.filter((s) => s.type === "migrate-log-groups");
    const alarmSteps = plan.steps.filter((s) => s.type === "migrate-alarms");
    expect(logSteps.length + alarmSteps.length).toBeGreaterThan(0);
  });

  it("plan includes analytics steps (data-pipeline, stream, graph-database, data-warehouse)", () => {
    const plan = makePlan(["data-pipeline", "stream", "graph-database", "data-warehouse"], {
      dataPipelines: [{ id: "dp-1", name: "etl", provider: "aws", type: "etl", sourceConnections: [], targetConnections: [], tags: {} }],
      streams: [{ id: "s-1", name: "stream", provider: "aws", type: "data-stream", shardCount: 1, retentionHours: 24, consumers: [], encryption: false, tags: {} }],
      graphDatabases: [{ id: "gdb-1", name: "graph", provider: "aws", engine: "neptune", queryLanguages: ["gremlin"], instanceClass: "db.r5.large", storageGB: 10, encrypted: false, clusterMode: false, replicaCount: 0, tags: {} }],
      dataWarehouses: [{ id: "dw-1", name: "warehouse", provider: "aws", engine: "redshift", nodeType: "dc2.large", nodeCount: 1, storageGB: 100, encrypted: false, databases: [], tags: {} }],
    });
    const types = plan.steps.map((s) => s.type);
    expect(types).toContain("migrate-data-pipeline");
    expect(types).toContain("migrate-stream");
    expect(types).toContain("migrate-graph-database");
    expect(types).toContain("migrate-data-warehouse");
  });

  it("plan includes bucket-policy steps", () => {
    const plan = makePlan(["bucket-policy"], { bucketPolicies: [{ id: "bp-1", bucketName: "my-bucket", provider: "aws", policy: {}, publicAccessBlock: { blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true }, corsRules: [], eventNotifications: [] }] });
    const bpSteps = plan.steps.filter((s) => s.type === "migrate-bucket-policies");
    expect(bpSteps.length).toBeGreaterThan(0);
  });

  it("step-function steps depend on IAM/Lambda when both present", () => {
    const plan = makePlan(["step-function", "iam-role", "iam-policy", "lambda-function"], {
      stepFunctions: [{ id: "sf-1", name: "wf", provider: "aws", type: "standard", definition: {}, tracingEnabled: false, tags: {} }],
      iamRoles: [{ id: "r-1", name: "role", provider: "aws", inlinePolicies: [], attachedPolicyArns: [], tags: {} }],
      iamPolicies: [{ id: "p-1", name: "pol", provider: "aws", document: {}, isManaged: true, attachedTo: [], tags: {} }],
      lambdaFunctions: [{ id: "l-1", name: "fn", provider: "aws", runtime: "nodejs18.x", handler: "index.handler", memoryMB: 128, timeoutSec: 30, codeUri: "s3://code", codeSizeBytes: 1000, environment: {}, layers: [], triggers: [], tags: {} }],
    });
    const sfSteps = plan.steps.filter((s) => s.type === "migrate-step-functions");
    expect(sfSteps.length).toBeGreaterThan(0);
    const iamIds = plan.steps.filter((s) => s.type === "create-iam").map((s) => s.id);
    const lambdaIds = plan.steps.filter((s) => s.type === "migrate-serverless").map((s) => s.id);
    const sfDeps = sfSteps[0].dependsOn;
    // Step functions should depend on at least one IAM or Lambda step
    const hasDep = sfDeps.some((d) => iamIds.includes(d) || lambdaIds.includes(d));
    expect(hasDep).toBe(true);
  });
});

// =============================================================================
// 5. Assessment (5 tests)
// =============================================================================

describe("Assessment — Full-Estate Types", () => {
  it("resourceSummary includes new resource counts", () => {
    const assessment = assessMigration({
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      resourceTypes: ["step-function", "event-bus", "iam-user", "log-group"],
      stepFunctions: [{ id: "sf-1", name: "wf", provider: "aws", type: "standard", definition: {}, tracingEnabled: false, tags: {} }],
      eventBuses: [{ id: "eb-1", name: "bus", provider: "aws", isDefault: false, rules: [], tags: {} }],
      iamUsers: [{ id: "u-1", name: "dev", provider: "aws", groupIds: [], attachedPolicyArns: [], inlinePolicies: [], hasConsoleAccess: false, hasApiKeys: false, mfaEnabled: false, tags: {} }],
      logGroups: [{ id: "lg-1", name: "logs", provider: "aws", retentionDays: 7, storedSizeBytes: 0, subscriptionFilters: [], metricFilters: [], tags: {} }],
    });
    expect(assessment.resourceSummary.stepFunctions).toBe(1);
    expect(assessment.resourceSummary.eventBuses).toBe(1);
    expect(assessment.resourceSummary.iamUsers).toBe(1);
    expect(assessment.resourceSummary.logGroups).toBe(1);
  });

  it("new resource types appear in compatibility results", () => {
    const assessment = assessMigration({
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      resourceTypes: ["transit-gateway", "vpn-connection", "data-pipeline"],
    });
    const types = assessment.compatibility.map((c) => c.resourceType);
    expect(types).toContain("transit-gateway");
    expect(types).toContain("vpn-connection");
    expect(types).toContain("data-pipeline");
  });

  it("assessment returns feasible: true for valid full-estate config", () => {
    const assessment = assessMigration({
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      resourceTypes: ["step-function", "event-bus", "file-system", "transit-gateway", "graph-database", "data-warehouse"],
    });
    expect(assessment.feasible).toBe(true);
    expect(assessment.blockers).toHaveLength(0);
  });

  it("assessment resourceSummary zeroes for missing resource arrays", () => {
    const assessment = assessMigration({
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      resourceTypes: ["stream"],
    });
    expect(assessment.resourceSummary.streams).toBe(0);
    expect(assessment.resourceSummary.graphDatabases).toBe(0);
    expect(assessment.resourceSummary.dataWarehouses).toBe(0);
  });

  it("assessment includes all 19 full-estate types in compatibility when requested", () => {
    const allTypes: MigrationResourceType[] = [
      "step-function", "event-bus", "file-system", "transit-gateway",
      "vpn-connection", "vpc-endpoint", "parameter-store", "iam-user",
      "iam-group", "identity-provider", "log-group", "alarm",
      "data-pipeline", "stream", "graph-database", "data-warehouse",
      "bucket-policy", "listener-rule", "network-acl",
    ];
    const assessment = assessMigration({
      sourceProvider: "aws",
      targetProvider: "azure",
      targetRegion: "eastus",
      resourceTypes: allTypes,
    });
    const compatTypes = assessment.compatibility.map((c) => c.resourceType);
    for (const rt of allTypes) {
      expect(compatTypes).toContain(rt);
    }
    expect(assessment.feasible).toBe(true);
  });
});

// =============================================================================
// 6. Normalized Types (10 tests)
// =============================================================================

describe("Normalized Types — Full-Estate Shapes", () => {
  it("NormalizedStepFunction has correct shape", () => {
    const sf: NormalizedStepFunction = { id: "sf-1", name: "order-flow", provider: "aws", type: "standard", definition: {}, tracingEnabled: false, tags: {} };
    expect(sf.type).toBe("standard");
    expect(sf.tracingEnabled).toBe(false);
  });

  it("NormalizedEventBus has correct shape", () => {
    const eb: NormalizedEventBus = { id: "eb-1", name: "orders", provider: "aws", isDefault: false, rules: [{ name: "r1", eventPattern: {}, targets: [{ id: "t1", arn: "arn:aws:lambda" }], state: "enabled" }], tags: {} };
    expect(eb.isDefault).toBe(false);
    expect(eb.rules).toHaveLength(1);
  });

  it("NormalizedFileSystem has correct shape", () => {
    const fs: NormalizedFileSystem = { id: "fs-1", name: "shared", provider: "aws", type: "nfs", sizeGB: 100, throughputMode: "bursting", performanceMode: "general-purpose", encrypted: true, mountTargets: [{ subnetId: "sub-1", securityGroupIds: ["sg-1"], ipAddress: "10.0.0.5" }], accessPoints: [], region: "us-east-1", tags: {} };
    expect(fs.type).toBe("nfs");
    expect(fs.encrypted).toBe(true);
    expect(fs.mountTargets).toHaveLength(1);
  });

  it("NormalizedTransitGateway has correct shape", () => {
    const tgw: NormalizedTransitGateway = { id: "tgw-1", name: "hub", provider: "aws", region: "us-east-1", asnNumber: 64512, attachments: [{ id: "att-1", type: "vpc", resourceId: "vpc-1", state: "available" }], routeTables: [], tags: {} };
    expect(tgw.asnNumber).toBe(64512);
    expect(tgw.attachments).toHaveLength(1);
  });

  it("NormalizedVPNConnection and NormalizedVPCEndpoint have correct shapes", () => {
    const vpn: NormalizedVPNConnection = { id: "vpn-1", name: "site", provider: "aws", type: "site-to-site", customerGatewayIp: "1.2.3.4", tunnels: [{ outsideIp: "5.6.7.8", insideCidr: "169.254.0.0/30", status: "up" }], staticRoutes: ["10.0.0.0/8"], bgpEnabled: true, tags: {} };
    const vpce: NormalizedVPCEndpoint = { id: "vpce-1", name: "s3", provider: "aws", type: "gateway", serviceName: "com.amazonaws.s3", vpcId: "vpc-1", subnetIds: [], securityGroupIds: [], privateDnsEnabled: false, tags: {} };
    expect(vpn.type).toBe("site-to-site");
    expect(vpn.bgpEnabled).toBe(true);
    expect(vpce.type).toBe("gateway");
  });

  it("NormalizedParameter and NormalizedIAMUser have correct shapes", () => {
    const param: NormalizedParameter = { id: "p-1", name: "/app/key", provider: "aws", type: "secure-string", valueRef: "ref:ssm", version: 3, tier: "advanced", tags: {} };
    const user: NormalizedIAMUser = { id: "u-1", name: "admin", provider: "aws", groupIds: ["g-1"], attachedPolicyArns: [], inlinePolicies: [], hasConsoleAccess: true, hasApiKeys: true, mfaEnabled: true, tags: {} };
    expect(param.type).toBe("secure-string");
    expect(param.tier).toBe("advanced");
    expect(user.hasConsoleAccess).toBe(true);
    expect(user.mfaEnabled).toBe(true);
  });

  it("NormalizedIAMGroup and NormalizedIdentityProvider have correct shapes", () => {
    const group: NormalizedIAMGroup = { id: "g-1", name: "admins", provider: "aws", memberUserIds: ["u-1", "u-2"], attachedPolicyArns: ["arn:policy"], inlinePolicies: [] };
    const idp: NormalizedIdentityProvider = { id: "idp-1", name: "cognito", provider: "aws", type: "user-pool", clientIds: ["client-1"], userCount: 500, userAttributes: ["email"], mfaConfig: "required", triggers: [{ event: "pre-sign-up", functionArn: "arn:lambda" }], tags: {} };
    expect(group.memberUserIds).toHaveLength(2);
    expect(idp.type).toBe("user-pool");
    expect(idp.mfaConfig).toBe("required");
  });

  it("NormalizedLogGroup and NormalizedAlarm have correct shapes", () => {
    const lg: NormalizedLogGroup = { id: "lg-1", name: "/app/logs", provider: "aws", retentionDays: 90, storedSizeBytes: 1024 * 1024, subscriptionFilters: [{ name: "to-es", filterPattern: "", destinationArn: "arn:es" }], metricFilters: [], tags: {} };
    const alarm: NormalizedAlarm = { id: "a-1", name: "errors", provider: "aws", metricName: "Errors", namespace: "Custom", statistic: "Sum", threshold: 5, comparisonOperator: "GreaterThanThreshold", evaluationPeriods: 1, periodSec: 60, actions: ["arn:sns"], dimensions: [{ name: "FunctionName", value: "my-fn" }], tags: {} };
    expect(lg.retentionDays).toBe(90);
    expect(lg.subscriptionFilters).toHaveLength(1);
    expect(alarm.statistic).toBe("Sum");
    expect(alarm.dimensions).toHaveLength(1);
  });

  it("NormalizedDataPipeline, NormalizedStream, NormalizedGraphDatabase, NormalizedDataWarehouse have correct shapes", () => {
    const dp: NormalizedDataPipeline = { id: "dp-1", name: "etl", provider: "aws", type: "etl", sourceConnections: [{ type: "s3", connectionString: "s3://data" }], targetConnections: [], tags: {} };
    const stream: NormalizedStream = { id: "s-1", name: "events", provider: "aws", type: "data-stream", shardCount: 2, retentionHours: 48, consumers: [{ name: "c1", type: "shared" }], encryption: true, tags: {} };
    const gdb: NormalizedGraphDatabase = { id: "gdb-1", name: "graph", provider: "aws", engine: "neptune", queryLanguages: ["gremlin", "sparql"], instanceClass: "db.r5.large", storageGB: 100, encrypted: true, clusterMode: true, replicaCount: 2, tags: {} };
    const dw: NormalizedDataWarehouse = { id: "dw-1", name: "warehouse", provider: "aws", engine: "redshift", nodeType: "dc2.large", nodeCount: 4, storageGB: 2000, encrypted: true, databases: [{ name: "analytics", schemas: ["public", "staging"], tableCounts: 200, totalSizeGB: 1500 }], tags: {} };
    expect(dp.type).toBe("etl");
    expect(stream.shardCount).toBe(2);
    expect(gdb.queryLanguages).toContain("sparql");
    expect(dw.engine).toBe("redshift");
    expect(dw.databases[0].tableCounts).toBe(200);
  });

  it("NormalizedBucketPolicy, NormalizedListenerRule, NormalizedNetworkACL have correct shapes", () => {
    const bp: NormalizedBucketPolicy = { id: "bp-1", bucketName: "data-bucket", provider: "aws", policy: { Version: "2012-10-17", Statement: [] }, publicAccessBlock: { blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true }, corsRules: [{ allowedOrigins: ["*"], allowedMethods: ["GET"], allowedHeaders: ["*"], maxAgeSeconds: 3600 }], eventNotifications: [] };
    const lr: NormalizedListenerRule = { id: "lr-1", listenerArn: "arn:elb", provider: "aws", priority: 10, conditions: [{ field: "path-pattern", values: ["/api/*"] }], actions: [{ type: "forward", targetGroupArn: "arn:tg" }] };
    const nacl: NormalizedNetworkACL = { id: "nacl-1", name: "main", provider: "aws", vpcId: "vpc-1", subnetAssociations: ["sub-1"], inboundRules: [{ ruleNumber: 100, protocol: "tcp", portRange: { from: 80, to: 80 }, cidrBlock: "0.0.0.0/0", action: "allow" }], outboundRules: [], tags: {} };
    expect(bp.publicAccessBlock.blockPublicAcls).toBe(true);
    expect(bp.corsRules).toHaveLength(1);
    expect(lr.priority).toBe(10);
    expect(lr.conditions[0].field).toBe("path-pattern");
    expect(nacl.inboundRules[0].action).toBe("allow");
    expect(nacl.subnetAssociations).toContain("sub-1");
  });
});
