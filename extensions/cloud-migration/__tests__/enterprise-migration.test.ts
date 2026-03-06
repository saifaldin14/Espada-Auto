/**
 * Enterprise Migration Tests — Full AWS Estate Migration
 *
 * Tests covering all enterprise resource types: IAM, secrets, KMS, containers,
 * serverless, VPC/subnet/LB, messaging, CDN, WAF, certificates, NoSQL, cache,
 * auto-scaling. Validates planner, lifecycle wiring, compatibility, and handlers.
 */

import { describe, it, expect } from "vitest";

import type {
  MigrationProvider,
  MigrationResourceType,
  MigrationStepHandler,
  MigrationStepContext,
  NormalizedIAMRole,
  NormalizedIAMPolicy,
  NormalizedSecret,
  NormalizedKMSKey,
  NormalizedLambdaFunction,
  NormalizedAPIGateway,
  NormalizedContainerService,
  NormalizedContainerRegistry,
  NormalizedVPCResource,
  NormalizedLoadBalancer,
  NormalizedQueue,
  NormalizedNotificationTopic,
  NormalizedCDN,
  NormalizedCertificate,
  NormalizedWAFRule,
  NormalizedNoSQLDatabase,
  NormalizedCacheCluster,
  NormalizedAutoScalingGroup,
  NormalizedVM,
  NormalizedBucket,
  NormalizedSecurityRule,
  NormalizedDNSRecord,
} from "../src/types.js";

import {
  assessMigration,
  generatePlan,
  type MigrationAssessment,
  type ResourceSummary,
} from "../src/core/migration-planner.js";

import {
  checkCompatibility,
  checkAllCompatibility,
  getFullCompatibilityMatrix,
} from "../src/core/compatibility-matrix.js";

// Import all enterprise step handlers
import { extractIAMHandler } from "../src/identity/steps/extract-iam.js";
import { createIAMHandler } from "../src/identity/steps/create-iam.js";
import { migrateSecretsHandler } from "../src/identity/steps/migrate-secrets.js";
import { migrateKMSHandler } from "../src/identity/steps/migrate-kms.js";
import { migrateContainersHandler } from "../src/container/steps/migrate-containers.js";
import { migrateContainerRegistryHandler } from "../src/container/steps/migrate-container-registry.js";
import { migrateServerlessHandler } from "../src/serverless/steps/migrate-serverless.js";
import { migrateAPIGatewayHandler } from "../src/serverless/steps/migrate-api-gateway.js";
import { createVPCHandler } from "../src/network/steps/create-vpc.js";
import { createSubnetHandler } from "../src/network/steps/create-subnet.js";
import { createRouteTableHandler } from "../src/network/steps/create-route-table.js";
import { createLoadBalancerHandler } from "../src/network/steps/create-load-balancer.js";
import { migrateQueuesHandler } from "../src/messaging/steps/migrate-queues.js";
import { migrateTopicsHandler } from "../src/messaging/steps/migrate-topics.js";
import { migrateCDNHandler } from "../src/edge/steps/migrate-cdn.js";
import { migrateCertificatesHandler } from "../src/edge/steps/migrate-certificates.js";
import { migrateWAFHandler } from "../src/edge/steps/migrate-waf.js";
import { migrateNoSQLHandler } from "../src/data/steps/migrate-nosql.js";
import { migrateCacheHandler } from "../src/data/steps/migrate-cache.js";
import { migrateAutoScalingHandler } from "../src/compute/steps/migrate-auto-scaling.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function makeCtx(params: Record<string, unknown> = {}): MigrationStepContext {
  return {
    params,
    globalParams: { sourceProvider: "aws", targetProvider: "azure", targetRegion: "eastus", jobId: "test-job" },
    tags: {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

function makeIAMRole(overrides: Partial<NormalizedIAMRole> = {}): NormalizedIAMRole {
  return {
    id: "role-1",
    name: "AdminRole",
    provider: "aws",
    arn: "arn:aws:iam::123:role/AdminRole",
    description: "Admin role",
    trustPolicy: { Version: "2012-10-17", Statement: [] },
    inlinePolicies: [],
    attachedPolicyArns: ["arn:aws:iam::aws:policy/AdministratorAccess"],
    tags: { team: "platform" },
    ...overrides,
  };
}

function makeIAMPolicy(overrides: Partial<NormalizedIAMPolicy> = {}): NormalizedIAMPolicy {
  return {
    id: "policy-1",
    name: "ReadOnlyAccess",
    provider: "aws",
    arn: "arn:aws:iam::aws:policy/ReadOnlyAccess",
    description: "Read-only",
    document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "s3:Get*", Resource: "*" }] },
    isManaged: true,
    attachedTo: ["role-1"],
    tags: {},
    ...overrides,
  };
}

function makeSecret(overrides: Partial<NormalizedSecret> = {}): NormalizedSecret {
  return {
    id: "secret-1",
    name: "db-password",
    provider: "aws",
    description: "Database password",
    valueRef: "arn:aws:secretsmanager:us-east-1:123:secret:db-password",
    rotationEnabled: true,
    rotationDays: 30,
    kmsKeyId: "key-1",
    tags: {},
    ...overrides,
  };
}

function makeKMSKey(overrides: Partial<NormalizedKMSKey> = {}): NormalizedKMSKey {
  return {
    id: "key-1",
    alias: "alias/my-key",
    provider: "aws",
    keyType: "symmetric",
    usage: "encrypt-decrypt",
    state: "enabled",
    rotationEnabled: true,
    policy: { Version: "2012-10-17", Statement: [] },
    tags: {},
    ...overrides,
  };
}

function makeLambda(overrides: Partial<NormalizedLambdaFunction> = {}): NormalizedLambdaFunction {
  return {
    id: "fn-1",
    name: "my-function",
    provider: "aws",
    runtime: "nodejs18.x",
    handler: "index.handler",
    memoryMB: 256,
    timeoutSec: 30,
    codeUri: "s3://bucket/code.zip",
    codeSizeBytes: 1_000_000,
    environment: { NODE_ENV: "production" },
    layers: [],
    triggers: [{ type: "api-gateway", config: {} }],
    tags: {},
    ...overrides,
  };
}

function makeAPIGateway(overrides: Partial<NormalizedAPIGateway> = {}): NormalizedAPIGateway {
  return {
    id: "apigw-1",
    name: "my-api",
    provider: "aws",
    type: "rest",
    endpoint: "https://abc.execute-api.us-east-1.amazonaws.com/prod",
    routes: [{ path: "/users", method: "GET", integration: "lambda:fn-1" }],
    stages: ["prod", "staging"],
    tags: {},
    ...overrides,
  };
}

function makeContainerService(overrides: Partial<NormalizedContainerService> = {}): NormalizedContainerService {
  return {
    id: "svc-1",
    name: "web-api",
    provider: "aws",
    type: "ecs",
    region: "us-east-1",
    clusterArn: "arn:aws:ecs:us-east-1:123:cluster/prod",
    services: [
      { name: "web", image: "123.dkr.ecr.us-east-1.amazonaws.com/web:latest", cpu: 512, memoryMB: 1024, desiredCount: 3, ports: [{ containerPort: 8080, protocol: "tcp" }], environment: {} },
    ],
    nodeGroups: [{ name: "default", instanceType: "t3.medium", desiredCount: 3, minCount: 1, maxCount: 6 }],
    tags: {},
    ...overrides,
  };
}

function makeContainerRegistry(overrides: Partial<NormalizedContainerRegistry> = {}): NormalizedContainerRegistry {
  return {
    id: "reg-1",
    name: "my-ecr",
    provider: "aws",
    uri: "123.dkr.ecr.us-east-1.amazonaws.com",
    repositories: [{ name: "web", imageCount: 50, totalSizeBytes: 5_000_000_000, tags: ["latest", "v1.0"] }],
    scanOnPush: true,
    encryption: true,
    tags: {},
    ...overrides,
  };
}

function makeVPC(overrides: Partial<NormalizedVPCResource> = {}): NormalizedVPCResource {
  return {
    id: "vpc-1",
    name: "prod-vpc",
    provider: "aws",
    region: "us-east-1",
    cidrBlocks: ["10.0.0.0/16"],
    subnets: [
      { id: "sub-1", name: "public-1a", cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a", public: true },
      { id: "sub-2", name: "private-1a", cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1a", public: false },
    ],
    routeTables: [
      { id: "rt-1", name: "main", routes: [{ destination: "0.0.0.0/0", target: "igw-abc" }] },
    ],
    internetGateway: true,
    natGateway: true,
    tags: {},
    ...overrides,
  };
}

function makeLoadBalancer(overrides: Partial<NormalizedLoadBalancer> = {}): NormalizedLoadBalancer {
  return {
    id: "lb-1",
    name: "prod-alb",
    provider: "aws",
    type: "application",
    scheme: "external",
    vpcId: "vpc-1",
    listeners: [{ port: 443, protocol: "HTTPS", targetGroupArn: "tg-1", certificateArn: "cert-1" }],
    targetGroups: [{ name: "web-tg", port: 8080, protocol: "HTTP", healthCheckPath: "/health", targets: ["i-abc", "i-def"] }],
    tags: {},
    ...overrides,
  };
}

function makeQueue(overrides: Partial<NormalizedQueue> = {}): NormalizedQueue {
  return {
    id: "queue-1",
    name: "order-queue",
    provider: "aws",
    type: "standard",
    visibilityTimeoutSec: 30,
    retentionDays: 4,
    delaySeconds: 0,
    encryption: true,
    tags: {},
    ...overrides,
  };
}

function makeTopic(overrides: Partial<NormalizedNotificationTopic> = {}): NormalizedNotificationTopic {
  return {
    id: "topic-1",
    name: "order-events",
    provider: "aws",
    subscriptions: [
      { protocol: "sqs", endpoint: "arn:aws:sqs:us-east-1:123:order-queue" },
      { protocol: "lambda", endpoint: "arn:aws:lambda:us-east-1:123:function:processor" },
    ],
    encryption: true,
    tags: {},
    ...overrides,
  };
}

function makeCDN(overrides: Partial<NormalizedCDN> = {}): NormalizedCDN {
  return {
    id: "cdn-1",
    name: "web-distribution",
    provider: "aws",
    domainName: "d1234.cloudfront.net",
    origins: [{ id: "origin-1", domainName: "web-alb.us-east-1.elb.amazonaws.com", protocol: "https-only" }],
    certificateArn: "cert-1",
    wafAclId: "waf-1",
    tags: {},
    ...overrides,
  };
}

function makeCertificate(overrides: Partial<NormalizedCertificate> = {}): NormalizedCertificate {
  return {
    id: "cert-1",
    domainName: "example.com",
    provider: "aws",
    subjectAlternativeNames: ["*.example.com"],
    issuer: "Amazon",
    status: "issued",
    notBefore: "2024-01-01T00:00:00Z",
    notAfter: "2025-01-01T00:00:00Z",
    type: "managed",
    tags: {},
    ...overrides,
  };
}

function makeWAFRule(overrides: Partial<NormalizedWAFRule> = {}): NormalizedWAFRule {
  return {
    id: "waf-1",
    name: "web-acl",
    provider: "aws",
    rules: [
      { name: "SQLi", priority: 1, action: "block", condition: "sqli-detection" },
      { name: "XSS", priority: 2, action: "block", condition: "xss-detection" },
    ],
    scope: "regional",
    associatedResources: ["cdn-1"],
    tags: {},
    ...overrides,
  };
}

function makeNoSQLDatabase(overrides: Partial<NormalizedNoSQLDatabase> = {}): NormalizedNoSQLDatabase {
  return {
    id: "nosql-1",
    name: "orders-table",
    provider: "aws",
    engine: "dynamodb",
    tables: [
      { name: "orders", partitionKey: "orderId", sortKey: "timestamp", itemCount: 1_000_000, sizeBytes: 500_000_000, gsiCount: 2, streamEnabled: true },
    ],
    region: "us-east-1",
    encryption: true,
    backupEnabled: true,
    tags: {},
    ...overrides,
  };
}

function makeCacheCluster(overrides: Partial<NormalizedCacheCluster> = {}): NormalizedCacheCluster {
  return {
    id: "cache-1",
    name: "session-cache",
    provider: "aws",
    engine: "redis",
    version: "7.0",
    nodeType: "cache.r6g.large",
    nodeCount: 3,
    port: 6379,
    endpoint: "session-cache.abc.clustercfg.useast1.cache.amazonaws.com",
    encryption: true,
    authEnabled: true,
    tags: {},
    ...overrides,
  };
}

function makeAutoScalingGroup(overrides: Partial<NormalizedAutoScalingGroup> = {}): NormalizedAutoScalingGroup {
  return {
    id: "asg-1",
    name: "web-asg",
    provider: "aws",
    minSize: 2,
    maxSize: 10,
    desiredSize: 4,
    launchTemplate: "lt-abc",
    instanceType: "t3.large",
    imageId: "ami-abc",
    subnetIds: ["sub-1", "sub-2"],
    targetGroupArns: ["tg-1"],
    healthCheckType: "elb",
    scalingPolicies: [
      { name: "cpu-scaling", type: "target-tracking", metric: "CPUUtilization", targetValue: 70 },
    ],
    tags: {},
    ...overrides,
  };
}

// =============================================================================
// Compatibility Matrix — Enterprise Resource Types
// =============================================================================

describe("enterprise-migration", () => {
  const ENTERPRISE_RESOURCE_TYPES: MigrationResourceType[] = [
    "iam-role", "iam-policy", "secret", "kms-key",
    "lambda-function", "api-gateway",
    "container-service", "container-registry",
    "vpc", "subnet", "route-table",
    "queue", "notification-topic",
    "cdn", "certificate", "waf-rule",
    "nosql-database", "cache", "auto-scaling-group",
  ];

  const CLOUD_PROVIDERS: MigrationProvider[] = ["aws", "azure", "gcp"];

  describe("compatibility-matrix — enterprise resources", () => {
    it("has rules for all enterprise resource types between cloud providers", () => {
      for (const source of CLOUD_PROVIDERS) {
        for (const target of CLOUD_PROVIDERS) {
          if (source === target) continue;
          for (const rt of ENTERPRISE_RESOURCE_TYPES) {
            const result = checkCompatibility(source, target, rt);
            expect(result.compatible).toBe(true);
            expect(result.resourceType).toBe(rt);
          }
        }
      }
    });

    it("has rules for enterprise resources between cloud and on-premises", () => {
      const onPremProviders: MigrationProvider[] = ["on-premises", "vmware", "nutanix"];
      for (const cloud of CLOUD_PROVIDERS) {
        for (const onPrem of onPremProviders) {
          for (const rt of ENTERPRISE_RESOURCE_TYPES) {
            const result = checkCompatibility(cloud, onPrem, rt);
            expect(result.compatible).toBe(true);
          }
        }
      }
    });

    it("checkAllCompatibility returns 45 resource types per pair", () => {
      const results = checkAllCompatibility("aws", "azure");
      expect(results.length).toBe(45);
    });

    it("getFullCompatibilityMatrix includes enterprise types", () => {
      const matrix = getFullCompatibilityMatrix();
      const iamResults = matrix.filter((r) => r.resourceType === "iam-role");
      expect(iamResults.length).toBeGreaterThan(0);
      const containerResults = matrix.filter((r) => r.resourceType === "container-service");
      expect(containerResults.length).toBeGreaterThan(0);
      const nosqlResults = matrix.filter((r) => r.resourceType === "nosql-database");
      expect(nosqlResults.length).toBeGreaterThan(0);
    });

    it("KMS key rules warn about key material non-transferability", () => {
      const result = checkCompatibility("aws", "azure", "kms-key");
      expect(result.warnings.some((w) => w.code === "KMS_NO_TRANSFER")).toBe(true);
    });

    it("IAM rules warn about model differences", () => {
      const result = checkCompatibility("aws", "gcp", "iam-role");
      expect(result.warnings.some((w) => w.code === "IAM_MODEL_DIFF")).toBe(true);
    });

    it("NoSQL rules warn about partition model differences", () => {
      const result = checkCompatibility("aws", "gcp", "nosql-database");
      expect(result.warnings.some((w) => w.code === "NOSQL_TRANSLATE")).toBe(true);
    });

    it("serverless rules warn about runtime translation", () => {
      const result = checkCompatibility("aws", "azure", "lambda-function");
      expect(result.warnings.some((w) => w.code === "RUNTIME_TRANSLATE")).toBe(true);
    });

    it("cache rules note data is ephemeral", () => {
      const result = checkCompatibility("aws", "azure", "cache");
      expect(result.warnings.some((w) => w.code === "CACHE_EPHEMERAL")).toBe(true);
    });
  });

  // =============================================================================
  // Assessment — Enterprise Resources
  // =============================================================================

  describe("assessMigration — enterprise resources", () => {
    it("accepts and summarizes all enterprise resource types", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: [
          "vm", "object-storage", "database", "iam-role", "iam-policy", "secret", "kms-key",
          "lambda-function", "api-gateway", "container-service", "container-registry",
          "vpc", "load-balancer", "queue", "notification-topic", "cdn", "certificate",
          "waf-rule", "nosql-database", "cache", "auto-scaling-group",
        ],
        vms: [],
        buckets: [],
        iamRoles: [makeIAMRole()],
        iamPolicies: [makeIAMPolicy(), makeIAMPolicy({ id: "p2", name: "WriteAccess" })],
        secrets: [makeSecret()],
        kmsKeys: [makeKMSKey()],
        lambdaFunctions: [makeLambda()],
        apiGateways: [makeAPIGateway()],
        containerServices: [makeContainerService()],
        containerRegistries: [makeContainerRegistry()],
        vpcs: [makeVPC()],
        loadBalancers: [makeLoadBalancer()],
        queues: [makeQueue()],
        topics: [makeTopic()],
        cdnDistributions: [makeCDN()],
        certificates: [makeCertificate()],
        wafRules: [makeWAFRule()],
        nosqlDatabases: [makeNoSQLDatabase()],
        cacheClusters: [makeCacheCluster()],
        autoScalingGroups: [makeAutoScalingGroup()],
      });

      const rs = assessment.resourceSummary;
      expect(rs.iamRoles).toBe(1);
      expect(rs.iamPolicies).toBe(2);
      expect(rs.secrets).toBe(1);
      expect(rs.kmsKeys).toBe(1);
      expect(rs.lambdaFunctions).toBe(1);
      expect(rs.apiGateways).toBe(1);
      expect(rs.containerServices).toBe(1);
      expect(rs.containerRegistries).toBe(1);
      expect(rs.vpcs).toBe(1);
      expect(rs.loadBalancers).toBe(1);
      expect(rs.queues).toBe(1);
      expect(rs.topics).toBe(1);
      expect(rs.cdnDistributions).toBe(1);
      expect(rs.certificates).toBe(1);
      expect(rs.wafRules).toBe(1);
      expect(rs.nosqlDatabases).toBe(1);
      expect(rs.cacheClusters).toBe(1);
      expect(rs.autoScalingGroups).toBe(1);
      expect(assessment.feasible).toBe(true);
    });

    it("assessment is feasible for aws → gcp direction", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["iam-role", "container-service", "lambda-function", "nosql-database"],
        iamRoles: [makeIAMRole()],
        containerServices: [makeContainerService()],
        lambdaFunctions: [makeLambda()],
        nosqlDatabases: [makeNoSQLDatabase()],
      });

      expect(assessment.feasible).toBe(true);
      expect(assessment.compatibility.every((c) => c.compatible)).toBe(true);
    });
  });

  // =============================================================================
  // Plan Generation — Enterprise Resources
  // =============================================================================

  describe("generatePlan — enterprise resources", () => {
    function makeDummyAssessment(source: MigrationProvider, target: MigrationProvider): MigrationAssessment {
      return assessMigration({
        sourceProvider: source,
        targetProvider: target,
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [],
      });
    }

    it("generates IAM steps for iam-role and iam-policy resources", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j1",
        name: "IAM Migration",
        description: "Migrate IAM",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["iam-role", "iam-policy"],
        assessment,
        iamRoles: [makeIAMRole()],
        iamPolicies: [makeIAMPolicy()],
      });

      const iamSteps = plan.steps.filter((s) => s.pipeline === "identity");
      expect(iamSteps.length).toBe(2);
      expect(iamSteps[0].type).toBe("extract-iam");
      expect(iamSteps[1].type).toBe("create-iam");
      expect(iamSteps[1].dependsOn).toContain(iamSteps[0].id);
    });

    it("generates secrets and KMS steps", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j2",
        name: "Secrets Migration",
        description: "Migrate secrets",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["secret", "kms-key"],
        assessment,
        secrets: [makeSecret()],
        kmsKeys: [makeKMSKey()],
      });

      const secretSteps = plan.steps.filter((s) => s.type === "migrate-secrets" || s.type === "migrate-kms");
      expect(secretSteps.length).toBe(2);
      expect(secretSteps.find((s) => s.type === "migrate-secrets")).toBeDefined();
      expect(secretSteps.find((s) => s.type === "migrate-kms")).toBeDefined();
    });

    it("generates VPC creation with route tables", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j3",
        name: "VPC Migration",
        description: "Migrate VPCs",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vpc"],
        assessment,
        vpcs: [makeVPC()],
      });

      const infra = plan.steps.filter((s) => s.pipeline === "infrastructure");
      expect(infra.length).toBe(2); // create-vpc + create-route-table
      expect(infra[0].type).toBe("create-vpc");
      expect(infra[1].type).toBe("create-route-table");
      expect(infra[1].dependsOn).toContain(infra[0].id);
    });

    it("generates load balancer steps after VPC", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j4",
        name: "LB Migration",
        description: "Migrate LBs",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vpc", "load-balancer"],
        assessment,
        vpcs: [makeVPC()],
        loadBalancers: [makeLoadBalancer()],
      });

      const lbSteps = plan.steps.filter((s) => s.type === "create-load-balancer");
      expect(lbSteps.length).toBe(1);
      // LB should depend on VPC creation
      const vpcSteps = plan.steps.filter((s) => s.type === "create-vpc");
      expect(lbSteps[0].dependsOn).toContain(vpcSteps[0].id);
    });

    it("generates container registry before container service steps", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j5",
        name: "Container Migration",
        description: "Migrate containers",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["container-service", "container-registry"],
        assessment,
        containerServices: [makeContainerService()],
        containerRegistries: [makeContainerRegistry()],
      });

      const containerSteps = plan.steps.filter((s) => s.pipeline === "container");
      expect(containerSteps.length).toBe(2);
      const regStep = containerSteps.find((s) => s.type === "migrate-container-registry");
      const svcStep = containerSteps.find((s) => s.type === "migrate-containers");
      expect(regStep).toBeDefined();
      expect(svcStep).toBeDefined();
      expect(svcStep!.dependsOn).toContain(regStep!.id);
    });

    it("generates serverless function steps before API gateway", () => {
      const assessment = makeDummyAssessment("aws", "gcp");
      const plan = generatePlan({
        jobId: "j6",
        name: "Serverless Migration",
        description: "Migrate serverless",
        sourceProvider: "aws",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["lambda-function", "api-gateway"],
        assessment,
        lambdaFunctions: [makeLambda(), makeLambda({ id: "fn-2", name: "fn-2" })],
        apiGateways: [makeAPIGateway()],
      });

      const fnSteps = plan.steps.filter((s) => s.type === "migrate-serverless");
      const gwSteps = plan.steps.filter((s) => s.type === "migrate-api-gateway");
      expect(fnSteps.length).toBe(2);
      expect(gwSteps.length).toBe(1);
      // API gateway depends on all functions
      for (const fnStep of fnSteps) {
        expect(gwSteps[0].dependsOn).toContain(fnStep.id);
      }
    });

    it("generates messaging steps (queues + topics)", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j7",
        name: "Messaging Migration",
        description: "Migrate messaging",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["queue", "notification-topic"],
        assessment,
        queues: [makeQueue()],
        topics: [makeTopic()],
      });

      const msgSteps = plan.steps.filter((s) => s.pipeline === "messaging");
      expect(msgSteps.length).toBe(2);
      expect(msgSteps[0].type).toBe("migrate-queues");
      expect(msgSteps[1].type).toBe("migrate-topics");
      expect(msgSteps[1].dependsOn).toContain("msg-queues");
    });

    it("generates edge steps (certificates → wayf → CDN)", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j8",
        name: "Edge Migration",
        description: "Migrate edge",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["cdn", "certificate", "waf-rule"],
        assessment,
        cdnDistributions: [makeCDN()],
        certificates: [makeCertificate()],
        wafRules: [makeWAFRule()],
      });

      const certSteps = plan.steps.filter((s) => s.type === "migrate-certificates");
      const wafSteps = plan.steps.filter((s) => s.type === "migrate-waf");
      const cdnSteps = plan.steps.filter((s) => s.type === "migrate-cdn");
      expect(certSteps.length).toBe(1);
      expect(wafSteps.length).toBe(1);
      expect(cdnSteps.length).toBe(1);
      // CDN depends on certificates and WAF
      expect(cdnSteps[0].dependsOn).toContain("edge-certs");
      expect(cdnSteps[0].dependsOn).toContain("edge-waf");
    });

    it("generates NoSQL migration steps", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j9",
        name: "NoSQL Migration",
        description: "Migrate NoSQL",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["nosql-database"],
        assessment,
        nosqlDatabases: [makeNoSQLDatabase()],
      });

      const nosqlSteps = plan.steps.filter((s) => s.type === "migrate-nosql");
      expect(nosqlSteps.length).toBe(1);
      expect(nosqlSteps[0].resourceType).toBe("nosql-database");
    });

    it("generates cache migration steps", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j10",
        name: "Cache Migration",
        description: "Migrate cache",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["cache"],
        assessment,
        cacheClusters: [makeCacheCluster()],
      });

      const cacheSteps = plan.steps.filter((s) => s.type === "migrate-cache");
      expect(cacheSteps.length).toBe(1);
      expect(cacheSteps[0].resourceType).toBe("cache");
    });

    it("generates auto-scaling steps after VMs and LBs", () => {
      const vm: NormalizedVM = {
        id: "vm-1", name: "web-1", provider: "aws", region: "us-east-1",
        cpuCores: 4, memoryGB: 16, osType: "linux", architecture: "x86_64",
        disks: [{ id: "d1", name: "root", sizeGB: 100, type: "ssd", encrypted: true, isBootDisk: true }],
        networkInterfaces: [{ id: "eni-1", privateIp: "10.0.1.10", securityGroupIds: ["sg-1"] }],
        tags: {},
      };

      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j11",
        name: "ASG Migration",
        description: "Migrate ASG",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm", "load-balancer", "auto-scaling-group"],
        assessment,
        vms: [vm],
        loadBalancers: [makeLoadBalancer()],
        autoScalingGroups: [makeAutoScalingGroup()],
      });

      const asgSteps = plan.steps.filter((s) => s.type === "migrate-auto-scaling");
      expect(asgSteps.length).toBe(1);
      // ASG depends on provisioned VMs and LBs
      const provisionSteps = plan.steps.filter((s) => s.type === "provision-vm");
      const lbSteps = plan.steps.filter((s) => s.type === "create-load-balancer");
      for (const pid of provisionSteps.map((s) => s.id)) {
        expect(asgSteps[0].dependsOn).toContain(pid);
      }
      for (const lid of lbSteps.map((s) => s.id)) {
        expect(asgSteps[0].dependsOn).toContain(lid);
      }
    });

    it("generates database pipeline steps (export → transfer → import → verify)", () => {
      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j12",
        name: "DB Migration",
        description: "Migrate DB",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["database"],
        assessment,
      });

      const dbStepTypes = plan.steps.map((s) => s.type);
      expect(dbStepTypes).toContain("export-database");
      expect(dbStepTypes).toContain("transfer-database");
      expect(dbStepTypes).toContain("import-database");
      expect(dbStepTypes).toContain("verify-schema");
    });

    it("generates cutover step depending on verification steps", () => {
      const bucket: NormalizedBucket = {
        id: "b1", name: "test-bucket", provider: "aws", region: "us-east-1",
        objectCount: 100, totalSizeBytes: 1_000_000, versioning: true,
        encryption: { enabled: true, type: "provider-managed" },
        lifecycleRules: [], tags: {},
      };

      const assessment = makeDummyAssessment("aws", "azure");
      const plan = generatePlan({
        jobId: "j13",
        name: "Full Migration",
        description: "Full",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["object-storage", "database"],
        assessment,
        buckets: [bucket],
      });

      const cutoverStep = plan.steps.find((s) => s.type === "cutover");
      expect(cutoverStep).toBeDefined();
      const verifySteps = plan.steps.filter((s) =>
        s.type === "verify-integrity" || s.type === "verify-schema",
      );
      for (const vs of verifySteps) {
        expect(cutoverStep!.dependsOn).toContain(vs.id);
      }
    });

    it("generates complete plan for full AWS estate → Azure", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: [
          "iam-role", "secret", "kms-key", "vpc", "load-balancer",
          "container-service", "container-registry", "lambda-function",
          "api-gateway", "queue", "notification-topic", "cdn", "certificate",
          "waf-rule", "nosql-database", "cache", "auto-scaling-group", "database",
        ],
        iamRoles: [makeIAMRole()],
        secrets: [makeSecret()],
        kmsKeys: [makeKMSKey()],
        vpcs: [makeVPC()],
        loadBalancers: [makeLoadBalancer()],
        containerServices: [makeContainerService()],
        containerRegistries: [makeContainerRegistry()],
        lambdaFunctions: [makeLambda()],
        apiGateways: [makeAPIGateway()],
        queues: [makeQueue()],
        topics: [makeTopic()],
        cdnDistributions: [makeCDN()],
        certificates: [makeCertificate()],
        wafRules: [makeWAFRule()],
        nosqlDatabases: [makeNoSQLDatabase()],
        cacheClusters: [makeCacheCluster()],
        autoScalingGroups: [makeAutoScalingGroup()],
      });

      const plan = generatePlan({
        jobId: "full-estate",
        name: "Full AWS → Azure",
        description: "Complete enterprise migration",
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: [
          "iam-role", "secret", "kms-key", "vpc", "load-balancer",
          "container-service", "container-registry", "lambda-function",
          "api-gateway", "queue", "notification-topic", "cdn", "certificate",
          "waf-rule", "nosql-database", "cache", "auto-scaling-group", "database",
        ],
        assessment,
        iamRoles: [makeIAMRole()],
        secrets: [makeSecret()],
        kmsKeys: [makeKMSKey()],
        vpcs: [makeVPC()],
        loadBalancers: [makeLoadBalancer()],
        containerServices: [makeContainerService()],
        containerRegistries: [makeContainerRegistry()],
        lambdaFunctions: [makeLambda()],
        apiGateways: [makeAPIGateway()],
        queues: [makeQueue()],
        topics: [makeTopic()],
        cdnDistributions: [makeCDN()],
        certificates: [makeCertificate()],
        wafRules: [makeWAFRule()],
        nosqlDatabases: [makeNoSQLDatabase()],
        cacheClusters: [makeCacheCluster()],
        autoScalingGroups: [makeAutoScalingGroup()],
      });

      expect(plan.steps.length).toBeGreaterThanOrEqual(15);
      const stepTypes = new Set(plan.steps.map((s) => s.type));
      expect(stepTypes.has("extract-iam")).toBe(true);
      expect(stepTypes.has("create-iam")).toBe(true);
      expect(stepTypes.has("migrate-secrets")).toBe(true);
      expect(stepTypes.has("migrate-kms")).toBe(true);
      expect(stepTypes.has("create-vpc")).toBe(true);
      expect(stepTypes.has("create-route-table")).toBe(true);
      expect(stepTypes.has("create-load-balancer")).toBe(true);
      expect(stepTypes.has("migrate-container-registry")).toBe(true);
      expect(stepTypes.has("migrate-containers")).toBe(true);
      expect(stepTypes.has("migrate-serverless")).toBe(true);
      expect(stepTypes.has("migrate-api-gateway")).toBe(true);
      expect(stepTypes.has("migrate-queues")).toBe(true);
      expect(stepTypes.has("migrate-topics")).toBe(true);
      expect(stepTypes.has("migrate-cdn")).toBe(true);
      expect(stepTypes.has("migrate-certificates")).toBe(true);
      expect(stepTypes.has("migrate-waf")).toBe(true);
      expect(stepTypes.has("migrate-nosql")).toBe(true);
      expect(stepTypes.has("migrate-cache")).toBe(true);
      expect(stepTypes.has("migrate-auto-scaling")).toBe(true);
      expect(stepTypes.has("export-database")).toBe(true);
      expect(stepTypes.has("import-database")).toBe(true);
      expect(stepTypes.has("verify-schema")).toBe(true);
    });

    it("on-prem source adds preflight verification before enterprise steps", () => {
      const assessment = makeDummyAssessment("vmware", "azure");
      const plan = generatePlan({
        jobId: "j-onprem",
        name: "VMware → Azure",
        description: "VMware migration",
        sourceProvider: "vmware",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["iam-role", "container-service"],
        assessment,
        iamRoles: [makeIAMRole({ provider: "vmware" })],
        containerServices: [makeContainerService({ provider: "vmware" })],
      });

      const agentStep = plan.steps.find((s) => s.type === "verify-agent");
      expect(agentStep).toBeDefined();
      const iamStep = plan.steps.find((s) => s.type === "extract-iam");
      expect(iamStep).toBeDefined();
      expect(iamStep!.dependsOn).toContain(agentStep!.id);
    });
  });

  // =============================================================================
  // Step Handler Execution — Enterprise
  // =============================================================================

  describe("step handlers — enterprise", () => {
    it("extractIAMHandler.execute returns roles and policies", async () => {
      const ctx = makeCtx({ sourceProvider: "aws" });
      ctx.sourceCredentials = {
        iam: {
          listRoles: async () => [makeIAMRole()],
          listPolicies: async () => [makeIAMPolicy()],
        },
      };
      const result = await extractIAMHandler.execute(ctx);
      expect(result).toHaveProperty("roles");
      expect(result).toHaveProperty("policies");
      expect(result).toHaveProperty("rolesCount");
      expect(result).toHaveProperty("policiesCount");
      expect(result).toHaveProperty("sourceProvider");
    });

    it("createIAMHandler.execute returns createdRoles and createdPolicies", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        roles: [makeIAMRole()],
        policies: [makeIAMPolicy()],
      });
      ctx.targetCredentials = {
        iam: {
          createRole: async () => ({ id: "r-new" }),
          createPolicy: async () => ({ id: "p-new" }),
          attachPolicy: async () => {},
        },
      };
      const result = await createIAMHandler.execute(ctx);
      expect(result).toHaveProperty("createdRoles");
      expect(result).toHaveProperty("createdPolicies");
      expect(result).toHaveProperty("rolesCreated");
      expect(result).toHaveProperty("policiesCreated");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("targetProvider");
    });

    it("migrateSecretsHandler.execute migrates secrets in-memory", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
        kmsKeys: [],
      });
      ctx.sourceCredentials = {
        secrets: {
          listSecrets: async () => [makeSecret()],
          getSecretValue: async () => "my-secret-value",
        },
      };
      ctx.targetCredentials = {
        secrets: {
          createSecret: async () => ({ id: "s-new" }),
        },
      };
      const result = await migrateSecretsHandler.execute(ctx);
      expect(result).toHaveProperty("migratedSecrets");
      expect(result).toHaveProperty("secretsCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateKMSHandler.execute creates equivalent keys", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
      });
      ctx.sourceCredentials = {
        secrets: {
          listKMSKeys: async () => [makeKMSKey()],
        },
      };
      ctx.targetCredentials = {
        secrets: {
          createKMSKey: async () => ({ id: "k-new" }),
        },
      };
      const result = await migrateKMSHandler.execute(ctx);
      expect(result).toHaveProperty("keyMapping");
      expect(result).toHaveProperty("keysCreated");
      expect(result).toHaveProperty("requiresReEncryption");
    });

    it("createVPCHandler.execute creates VPCs and subnets", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        targetRegion: "eastus",
        sourceVPCs: [makeVPC()],
      });
      ctx.targetCredentials = {
        network: {
          createVPC: async () => ({ id: "vnet-new" }),
          createSubnet: async () => ({ id: "subnet-new" }),
        },
      };
      const result = await createVPCHandler.execute(ctx);
      expect(result).toHaveProperty("createdVPCs");
      expect(result).toHaveProperty("vpcsCreated");
      expect(result).toHaveProperty("totalSubnetsCreated");
      expect(result).toHaveProperty("vpcMapping");
    });

    it("createLoadBalancerHandler.execute creates LBs", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        loadBalancers: [makeLoadBalancer()],
      });
      ctx.targetCredentials = {
        network: {
          createLoadBalancer: async () => ({ id: "alb-new" }),
        },
      };
      const result = await createLoadBalancerHandler.execute(ctx);
      expect(result).toHaveProperty("createdLBs");
      expect(result).toHaveProperty("lbsCreated");
      expect(result).toHaveProperty("lbMapping");
    });

    it("migrateContainersHandler.execute translates container services", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
        services: [makeContainerService()],
      });
      ctx.targetCredentials = {
        containers: {
          createService: async () => ({ id: "aks-svc" }),
          copyImage: async () => ({ success: true }),
        },
      };
      const result = await migrateContainersHandler.execute(ctx);
      expect(result).toHaveProperty("migratedServices");
      expect(result).toHaveProperty("servicesCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateContainerRegistryHandler.execute copies registries", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
        repositories: [{ name: "web", imageCount: 50, totalSizeBytes: 5e9, tags: ["latest"] }],
        targetRegistryUri: "myacr.azurecr.io",
      });
      ctx.targetCredentials = {
        containers: {
          createRepository: async () => ({ id: "repo-new" }),
          copyImage: async () => ({ success: true }),
        },
      };
      const result = await migrateContainerRegistryHandler.execute(ctx);
      expect(result).toHaveProperty("migratedRepos");
      expect(result).toHaveProperty("reposCount");
    });

    it("migrateServerlessHandler.execute deploys functions on target", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
        functions: [makeLambda()],
      });
      ctx.sourceCredentials = {
        serverless: {
          getFunctionCode: async () => Buffer.from("code"),
        },
      };
      ctx.targetCredentials = {
        serverless: {
          deployFunction: async () => ({ id: "fn-new" }),
        },
      };
      const result = await migrateServerlessHandler.execute(ctx);
      expect(result).toHaveProperty("migratedFunctions");
      expect(result).toHaveProperty("functionsCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateAPIGatewayHandler.execute translates routes", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
        gateways: [makeAPIGateway()],
      });
      ctx.targetCredentials = {
        serverless: {
          createAPIGateway: async () => ({ id: "apim-new" }),
        },
      };
      const result = await migrateAPIGatewayHandler.execute(ctx);
      expect(result).toHaveProperty("migratedGateways");
      expect(result).toHaveProperty("gatewaysCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateQueuesHandler.execute creates queues on target", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        queues: [makeQueue()],
      });
      ctx.targetCredentials = {
        messaging: {
          createQueue: async () => ({ id: "q-new" }),
        },
      };
      const result = await migrateQueuesHandler.execute(ctx);
      expect(result).toHaveProperty("createdQueues");
      expect(result).toHaveProperty("queuesCreated");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateTopicsHandler.execute creates topics on target", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        topics: [makeTopic()],
      });
      ctx.targetCredentials = {
        messaging: {
          createTopic: async () => ({ id: "t-new" }),
        },
      };
      const result = await migrateTopicsHandler.execute(ctx);
      expect(result).toHaveProperty("createdTopics");
      expect(result).toHaveProperty("topicsCreated");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateCDNHandler.execute creates CDN distributions", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        distributions: [makeCDN()],
      });
      ctx.targetCredentials = {
        cdn: {
          createDistribution: async () => ({ id: "cdn-new" }),
        },
      };
      const result = await migrateCDNHandler.execute(ctx);
      expect(result).toHaveProperty("createdDistributions");
      expect(result).toHaveProperty("distributionsCreated");
    });

    it("migrateCertificatesHandler.execute imports certificates", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        certificates: [makeCertificate()],
      });
      ctx.targetCredentials = {
        cdn: {
          importCertificate: async () => ({ id: "cert-new" }),
        },
      };
      const result = await migrateCertificatesHandler.execute(ctx);
      expect(result).toHaveProperty("migratedCertificates");
      expect(result).toHaveProperty("certificatesCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateWAFHandler.execute translates WAF rules", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        wafRules: [makeWAFRule()],
      });
      ctx.targetCredentials = {
        cdn: {
          createWAFRule: async () => ({ id: "waf-new" }),
        },
      };
      const result = await migrateWAFHandler.execute(ctx);
      expect(result).toHaveProperty("createdWAFRules");
      expect(result).toHaveProperty("wafRulesCreated");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateNoSQLHandler.execute migrates NoSQL databases", async () => {
      const ctx = makeCtx({
        sourceProvider: "aws",
        targetProvider: "azure",
        databases: [makeNoSQLDatabase()],
      });
      const result = await migrateNoSQLHandler.execute(ctx);
      expect(result).toHaveProperty("migratedDatabases");
      expect(result).toHaveProperty("databasesCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateCacheHandler.execute creates cache cluster config", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        clusters: [makeCacheCluster()],
      });
      const result = await migrateCacheHandler.execute(ctx);
      expect(result).toHaveProperty("migratedClusters");
      expect(result).toHaveProperty("clustersCount");
      expect(result).toHaveProperty("warnings");
    });

    it("migrateAutoScalingHandler.execute creates auto scaling groups", async () => {
      const ctx = makeCtx({
        targetProvider: "azure",
        groups: [makeAutoScalingGroup()],
      });
      const result = await migrateAutoScalingHandler.execute(ctx);
      expect(result).toHaveProperty("migratedGroups");
      expect(result).toHaveProperty("groupsCount");
      expect(result).toHaveProperty("warnings");
    });
  });

  // =============================================================================
  // Handler Contract Verification
  // =============================================================================

  describe("handler contract", () => {
    const ENTERPRISE_HANDLERS: Array<{ name: string; handler: MigrationStepHandler }> = [
      { name: "extractIAMHandler", handler: extractIAMHandler },
      { name: "createIAMHandler", handler: createIAMHandler },
      { name: "migrateSecretsHandler", handler: migrateSecretsHandler },
      { name: "migrateKMSHandler", handler: migrateKMSHandler },
      { name: "migrateContainersHandler", handler: migrateContainersHandler },
      { name: "migrateContainerRegistryHandler", handler: migrateContainerRegistryHandler },
      { name: "migrateServerlessHandler", handler: migrateServerlessHandler },
      { name: "migrateAPIGatewayHandler", handler: migrateAPIGatewayHandler },
      { name: "createVPCHandler", handler: createVPCHandler },
      { name: "createSubnetHandler", handler: createSubnetHandler },
      { name: "createRouteTableHandler", handler: createRouteTableHandler },
      { name: "createLoadBalancerHandler", handler: createLoadBalancerHandler },
      { name: "migrateQueuesHandler", handler: migrateQueuesHandler },
      { name: "migrateTopicsHandler", handler: migrateTopicsHandler },
      { name: "migrateCDNHandler", handler: migrateCDNHandler },
      { name: "migrateCertificatesHandler", handler: migrateCertificatesHandler },
      { name: "migrateWAFHandler", handler: migrateWAFHandler },
      { name: "migrateNoSQLHandler", handler: migrateNoSQLHandler },
      { name: "migrateCacheHandler", handler: migrateCacheHandler },
      { name: "migrateAutoScalingHandler", handler: migrateAutoScalingHandler },
    ];

    for (const { name, handler } of ENTERPRISE_HANDLERS) {
      it(`${name} has execute function`, () => {
        expect(typeof handler.execute).toBe("function");
      });

      // extractIAMHandler is read-only, so it doesn't need rollback
      if (name !== "extractIAMHandler") {
        it(`${name} has rollback function`, () => {
          expect(typeof handler.rollback).toBe("function");
        });
      }
    }
  });

  // =============================================================================
  // ResourceSummary Type Coverage
  // =============================================================================

  describe("ResourceSummary", () => {
    it("includes all enterprise resource count fields", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "azure",
        targetRegion: "eastus",
        resourceTypes: ["vm"],
        vms: [],
      });

      const rs = assessment.resourceSummary;
      const expectedFields = [
        "vms", "disks", "buckets", "databases", "securityRules", "dnsRecords", "totalDataGB",
        "iamRoles", "iamPolicies", "secrets", "kmsKeys", "lambdaFunctions", "apiGateways",
        "containerServices", "containerRegistries", "vpcs", "loadBalancers", "queues",
        "topics", "cdnDistributions", "certificates", "wafRules", "nosqlDatabases",
        "cacheClusters", "autoScalingGroups",
      ];

      for (const field of expectedFields) {
        expect(rs).toHaveProperty(field);
        expect(typeof (rs as Record<string, unknown>)[field]).toBe("number");
      }
    });

    it("defaults enterprise resource counts to 0", () => {
      const assessment = assessMigration({
        sourceProvider: "aws",
        targetProvider: "gcp",
        targetRegion: "us-central1",
        resourceTypes: ["vm"],
        vms: [],
      });

      const rs = assessment.resourceSummary;
      expect(rs.iamRoles).toBe(0);
      expect(rs.lambdaFunctions).toBe(0);
      expect(rs.nosqlDatabases).toBe(0);
      expect(rs.cacheClusters).toBe(0);
      expect(rs.autoScalingGroups).toBe(0);
    });
  });
});
