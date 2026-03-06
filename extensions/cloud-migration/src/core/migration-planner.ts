/**
 * Cross-Cloud Migration Engine — Migration Planner
 *
 * Assessment → ExecutionPlan generation.
 * Queries Knowledge Graph for dependencies, checks compatibility matrix,
 * estimates costs, and produces a DAG of MigrationSteps.
 */

import { randomUUID } from "node:crypto";

import type {
  MigrationProvider,
  MigrationResourceType,
  MigrationExecutionPlan,
  MigrationStep,
  MigrationStepType,
  MigrationCostEstimate,
  CompatibilityResult,
  RiskAssessment,
  RiskFactor,
  NormalizedVM,
  NormalizedBucket,
  NormalizedSecurityRule,
  NormalizedDNSRecord,
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
} from "../types.js";
import { checkCompatibility, checkAllCompatibility } from "./compatibility-matrix.js";
import { estimateMigrationCost } from "./cost-estimator.js";

// =============================================================================
// Assessment Result
// =============================================================================

export type MigrationAssessment = {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  targetRegion: string;
  resourceSummary: ResourceSummary;
  compatibility: CompatibilityResult[];
  costEstimate: MigrationCostEstimate;
  riskAssessment: RiskAssessment;
  dependencies: DependencyInfo[];
  feasible: boolean;
  blockers: string[];
};

export type ResourceSummary = {
  vms: number;
  disks: number;
  buckets: number;
  databases: number;
  securityRules: number;
  dnsRecords: number;
  totalDataGB: number;
  // Enterprise resource counts
  iamRoles: number;
  iamPolicies: number;
  secrets: number;
  kmsKeys: number;
  lambdaFunctions: number;
  apiGateways: number;
  containerServices: number;
  containerRegistries: number;
  vpcs: number;
  loadBalancers: number;
  queues: number;
  topics: number;
  cdnDistributions: number;
  certificates: number;
  wafRules: number;
  nosqlDatabases: number;
  cacheClusters: number;
  autoScalingGroups: number;
  // Full-estate enterprise resource counts
  stepFunctions: number;
  eventBuses: number;
  fileSystems: number;
  transitGateways: number;
  vpnConnections: number;
  vpcEndpoints: number;
  parameters: number;
  iamUsers: number;
  iamGroups: number;
  identityProviders: number;
  logGroups: number;
  alarms: number;
  dataPipelines: number;
  streams: number;
  graphDatabases: number;
  dataWarehouses: number;
  bucketPolicies: number;
  listenerRules: number;
  networkACLs: number;
};

export type DependencyInfo = {
  resourceId: string;
  resourceType: MigrationResourceType;
  dependsOn: Array<{ id: string; type: MigrationResourceType; relationship: string }>;
};

// =============================================================================
// Assessment
// =============================================================================

/**
 * Run a migration assessment — compatibility, cost, risk, and dependency analysis.
 */
export function assessMigration(params: {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  targetRegion: string;
  resourceTypes: MigrationResourceType[];
  vms?: NormalizedVM[];
  buckets?: NormalizedBucket[];
  securityRules?: NormalizedSecurityRule[];
  dnsRecords?: NormalizedDNSRecord[];
  dependencies?: DependencyInfo[];
  // Enterprise resources
  iamRoles?: NormalizedIAMRole[];
  iamPolicies?: NormalizedIAMPolicy[];
  secrets?: NormalizedSecret[];
  kmsKeys?: NormalizedKMSKey[];
  lambdaFunctions?: NormalizedLambdaFunction[];
  apiGateways?: NormalizedAPIGateway[];
  containerServices?: NormalizedContainerService[];
  containerRegistries?: NormalizedContainerRegistry[];
  vpcs?: NormalizedVPCResource[];
  loadBalancers?: NormalizedLoadBalancer[];
  queues?: NormalizedQueue[];
  topics?: NormalizedNotificationTopic[];
  cdnDistributions?: NormalizedCDN[];
  certificates?: NormalizedCertificate[];
  wafRules?: NormalizedWAFRule[];
  nosqlDatabases?: NormalizedNoSQLDatabase[];
  cacheClusters?: NormalizedCacheCluster[];
  autoScalingGroups?: NormalizedAutoScalingGroup[];
  // Full-estate enterprise resources
  stepFunctions?: NormalizedStepFunction[];
  eventBuses?: NormalizedEventBus[];
  fileSystems?: NormalizedFileSystem[];
  transitGateways?: NormalizedTransitGateway[];
  vpnConnections?: NormalizedVPNConnection[];
  vpcEndpoints?: NormalizedVPCEndpoint[];
  parameters?: NormalizedParameter[];
  iamUsers?: NormalizedIAMUser[];
  iamGroups?: NormalizedIAMGroup[];
  identityProviders?: NormalizedIdentityProvider[];
  logGroups?: NormalizedLogGroup[];
  alarms?: NormalizedAlarm[];
  dataPipelines?: NormalizedDataPipeline[];
  streams?: NormalizedStream[];
  graphDatabases?: NormalizedGraphDatabase[];
  dataWarehouses?: NormalizedDataWarehouse[];
  bucketPolicies?: NormalizedBucketPolicy[];
  listenerRules?: NormalizedListenerRule[];
  networkACLs?: NormalizedNetworkACL[];
}): MigrationAssessment {
  const {
    sourceProvider,
    targetProvider,
    targetRegion,
    resourceTypes,
    vms = [],
    buckets = [],
    securityRules = [],
    dnsRecords = [],
    dependencies = [],
    iamRoles = [],
    iamPolicies = [],
    secrets = [],
    kmsKeys = [],
    lambdaFunctions = [],
    apiGateways = [],
    containerServices = [],
    containerRegistries = [],
    vpcs = [],
    loadBalancers = [],
    queues = [],
    topics = [],
    cdnDistributions = [],
    certificates = [],
    wafRules = [],
    nosqlDatabases = [],
    cacheClusters = [],
    autoScalingGroups = [],
    stepFunctions = [],
    eventBuses = [],
    fileSystems = [],
    transitGateways = [],
    vpnConnections = [],
    vpcEndpoints = [],
    parameters = [],
    iamUsers = [],
    iamGroups = [],
    identityProviders = [],
    logGroups = [],
    alarms = [],
    dataPipelines = [],
    streams = [],
    graphDatabases = [],
    dataWarehouses = [],
    bucketPolicies = [],
    listenerRules = [],
    networkACLs = [],
  } = params;

  // Check compatibility for all requested resource types
  const compatibility = resourceTypes.map((rt) =>
    checkCompatibility(sourceProvider, targetProvider, rt),
  );

  // Resource summary
  const totalDiskGB = vms.reduce(
    (sum, vm) => sum + vm.disks.reduce((s, d) => s + d.sizeGB, 0),
    0,
  );
  const totalBucketGB = buckets.reduce((sum, b) => sum + b.totalSizeBytes / (1024 ** 3), 0);
  const totalDataGB = totalDiskGB + totalBucketGB;

  const resourceSummary: ResourceSummary = {
    vms: vms.length,
    disks: vms.reduce((sum, vm) => sum + vm.disks.length, 0),
    buckets: buckets.length,
    databases: resourceTypes.filter((rt) => rt === "database").length,
    securityRules: securityRules.length,
    dnsRecords: dnsRecords.length,
    totalDataGB,
    iamRoles: iamRoles.length,
    iamPolicies: iamPolicies.length,
    secrets: secrets.length,
    kmsKeys: kmsKeys.length,
    lambdaFunctions: lambdaFunctions.length,
    apiGateways: apiGateways.length,
    containerServices: containerServices.length,
    containerRegistries: containerRegistries.length,
    vpcs: vpcs.length,
    loadBalancers: loadBalancers.length,
    queues: queues.length,
    topics: topics.length,
    cdnDistributions: cdnDistributions.length,
    certificates: certificates.length,
    wafRules: wafRules.length,
    nosqlDatabases: nosqlDatabases.length,
    cacheClusters: cacheClusters.length,
    autoScalingGroups: autoScalingGroups.length,
    stepFunctions: stepFunctions.length,
    eventBuses: eventBuses.length,
    fileSystems: fileSystems.length,
    transitGateways: transitGateways.length,
    vpnConnections: vpnConnections.length,
    vpcEndpoints: vpcEndpoints.length,
    parameters: parameters.length,
    iamUsers: iamUsers.length,
    iamGroups: iamGroups.length,
    identityProviders: identityProviders.length,
    logGroups: logGroups.length,
    alarms: alarms.length,
    dataPipelines: dataPipelines.length,
    streams: streams.length,
    graphDatabases: graphDatabases.length,
    dataWarehouses: dataWarehouses.length,
    bucketPolicies: bucketPolicies.length,
    listenerRules: listenerRules.length,
    networkACLs: networkACLs.length,
  };

  // Cost estimate
  const objectCount = buckets.reduce((sum, b) => sum + b.objectCount, 0);
  const costEstimate = estimateMigrationCost({
    sourceProvider,
    targetProvider,
    resourceTypes,
    dataSizeGB: totalDataGB,
    objectCount,
    vms: vms.map((vm) => ({ cpuCores: vm.cpuCores, memoryGB: vm.memoryGB })),
    diskSizeGB: totalDiskGB,
  });

  // Risk assessment
  const riskAssessment = assessRisk({
    sourceProvider,
    targetProvider,
    compatibility,
    totalDataGB,
    vmCount: vms.length,
    hasDatabases: resourceTypes.includes("database"),
  });

  // Blockers
  const blockers: string[] = [];
  for (const cr of compatibility) {
    for (const b of cr.blockers) {
      blockers.push(`${cr.resourceType}: ${b.message}`);
    }
  }

  return {
    sourceProvider,
    targetProvider,
    targetRegion,
    resourceSummary,
    compatibility,
    costEstimate,
    riskAssessment,
    dependencies,
    feasible: blockers.length === 0,
    blockers,
  };
}

// =============================================================================
// Risk Assessment
// =============================================================================

function assessRisk(params: {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  compatibility: CompatibilityResult[];
  totalDataGB: number;
  vmCount: number;
  hasDatabases: boolean;
}): RiskAssessment {
  const factors: RiskFactor[] = [];

  // Data volume risk
  if (params.totalDataGB > 10_000) {
    factors.push({
      category: "data-volume",
      description: `Large data volume (${params.totalDataGB.toFixed(0)} GB) — transfer may take hours`,
      severity: "high",
      mitigation: "Use parallel transfer with resume support; run during maintenance window",
    });
  } else if (params.totalDataGB > 1_000) {
    factors.push({
      category: "data-volume",
      description: `Moderate data volume (${params.totalDataGB.toFixed(0)} GB)`,
      severity: "medium",
      mitigation: "Enable transfer resume and integrity verification",
    });
  }

  // VM count risk
  if (params.vmCount > 50) {
    factors.push({
      category: "vm-count",
      description: `Large VM fleet (${params.vmCount} VMs) — migration will be staged`,
      severity: "high",
      mitigation: "Stage migration in batches; verify each batch before proceeding",
    });
  }

  // Database risk
  if (params.hasDatabases) {
    factors.push({
      category: "database",
      description: "Database migration involves potential for data loss/corruption",
      severity: "high",
      mitigation: "Use schema + row count + sample verification; consider CDC for near-zero downtime",
    });
  }

  // Compatibility warnings
  const totalWarnings = params.compatibility.reduce((sum, c) => sum + c.warnings.length, 0);
  if (totalWarnings > 10) {
    factors.push({
      category: "compatibility",
      description: `${totalWarnings} compatibility warnings across resource types`,
      severity: "medium",
      mitigation: "Review all warnings before proceeding; some may require manual intervention",
    });
  }

  // Cross-provider complexity
  const isOnPrem = [params.sourceProvider, params.targetProvider].some(
    (p) => p === "on-premises" || p === "vmware" || p === "nutanix",
  );
  if (isOnPrem) {
    factors.push({
      category: "on-prem",
      description: "On-premises migration involves agent deployment and network configuration",
      severity: "high",
      mitigation: "Ensure migration agent is deployed; verify network connectivity to staging area",
    });
  }

  // Determine overall risk
  let overallRisk: RiskAssessment["overallRisk"] = "low";
  if (factors.some((f) => f.severity === "critical")) overallRisk = "critical";
  else if (factors.filter((f) => f.severity === "high").length >= 2) overallRisk = "high";
  else if (factors.some((f) => f.severity === "high")) overallRisk = "medium";
  else if (factors.some((f) => f.severity === "medium")) overallRisk = "medium";

  return { overallRisk, factors };
}

// =============================================================================
// Plan Generation
// =============================================================================

/**
 * Generate a full migration ExecutionPlan from an assessment.
 */
export function generatePlan(params: {
  jobId: string;
  name: string;
  description: string;
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  targetRegion: string;
  resourceTypes: MigrationResourceType[];
  vms?: NormalizedVM[];
  buckets?: NormalizedBucket[];
  securityRules?: NormalizedSecurityRule[];
  dnsRecords?: NormalizedDNSRecord[];
  assessment: MigrationAssessment;
  // Enterprise resources
  iamRoles?: NormalizedIAMRole[];
  iamPolicies?: NormalizedIAMPolicy[];
  secrets?: NormalizedSecret[];
  kmsKeys?: NormalizedKMSKey[];
  lambdaFunctions?: NormalizedLambdaFunction[];
  apiGateways?: NormalizedAPIGateway[];
  containerServices?: NormalizedContainerService[];
  containerRegistries?: NormalizedContainerRegistry[];
  vpcs?: NormalizedVPCResource[];
  loadBalancers?: NormalizedLoadBalancer[];
  queues?: NormalizedQueue[];
  topics?: NormalizedNotificationTopic[];
  cdnDistributions?: NormalizedCDN[];
  certificates?: NormalizedCertificate[];
  wafRules?: NormalizedWAFRule[];
  nosqlDatabases?: NormalizedNoSQLDatabase[];
  cacheClusters?: NormalizedCacheCluster[];
  autoScalingGroups?: NormalizedAutoScalingGroup[];
  // Full-estate enterprise resources
  stepFunctions?: NormalizedStepFunction[];
  eventBuses?: NormalizedEventBus[];
  fileSystems?: NormalizedFileSystem[];
  transitGateways?: NormalizedTransitGateway[];
  vpnConnections?: NormalizedVPNConnection[];
  vpcEndpoints?: NormalizedVPCEndpoint[];
  parameters?: NormalizedParameter[];
  iamUsers?: NormalizedIAMUser[];
  iamGroups?: NormalizedIAMGroup[];
  identityProviders?: NormalizedIdentityProvider[];
  logGroups?: NormalizedLogGroup[];
  alarms?: NormalizedAlarm[];
  dataPipelines?: NormalizedDataPipeline[];
  streams?: NormalizedStream[];
  graphDatabases?: NormalizedGraphDatabase[];
  dataWarehouses?: NormalizedDataWarehouse[];
  bucketPolicies?: NormalizedBucketPolicy[];
  listenerRules?: NormalizedListenerRule[];
  networkACLs?: NormalizedNetworkACL[];
}): MigrationExecutionPlan {
  const {
    jobId,
    name,
    description,
    sourceProvider,
    targetProvider,
    targetRegion,
    resourceTypes,
    vms = [],
    buckets = [],
    securityRules = [],
    dnsRecords = [],
    assessment,
    iamRoles = [],
    iamPolicies = [],
    secrets = [],
    kmsKeys = [],
    lambdaFunctions = [],
    apiGateways = [],
    containerServices = [],
    containerRegistries = [],
    vpcs = [],
    loadBalancers = [],
    queues = [],
    topics = [],
    cdnDistributions = [],
    certificates = [],
    wafRules = [],
    nosqlDatabases = [],
    cacheClusters = [],
    autoScalingGroups = [],
    stepFunctions = [],
    eventBuses = [],
    fileSystems = [],
    transitGateways = [],
    vpnConnections = [],
    vpcEndpoints = [],
    parameters = [],
    iamUsers = [],
    iamGroups = [],
    identityProviders = [],
    logGroups = [],
    alarms = [],
    dataPipelines = [],
    streams = [],
    graphDatabases = [],
    dataWarehouses = [],
    bucketPolicies = [],
    listenerRules = [],
    networkACLs = [],
  } = params;

  const steps: MigrationStep[] = [];
  const globalParams: Record<string, unknown> = {
    sourceProvider,
    targetProvider,
    targetRegion,
    jobId,
  };

  // Generate steps for each resource type
  // For on-prem providers, prepend agent verification and staging setup
  const onPremProviders = new Set<MigrationProvider>(["on-premises", "vmware", "nutanix"]);
  const sourceIsOnPrem = onPremProviders.has(sourceProvider);
  const targetIsOnPrem = onPremProviders.has(targetProvider);

  const preflightStepIds: string[] = [];

  if (sourceIsOnPrem) {
    const verifySourceId = `preflight-verify-source-agent`;
    steps.push({
      id: verifySourceId,
      type: "verify-agent",
      name: `Verify ${sourceProvider} agent`,
      description: `Pre-flight check: source migration agent on ${sourceProvider}`,
      params: { provider: sourceProvider, region: "source" },
      dependsOn: [],
      timeoutMs: 60_000,
      pipeline: "compute",
      resourceType: "vm",
      requiresRollback: false,
    });
    preflightStepIds.push(verifySourceId);

    const stagingSourceId = `preflight-staging-source`;
    steps.push({
      id: stagingSourceId,
      type: "setup-staging",
      name: `Setup source staging storage`,
      description: `Ensure S3-compatible staging bucket on ${sourceProvider}`,
      params: { provider: sourceProvider, region: "source" },
      dependsOn: [verifySourceId],
      timeoutMs: 120_000,
      pipeline: "compute",
      resourceType: "vm",
      requiresRollback: false,
    });
    preflightStepIds.push(stagingSourceId);
  }

  if (targetIsOnPrem) {
    const verifyTargetId = `preflight-verify-target-agent`;
    steps.push({
      id: verifyTargetId,
      type: "verify-agent",
      name: `Verify ${targetProvider} agent`,
      description: `Pre-flight check: target migration agent on ${targetProvider}`,
      params: { provider: targetProvider, region: "target" },
      dependsOn: [],
      timeoutMs: 60_000,
      pipeline: "compute",
      resourceType: "vm",
      requiresRollback: false,
    });
    preflightStepIds.push(verifyTargetId);

    const stagingTargetId = `preflight-staging-target`;
    steps.push({
      id: stagingTargetId,
      type: "setup-staging",
      name: `Setup target staging storage`,
      description: `Ensure S3-compatible staging bucket on ${targetProvider}`,
      params: { provider: targetProvider, region: "target" },
      dependsOn: [verifyTargetId],
      timeoutMs: 120_000,
      pipeline: "compute",
      resourceType: "vm",
      requiresRollback: false,
    });
    preflightStepIds.push(stagingTargetId);
  }

  if (resourceTypes.includes("security-rules") || resourceTypes.includes("vm")) {
    const networkSteps = generateNetworkSteps(sourceProvider, targetProvider, securityRules);
    // Make network steps depend on preflight if we have on-prem
    if (preflightStepIds.length > 0 && networkSteps.length > 0) {
      const firstNetStep = networkSteps[0];
      firstNetStep.dependsOn = [...preflightStepIds, ...firstNetStep.dependsOn];
    }
    steps.push(...networkSteps);
  }

  if (resourceTypes.includes("object-storage")) {
    for (const bucket of buckets) {
      const dataSteps = generateDataSteps(bucket, sourceProvider, targetProvider);
      if (preflightStepIds.length > 0 && dataSteps.length > 0) {
        dataSteps[0].dependsOn = [...preflightStepIds, ...dataSteps[0].dependsOn];
      }
      steps.push(...dataSteps);
    }
  }

  if (resourceTypes.includes("vm")) {
    for (const vm of vms) {
      const computeSteps = generateComputeSteps(vm, sourceProvider, targetProvider);
      if (preflightStepIds.length > 0 && computeSteps.length > 0) {
        computeSteps[0].dependsOn = [...preflightStepIds, ...computeSteps[0].dependsOn];
      }
      steps.push(...computeSteps);
    }
  }

  if (resourceTypes.includes("dns")) {
    steps.push(...generateDNSSteps(dnsRecords, sourceProvider, targetProvider));
  }

  // === Enterprise resource step generation ===

  // IAM pipeline — identity must be migrated before workloads that depend on it
  if (resourceTypes.includes("iam-role") || resourceTypes.includes("iam-policy")) {
    const iamSteps = generateIAMSteps(iamRoles, iamPolicies, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && iamSteps.length > 0) {
      iamSteps[0].dependsOn = [...preflightStepIds, ...iamSteps[0].dependsOn];
    }
    steps.push(...iamSteps);
  }

  // Secrets & KMS
  if (resourceTypes.includes("secret") || resourceTypes.includes("kms-key")) {
    const secretSteps = generateSecretsSteps(secrets, kmsKeys, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && secretSteps.length > 0) {
      secretSteps[0].dependsOn = [...preflightStepIds, ...secretSteps[0].dependsOn];
    }
    steps.push(...secretSteps);
  }

  // VPC / Infrastructure — must be created before compute/containers
  if (resourceTypes.includes("vpc") || resourceTypes.includes("subnet") || resourceTypes.includes("route-table")) {
    const vpcSteps = generateVPCSteps(vpcs, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && vpcSteps.length > 0) {
      vpcSteps[0].dependsOn = [...preflightStepIds, ...vpcSteps[0].dependsOn];
    }
    steps.push(...vpcSteps);
  }

  // Load balancers
  if (resourceTypes.includes("load-balancer")) {
    const lbSteps = generateLoadBalancerSteps(loadBalancers, sourceProvider, targetProvider);
    // LBs depend on VPC creation if VPCs are being migrated
    const vpcStepIds = steps.filter((s) => s.type === "create-vpc").map((s) => s.id);
    if (lbSteps.length > 0 && vpcStepIds.length > 0) {
      lbSteps[0].dependsOn = [...vpcStepIds, ...lbSteps[0].dependsOn];
    }
    steps.push(...lbSteps);
  }

  // Container services & registries
  if (resourceTypes.includes("container-service") || resourceTypes.includes("container-registry")) {
    const containerSteps = generateContainerSteps(containerServices, containerRegistries, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && containerSteps.length > 0) {
      containerSteps[0].dependsOn = [...preflightStepIds, ...containerSteps[0].dependsOn];
    }
    steps.push(...containerSteps);
  }

  // Serverless — Lambda/Cloud Functions and API Gateways
  if (resourceTypes.includes("lambda-function") || resourceTypes.includes("api-gateway")) {
    const serverlessSteps = generateServerlessSteps(lambdaFunctions, apiGateways, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && serverlessSteps.length > 0) {
      serverlessSteps[0].dependsOn = [...preflightStepIds, ...serverlessSteps[0].dependsOn];
    }
    steps.push(...serverlessSteps);
  }

  // Messaging — queues and topics
  if (resourceTypes.includes("queue") || resourceTypes.includes("notification-topic")) {
    const msgSteps = generateMessagingSteps(queues, topics, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && msgSteps.length > 0) {
      msgSteps[0].dependsOn = [...preflightStepIds, ...msgSteps[0].dependsOn];
    }
    steps.push(...msgSteps);
  }

  // Edge — CDN, certificates, WAF
  if (resourceTypes.includes("cdn") || resourceTypes.includes("certificate") || resourceTypes.includes("waf-rule")) {
    const edgeSteps = generateEdgeSteps(cdnDistributions, certificates, wafRules, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && edgeSteps.length > 0) {
      edgeSteps[0].dependsOn = [...preflightStepIds, ...edgeSteps[0].dependsOn];
    }
    steps.push(...edgeSteps);
  }

  // NoSQL databases
  if (resourceTypes.includes("nosql-database")) {
    const nosqlSteps = generateNoSQLSteps(nosqlDatabases, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && nosqlSteps.length > 0) {
      nosqlSteps[0].dependsOn = [...preflightStepIds, ...nosqlSteps[0].dependsOn];
    }
    steps.push(...nosqlSteps);
  }

  // Cache clusters
  if (resourceTypes.includes("cache")) {
    const cacheSteps = generateCacheSteps(cacheClusters, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && cacheSteps.length > 0) {
      cacheSteps[0].dependsOn = [...preflightStepIds, ...cacheSteps[0].dependsOn];
    }
    steps.push(...cacheSteps);
  }

  // Auto scaling groups — depend on VM provisioning and LBs
  if (resourceTypes.includes("auto-scaling-group")) {
    const asgSteps = generateAutoScalingSteps(autoScalingGroups, sourceProvider, targetProvider);
    const vmProvisionIds = steps.filter((s) => s.type === "provision-vm").map((s) => s.id);
    const lbIds = steps.filter((s) => s.type === "create-load-balancer").map((s) => s.id);
    if (asgSteps.length > 0 && (vmProvisionIds.length > 0 || lbIds.length > 0)) {
      asgSteps[0].dependsOn = [...vmProvisionIds, ...lbIds, ...asgSteps[0].dependsOn];
    }
    steps.push(...asgSteps);
  }

  // === Full-Estate Enterprise Resource Step Generation (second wave) ===

  // Orchestration — Step Functions & Event Buses
  if (resourceTypes.includes("step-function")) {
    const sfSteps = generateStepFunctionSteps(stepFunctions, sourceProvider, targetProvider);
    // Step functions depend on IAM and Lambda being ready
    const iamIds = steps.filter((s) => s.type === "create-iam").map((s) => s.id);
    const lambdaIds = steps.filter((s) => s.type === "migrate-serverless").map((s) => s.id);
    if (sfSteps.length > 0 && (iamIds.length > 0 || lambdaIds.length > 0)) {
      sfSteps[0].dependsOn = [...iamIds, ...lambdaIds, ...sfSteps[0].dependsOn];
    }
    steps.push(...sfSteps);
  }

  if (resourceTypes.includes("event-bus")) {
    const ebSteps = generateEventBusSteps(eventBuses, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && ebSteps.length > 0) {
      ebSteps[0].dependsOn = [...preflightStepIds, ...ebSteps[0].dependsOn];
    }
    steps.push(...ebSteps);
  }

  // Shared file systems — depends on VPC/network
  if (resourceTypes.includes("file-system")) {
    const fsSteps = generateFileSystemSteps(fileSystems, sourceProvider, targetProvider);
    const vpcStepIds = steps.filter((s) => s.type === "create-vpc" || s.type === "create-subnet").map((s) => s.id);
    if (fsSteps.length > 0 && vpcStepIds.length > 0) {
      fsSteps[0].dependsOn = [...vpcStepIds, ...fsSteps[0].dependsOn];
    }
    steps.push(...fsSteps);
  }

  // Transit gateways — must come before VPN connections
  if (resourceTypes.includes("transit-gateway")) {
    const tgwSteps = generateTransitGatewaySteps(transitGateways, sourceProvider, targetProvider);
    const vpcStepIds = steps.filter((s) => s.type === "create-vpc").map((s) => s.id);
    if (tgwSteps.length > 0 && vpcStepIds.length > 0) {
      tgwSteps[0].dependsOn = [...vpcStepIds, ...tgwSteps[0].dependsOn];
    }
    steps.push(...tgwSteps);
  }

  // VPN connections — depends on transit gateways
  if (resourceTypes.includes("vpn-connection")) {
    const vpnSteps = generateVPNSteps(vpnConnections, sourceProvider, targetProvider);
    const tgwIds = steps.filter((s) => s.type === "migrate-transit-gateway").map((s) => s.id);
    if (vpnSteps.length > 0 && tgwIds.length > 0) {
      vpnSteps[0].dependsOn = [...tgwIds, ...vpnSteps[0].dependsOn];
    }
    steps.push(...vpnSteps);
  }

  // VPC endpoints
  if (resourceTypes.includes("vpc-endpoint")) {
    const endpointSteps = generateVPCEndpointSteps(vpcEndpoints, sourceProvider, targetProvider);
    const vpcStepIds = steps.filter((s) => s.type === "create-vpc").map((s) => s.id);
    if (endpointSteps.length > 0 && vpcStepIds.length > 0) {
      endpointSteps[0].dependsOn = [...vpcStepIds, ...endpointSteps[0].dependsOn];
    }
    steps.push(...endpointSteps);
  }

  // Network ACLs — depends on VPC/subnets
  if (resourceTypes.includes("network-acl")) {
    const naclSteps = generateNetworkACLSteps(networkACLs, sourceProvider, targetProvider);
    const subnetIds = steps.filter((s) => s.type === "create-subnet").map((s) => s.id);
    if (naclSteps.length > 0 && subnetIds.length > 0) {
      naclSteps[0].dependsOn = [...subnetIds, ...naclSteps[0].dependsOn];
    }
    steps.push(...naclSteps);
  }

  // Listener rules — depends on load balancers
  if (resourceTypes.includes("listener-rule")) {
    const lrSteps = generateListenerRuleSteps(listenerRules, sourceProvider, targetProvider);
    const lbIds = steps.filter((s) => s.type === "create-load-balancer").map((s) => s.id);
    if (lrSteps.length > 0 && lbIds.length > 0) {
      lrSteps[0].dependsOn = [...lbIds, ...lrSteps[0].dependsOn];
    }
    steps.push(...lrSteps);
  }

  // Parameter Store — migrate after secrets/KMS
  if (resourceTypes.includes("parameter-store")) {
    const paramSteps = generateParameterSteps(parameters, sourceProvider, targetProvider);
    const secretStepIds = steps.filter((s) => s.type === "migrate-secrets" || s.type === "migrate-kms").map((s) => s.id);
    if (paramSteps.length > 0 && secretStepIds.length > 0) {
      paramSteps[0].dependsOn = [...secretStepIds, ...paramSteps[0].dependsOn];
    }
    steps.push(...paramSteps);
  }

  // IAM Users & Groups — depends on base IAM roles/policies
  if (resourceTypes.includes("iam-user") || resourceTypes.includes("iam-group")) {
    const userGroupSteps = generateIAMUserGroupSteps(iamUsers, iamGroups, sourceProvider, targetProvider);
    const iamRoleIds = steps.filter((s) => s.type === "create-iam" || s.type === "extract-iam").map((s) => s.id);
    if (userGroupSteps.length > 0 && iamRoleIds.length > 0) {
      userGroupSteps[0].dependsOn = [...iamRoleIds, ...userGroupSteps[0].dependsOn];
    }
    steps.push(...userGroupSteps);
  }

  // Identity Providers (Cognito / SSO / SAML)
  if (resourceTypes.includes("identity-provider")) {
    const idpSteps = generateIdentityProviderSteps(identityProviders, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && idpSteps.length > 0) {
      idpSteps[0].dependsOn = [...preflightStepIds, ...idpSteps[0].dependsOn];
    }
    steps.push(...idpSteps);
  }

  // Monitoring — Log groups & Alarms
  if (resourceTypes.includes("log-group") || resourceTypes.includes("alarm")) {
    const monSteps = generateMonitoringSteps(logGroups, alarms, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && monSteps.length > 0) {
      monSteps[0].dependsOn = [...preflightStepIds, ...monSteps[0].dependsOn];
    }
    steps.push(...monSteps);
  }

  // Analytics — Data Pipelines, Streams, Graph DBs, Data Warehouses
  if (resourceTypes.includes("data-pipeline")) {
    const pipeSteps = generateDataPipelineSteps(dataPipelines, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && pipeSteps.length > 0) {
      pipeSteps[0].dependsOn = [...preflightStepIds, ...pipeSteps[0].dependsOn];
    }
    steps.push(...pipeSteps);
  }

  if (resourceTypes.includes("stream")) {
    const streamSteps = generateStreamSteps(streams, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && streamSteps.length > 0) {
      streamSteps[0].dependsOn = [...preflightStepIds, ...streamSteps[0].dependsOn];
    }
    steps.push(...streamSteps);
  }

  if (resourceTypes.includes("graph-database")) {
    const graphSteps = generateGraphDatabaseSteps(graphDatabases, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && graphSteps.length > 0) {
      graphSteps[0].dependsOn = [...preflightStepIds, ...graphSteps[0].dependsOn];
    }
    steps.push(...graphSteps);
  }

  if (resourceTypes.includes("data-warehouse")) {
    const dwSteps = generateDataWarehouseSteps(dataWarehouses, sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && dwSteps.length > 0) {
      dwSteps[0].dependsOn = [...preflightStepIds, ...dwSteps[0].dependsOn];
    }
    steps.push(...dwSteps);
  }

  // Bucket policies — depends on object-storage migration
  if (resourceTypes.includes("bucket-policy")) {
    const bpSteps = generateBucketPolicySteps(bucketPolicies, sourceProvider, targetProvider);
    const createTargetIds = steps.filter((s) => s.type === "create-target").map((s) => s.id);
    if (bpSteps.length > 0 && createTargetIds.length > 0) {
      bpSteps[0].dependsOn = [...createTargetIds, ...bpSteps[0].dependsOn];
    }
    steps.push(...bpSteps);
  }

  // Database pipeline (relational)
  if (resourceTypes.includes("database")) {
    const dbSteps = generateDatabaseSteps(sourceProvider, targetProvider);
    if (preflightStepIds.length > 0 && dbSteps.length > 0) {
      dbSteps[0].dependsOn = [...preflightStepIds, ...dbSteps[0].dependsOn];
    }
    steps.push(...dbSteps);
  }

  // Add cutover step (depends on all verify steps)
  const verifyStepIds = steps.filter((s) =>
    s.type === "verify-boot" || s.type === "verify-integrity" || s.type === "verify-connectivity" || s.type === "verify-schema",
  ).map((s) => s.id);

  if (verifyStepIds.length > 0) {
    steps.push({
      id: `cutover-${randomUUID().slice(0, 8)}`,
      type: "cutover",
      name: "Final cutover",
      description: "DNS/LB switch and source decommission preparation",
      params: { verifyStepIds },
      dependsOn: verifyStepIds,
      timeoutMs: 300_000,
      pipeline: "network",
      resourceType: "dns",
      requiresRollback: true,
    });
  }

  // Estimated duration
  const estimatedDurationMs = steps.reduce((sum, s) => sum + s.timeoutMs, 0);

  return {
    id: randomUUID(),
    name,
    description,
    jobId,
    steps,
    globalParams,
    createdAt: new Date().toISOString(),
    estimatedDurationMs,
    estimatedCost: assessment.costEstimate,
    riskAssessment: assessment.riskAssessment,
  };
}

// =============================================================================
// Step Generators
// =============================================================================

function generateComputeSteps(
  vm: NormalizedVM,
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const prefix = `vm-${vm.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
  const steps: MigrationStep[] = [];

  const snapshotId = `${prefix}-snapshot`;
  steps.push({
    id: snapshotId,
    type: "snapshot-source",
    name: `Snapshot VM ${vm.name}`,
    description: `Create snapshot of source VM ${vm.name} on ${source}`,
    params: { vmId: vm.id, vmName: vm.name, provider: source },
    dependsOn: [],
    timeoutMs: 600_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const exportId = `${prefix}-export`;
  steps.push({
    id: exportId,
    type: "export-image",
    name: `Export image for ${vm.name}`,
    description: `Export VM image to staging bucket`,
    params: { snapshotId: `${snapshotId}.outputs.snapshotId`, provider: source },
    dependsOn: [snapshotId],
    timeoutMs: 1_200_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const transferId = `${prefix}-transfer`;
  steps.push({
    id: transferId,
    type: "transfer-image",
    name: `Transfer image for ${vm.name}`,
    description: `Transfer image from ${source} to ${target} staging`,
    params: {
      exportPath: `${exportId}.outputs.exportPath`,
      sourceProvider: source,
      targetProvider: target,
    },
    dependsOn: [exportId],
    timeoutMs: 1_800_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const convertId = `${prefix}-convert`;
  steps.push({
    id: convertId,
    type: "convert-image",
    name: `Convert image for ${vm.name}`,
    description: `Convert image format for ${target}`,
    params: {
      imagePath: `${transferId}.outputs.targetPath`,
      sourceFormat: "raw",
      targetProvider: target,
    },
    dependsOn: [transferId],
    timeoutMs: 1_200_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const importId = `${prefix}-import`;
  steps.push({
    id: importId,
    type: "import-image",
    name: `Import image for ${vm.name}`,
    description: `Import image as ${target} disk`,
    params: {
      convertedPath: `${convertId}.outputs.convertedPath`,
      targetProvider: target,
    },
    dependsOn: [convertId],
    timeoutMs: 900_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const remediateId = `${prefix}-remediate`;
  steps.push({
    id: remediateId,
    type: "remediate-boot",
    name: `Remediate boot for ${vm.name}`,
    description: `Inject cloud-specific drivers and agents for ${target}`,
    params: {
      diskId: `${importId}.outputs.diskId`,
      targetProvider: target,
      osType: vm.osType,
    },
    dependsOn: [importId],
    timeoutMs: 600_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: false, // Idempotent
  });

  const provisionId = `${prefix}-provision`;
  steps.push({
    id: provisionId,
    type: "provision-vm",
    name: `Provision VM ${vm.name} on ${target}`,
    description: `Create target VM from imported image`,
    params: {
      diskId: `${remediateId}.outputs.diskId`,
      vmSpec: {
        name: vm.name,
        cpuCores: vm.cpuCores,
        memoryGB: vm.memoryGB,
        osType: vm.osType,
        tags: vm.tags,
      },
      targetProvider: target,
    },
    dependsOn: [remediateId],
    timeoutMs: 600_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify`;
  steps.push({
    id: verifyId,
    type: "verify-boot",
    name: `Verify boot for ${vm.name}`,
    description: `Health-check the target VM (SSH/RDP, cloud-init completion)`,
    params: {
      vmId: `${provisionId}.outputs.vmId`,
      targetProvider: target,
    },
    dependsOn: [provisionId],
    timeoutMs: 300_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: false, // Read-only
  });

  return steps;
}

function generateDataSteps(
  bucket: NormalizedBucket,
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const prefix = `data-${bucket.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
  const steps: MigrationStep[] = [];

  const inventoryId = `${prefix}-inventory`;
  steps.push({
    id: inventoryId,
    type: "inventory-source",
    name: `Inventory ${bucket.name}`,
    description: `Enumerate all objects in source bucket ${bucket.name}`,
    params: { bucketName: bucket.name, provider: source },
    dependsOn: [],
    timeoutMs: 600_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: false, // Read-only
  });

  const createId = `${prefix}-create`;
  steps.push({
    id: createId,
    type: "create-target",
    name: `Create target for ${bucket.name}`,
    description: `Create target bucket/container on ${target}`,
    params: {
      bucketName: bucket.name,
      region: bucket.region,
      targetProvider: target,
      versioning: bucket.versioning,
    },
    dependsOn: [inventoryId],
    timeoutMs: 120_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: true,
  });

  const transferId = `${prefix}-transfer`;
  steps.push({
    id: transferId,
    type: "transfer-objects",
    name: `Transfer objects for ${bucket.name}`,
    description: `Parallel chunked transfer of ${bucket.objectCount} objects`,
    params: {
      sourceBucket: bucket.name,
      targetBucket: `${createId}.outputs.targetBucketName`,
      sourceProvider: source,
      targetProvider: target,
      objectCount: bucket.objectCount,
    },
    dependsOn: [createId],
    timeoutMs: 7_200_000, // 2 hours max for large transfers
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify`;
  steps.push({
    id: verifyId,
    type: "verify-integrity",
    name: `Verify integrity for ${bucket.name}`,
    description: `SHA-256 per-object verification`,
    params: {
      sourceBucket: bucket.name,
      targetBucket: `${createId}.outputs.targetBucketName`,
      sourceProvider: source,
      targetProvider: target,
    },
    dependsOn: [transferId],
    timeoutMs: 600_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: false, // Read-only
  });

  const metadataId = `${prefix}-metadata`;
  steps.push({
    id: metadataId,
    type: "sync-metadata",
    name: `Sync metadata for ${bucket.name}`,
    description: `Sync ACLs, lifecycle rules, tags, encryption config`,
    params: {
      targetBucket: `${createId}.outputs.targetBucketName`,
      targetProvider: target,
      lifecycle: bucket.lifecycleRules,
      tags: bucket.tags,
      encryption: bucket.encryption,
    },
    dependsOn: [verifyId],
    timeoutMs: 120_000,
    pipeline: "data",
    resourceType: "object-storage",
    requiresRollback: true,
  });

  return steps;
}

function generateNetworkSteps(
  source: MigrationProvider,
  target: MigrationProvider,
  securityRules: NormalizedSecurityRule[],
): MigrationStep[] {
  const prefix = "network";
  const steps: MigrationStep[] = [];

  const mapId = `${prefix}-map`;
  steps.push({
    id: mapId,
    type: "map-network",
    name: "Map network topology",
    description: `Discover network topology at source (${source})`,
    params: { provider: source },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "security-rules",
    requiresRollback: false,
  });

  const createRulesId = `${prefix}-rules`;
  steps.push({
    id: createRulesId,
    type: "create-security-rules",
    name: "Create security rules at target",
    description: `Translate and create ${securityRules.length} security rules on ${target}`,
    params: {
      sourceRules: securityRules,
      sourceProvider: source,
      targetProvider: target,
      networkTopology: `${mapId}.outputs.topology`,
    },
    dependsOn: [mapId],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "security-rules",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify`;
  steps.push({
    id: verifyId,
    type: "verify-connectivity",
    name: "Verify connectivity",
    description: "Post-migration connectivity test",
    params: {
      targetProvider: target,
      rulesCreated: `${createRulesId}.outputs.ruleIds`,
    },
    dependsOn: [createRulesId],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "security-rules",
    requiresRollback: false,
  });

  return steps;
}

function generateDNSSteps(
  dnsRecords: NormalizedDNSRecord[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  if (dnsRecords.length === 0) return [];

  const prefix = "dns";
  const steps: MigrationStep[] = [];

  const migrateId = `${prefix}-migrate`;
  steps.push({
    id: migrateId,
    type: "migrate-dns",
    name: "Migrate DNS records",
    description: `Migrate ${dnsRecords.length} DNS records from ${source} to ${target}`,
    params: {
      records: dnsRecords,
      sourceProvider: source,
      targetProvider: target,
    },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "network",
    resourceType: "dns",
    requiresRollback: true,
  });

  return steps;
}

// =============================================================================
// Enterprise Step Generators
// =============================================================================

function generateDatabaseSteps(
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const prefix = "db";
  const steps: MigrationStep[] = [];

  const exportId = `${prefix}-export`;
  steps.push({
    id: exportId,
    type: "export-database",
    name: "Export source database",
    description: `Export database schema + data from ${source}`,
    params: { sourceProvider: source },
    dependsOn: [],
    timeoutMs: 3_600_000,
    pipeline: "data",
    resourceType: "database",
    requiresRollback: true,
  });

  const transferId = `${prefix}-transfer`;
  steps.push({
    id: transferId,
    type: "transfer-database",
    name: "Transfer database dump",
    description: `Transfer database dump from ${source} to ${target}`,
    params: { sourceProvider: source, targetProvider: target, exportPath: `${exportId}.outputs.exportPath` },
    dependsOn: [exportId],
    timeoutMs: 3_600_000,
    pipeline: "data",
    resourceType: "database",
    requiresRollback: true,
  });

  const importId = `${prefix}-import`;
  steps.push({
    id: importId,
    type: "import-database",
    name: "Import database to target",
    description: `Import database on ${target}`,
    params: { targetProvider: target, dumpPath: `${transferId}.outputs.targetPath` },
    dependsOn: [transferId],
    timeoutMs: 3_600_000,
    pipeline: "data",
    resourceType: "database",
    requiresRollback: true,
  });

  const verifyId = `${prefix}-verify-schema`;
  steps.push({
    id: verifyId,
    type: "verify-schema",
    name: "Verify database schema",
    description: "Compare source and target schema + row counts",
    params: { sourceProvider: source, targetProvider: target },
    dependsOn: [importId],
    timeoutMs: 600_000,
    pipeline: "data",
    resourceType: "database",
    requiresRollback: false,
  });

  return steps;
}

function generateIAMSteps(
  roles: NormalizedIAMRole[],
  policies: NormalizedIAMPolicy[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  const extractId = "iam-extract";
  steps.push({
    id: extractId,
    type: "extract-iam",
    name: "Extract IAM roles & policies",
    description: `Discover ${roles.length} roles and ${policies.length} policies from ${source}`,
    params: { sourceProvider: source, roles, policies },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "identity",
    resourceType: "iam-role",
    requiresRollback: false,
  });

  const createId = "iam-create";
  steps.push({
    id: createId,
    type: "create-iam",
    name: "Create IAM roles & policies on target",
    description: `Translate and create IAM resources on ${target}`,
    params: { targetProvider: target, extractedIAM: `${extractId}.outputs` },
    dependsOn: [extractId],
    timeoutMs: 600_000,
    pipeline: "identity",
    resourceType: "iam-role",
    requiresRollback: true,
  });

  return steps;
}

function generateSecretsSteps(
  secrets: NormalizedSecret[],
  kmsKeys: NormalizedKMSKey[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  if (secrets.length > 0) {
    const secretsId = "secrets-migrate";
    steps.push({
      id: secretsId,
      type: "migrate-secrets",
      name: `Migrate ${secrets.length} secrets`,
      description: `Transfer secrets in-memory from ${source} to ${target} (never serialized to disk)`,
      params: { sourceProvider: source, targetProvider: target, secretCount: secrets.length },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "identity",
      resourceType: "secret",
      requiresRollback: true,
    });
  }

  if (kmsKeys.length > 0) {
    const kmsId = "kms-migrate";
    steps.push({
      id: kmsId,
      type: "migrate-kms",
      name: `Migrate ${kmsKeys.length} KMS keys`,
      description: `Re-create KMS key equivalents on ${target} (key material is NOT transferable)`,
      params: { sourceProvider: source, targetProvider: target, keyCount: kmsKeys.length },
      dependsOn: secrets.length > 0 ? ["secrets-migrate"] : [],
      timeoutMs: 300_000,
      pipeline: "identity",
      resourceType: "kms-key",
      requiresRollback: false,
    });
  }

  return steps;
}

function generateVPCSteps(
  vpcs: NormalizedVPCResource[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const vpc of vpcs) {
    const prefix = `vpc-${vpc.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;

    const vpcId = `${prefix}-create`;
    steps.push({
      id: vpcId,
      type: "create-vpc",
      name: `Create VPC ${vpc.name}`,
      description: `Create VPC with ${vpc.subnets.length} subnets on ${target}`,
      params: { vpc, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "infrastructure",
      resourceType: "vpc",
      requiresRollback: true,
    });

    if (vpc.routeTables.length > 0) {
      const rtId = `${prefix}-routes`;
      steps.push({
        id: rtId,
        type: "create-route-table",
        name: `Create routes for ${vpc.name}`,
        description: `Create ${vpc.routeTables.length} route tables on ${target}`,
        params: { vpcMapping: `${vpcId}.outputs.vpcMapping`, routeTables: vpc.routeTables, targetProvider: target },
        dependsOn: [vpcId],
        timeoutMs: 120_000,
        pipeline: "infrastructure",
        resourceType: "route-table",
        requiresRollback: true,
      });
    }
  }

  return steps;
}

function generateLoadBalancerSteps(
  loadBalancers: NormalizedLoadBalancer[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const lb of loadBalancers) {
    const prefix = `lb-${lb.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: `${prefix}-create`,
      type: "create-load-balancer",
      name: `Create LB ${lb.name}`,
      description: `Create ${lb.type} load balancer on ${target}`,
      params: { lb, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "infrastructure",
      resourceType: "load-balancer",
      requiresRollback: true,
    });
  }

  return steps;
}

function generateContainerSteps(
  services: NormalizedContainerService[],
  registries: NormalizedContainerRegistry[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  const registryStepIds: string[] = [];

  for (const reg of registries) {
    const rid = `creg-${reg.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: rid,
      type: "migrate-container-registry",
      name: `Migrate registry ${reg.name}`,
      description: `Copy ${reg.repositories.length} repos to ${target}`,
      params: { registry: reg, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 1_800_000,
      pipeline: "container",
      resourceType: "container-registry",
      requiresRollback: false,
    });
    registryStepIds.push(rid);
  }

  for (const svc of services) {
    const sid = `csvc-${svc.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: sid,
      type: "migrate-containers",
      name: `Migrate service ${svc.name}`,
      description: `Migrate ${svc.services.length} container defs to ${target}`,
      params: { service: svc, sourceProvider: source, targetProvider: target },
      dependsOn: registryStepIds, // depends on registries being available
      timeoutMs: 900_000,
      pipeline: "container",
      resourceType: "container-service",
      requiresRollback: true,
    });
  }

  return steps;
}

function generateServerlessSteps(
  functions: NormalizedLambdaFunction[],
  gateways: NormalizedAPIGateway[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  const functionStepIds: string[] = [];

  for (const fn of functions) {
    const fid = `fn-${fn.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: fid,
      type: "migrate-serverless",
      name: `Migrate function ${fn.name}`,
      description: `Deploy ${fn.runtime} function on ${target}`,
      params: { fn, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 600_000,
      pipeline: "serverless",
      resourceType: "lambda-function",
      requiresRollback: true,
    });
    functionStepIds.push(fid);
  }

  for (const gw of gateways) {
    const gid = `apigw-${gw.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: gid,
      type: "migrate-api-gateway",
      name: `Migrate API Gateway ${gw.name}`,
      description: `Translate ${gw.routes.length} routes for ${target}`,
      params: { gateway: gw, sourceProvider: source, targetProvider: target },
      dependsOn: functionStepIds, // APIs depend on functions
      timeoutMs: 300_000,
      pipeline: "serverless",
      resourceType: "api-gateway",
      requiresRollback: true,
    });
  }

  return steps;
}

function generateMessagingSteps(
  queues: NormalizedQueue[],
  topics: NormalizedNotificationTopic[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  if (queues.length > 0) {
    steps.push({
      id: "msg-queues",
      type: "migrate-queues",
      name: `Migrate ${queues.length} queues`,
      description: `Create equivalent queue configs on ${target}`,
      params: { queues, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "messaging",
      resourceType: "queue",
      requiresRollback: true,
    });
  }

  if (topics.length > 0) {
    steps.push({
      id: "msg-topics",
      type: "migrate-topics",
      name: `Migrate ${topics.length} topics`,
      description: `Create equivalent notification topics on ${target}`,
      params: { topics, sourceProvider: source, targetProvider: target },
      dependsOn: queues.length > 0 ? ["msg-queues"] : [],
      timeoutMs: 300_000,
      pipeline: "messaging",
      resourceType: "notification-topic",
      requiresRollback: true,
    });
  }

  return steps;
}

function generateEdgeSteps(
  cdnDistributions: NormalizedCDN[],
  certificates: NormalizedCertificate[],
  wafRules: NormalizedWAFRule[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  const certStepId = "edge-certs";
  const wafStepId = "edge-waf";

  if (certificates.length > 0) {
    steps.push({
      id: certStepId,
      type: "migrate-certificates",
      name: `Migrate ${certificates.length} certificates`,
      description: `Import/create SSL certificates on ${target}`,
      params: { certificates, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "infrastructure",
      resourceType: "certificate",
      requiresRollback: true,
    });
  }

  if (wafRules.length > 0) {
    steps.push({
      id: wafStepId,
      type: "migrate-waf",
      name: `Migrate ${wafRules.length} WAF rule sets`,
      description: `Translate WAF rules for ${target}`,
      params: { wafRules, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "infrastructure",
      resourceType: "waf-rule",
      requiresRollback: true,
    });
  }

  if (cdnDistributions.length > 0) {
    const cdnDeps: string[] = [];
    if (certificates.length > 0) cdnDeps.push(certStepId);
    if (wafRules.length > 0) cdnDeps.push(wafStepId);

    steps.push({
      id: "edge-cdn",
      type: "migrate-cdn",
      name: `Migrate ${cdnDistributions.length} CDN distributions`,
      description: `Create CDN distributions on ${target}`,
      params: { distributions: cdnDistributions, sourceProvider: source, targetProvider: target },
      dependsOn: cdnDeps,
      timeoutMs: 600_000,
      pipeline: "infrastructure",
      resourceType: "cdn",
      requiresRollback: true,
    });
  }

  return steps;
}

function generateNoSQLSteps(
  databases: NormalizedNoSQLDatabase[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const db of databases) {
    const did = `nosql-${db.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: did,
      type: "migrate-nosql",
      name: `Migrate NoSQL ${db.name}`,
      description: `Migrate ${db.tables.length} tables (${db.engine}) to ${target}`,
      params: { database: db, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 3_600_000,
      pipeline: "data",
      resourceType: "nosql-database",
      requiresRollback: false,
    });
  }

  return steps;
}

function generateCacheSteps(
  clusters: NormalizedCacheCluster[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const cluster of clusters) {
    const cid = `cache-${cluster.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: cid,
      type: "migrate-cache",
      name: `Migrate cache ${cluster.name}`,
      description: `Create ${cluster.engine} cache on ${target} (data is ephemeral)`,
      params: { cluster, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "data",
      resourceType: "cache",
      requiresRollback: true,
    });
  }

  return steps;
}

function generateAutoScalingSteps(
  groups: NormalizedAutoScalingGroup[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const asg of groups) {
    const aid = `asg-${asg.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: aid,
      type: "migrate-auto-scaling",
      name: `Migrate ASG ${asg.name}`,
      description: `Create auto-scaling group (${asg.minSize}-${asg.maxSize}) on ${target}`,
      params: { group: asg, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "compute",
      resourceType: "auto-scaling-group",
      requiresRollback: true,
    });
  }

  return steps;
}

// =============================================================================
// Full-Estate Enterprise Step Generators (Second Wave)
// =============================================================================

function generateStepFunctionSteps(
  stepFunctions: NormalizedStepFunction[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const sf of stepFunctions) {
    const sid = `sf-${sf.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: sid,
      type: "migrate-step-functions",
      name: `Migrate workflow ${sf.name}`,
      description: `Migrate ${sf.type} state machine to ${target}`,
      params: { stepFunctions: [sf], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 600_000,
      pipeline: "orchestration",
      resourceType: "step-function",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateEventBusSteps(
  eventBuses: NormalizedEventBus[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const bus of eventBuses) {
    const bid = `eb-${bus.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: bid,
      type: "migrate-event-bus",
      name: `Migrate event bus ${bus.name}`,
      description: `Migrate event bus with ${bus.rules.length} rules to ${target}`,
      params: { eventBuses: [bus], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 600_000,
      pipeline: "orchestration",
      resourceType: "event-bus",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateFileSystemSteps(
  fileSystems: NormalizedFileSystem[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const fs of fileSystems) {
    const fid = `fs-${fs.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: fid,
      type: "migrate-file-system",
      name: `Migrate FS ${fs.name}`,
      description: `Migrate ${fs.type} file system (${fs.sizeGB} GB) to ${target}`,
      params: { fileSystems: [fs], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 7_200_000,
      pipeline: "data",
      resourceType: "file-system",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateTransitGatewaySteps(
  transitGateways: NormalizedTransitGateway[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const tgw of transitGateways) {
    const tid = `tgw-${tgw.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: tid,
      type: "migrate-transit-gateway",
      name: `Migrate TGW ${tgw.name}`,
      description: `Migrate transit gateway with ${tgw.attachments.length} attachments to ${target}`,
      params: { transitGateways: [tgw], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 900_000,
      pipeline: "network",
      resourceType: "transit-gateway",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateVPNSteps(
  vpnConnections: NormalizedVPNConnection[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const vpn of vpnConnections) {
    const vid = `vpn-${vpn.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: vid,
      type: "migrate-vpn-connection",
      name: `Migrate VPN ${vpn.name}`,
      description: `Migrate ${vpn.type} VPN to ${target}`,
      params: { vpnConnections: [vpn], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 600_000,
      pipeline: "network",
      resourceType: "vpn-connection",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateVPCEndpointSteps(
  vpcEndpoints: NormalizedVPCEndpoint[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const ep of vpcEndpoints) {
    const eid = `vpce-${ep.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: eid,
      type: "migrate-vpc-endpoint",
      name: `Migrate VPC Endpoint ${ep.serviceName}`,
      description: `Migrate ${ep.type} endpoint for ${ep.serviceName} to ${target}`,
      params: { vpcEndpoints: [ep], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "network",
      resourceType: "vpc-endpoint",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateNetworkACLSteps(
  networkACLs: NormalizedNetworkACL[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const nacl of networkACLs) {
    const nid = `nacl-${nacl.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: nid,
      type: "migrate-network-acl",
      name: `Migrate NACL ${nacl.name}`,
      description: `Migrate network ACL with ${nacl.inboundRules.length + nacl.outboundRules.length} rules to ${target}`,
      params: { networkACLs: [nacl], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 120_000,
      pipeline: "network",
      resourceType: "network-acl",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateListenerRuleSteps(
  listenerRules: NormalizedListenerRule[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  if (listenerRules.length === 0) return [];
  const steps: MigrationStep[] = [];
  // Group listener rules by listenerArn for batch migration
  const byListener = new Map<string, NormalizedListenerRule[]>();
  for (const rule of listenerRules) {
    const existing = byListener.get(rule.listenerArn) ?? [];
    existing.push(rule);
    byListener.set(rule.listenerArn, existing);
  }
  for (const [listenerArn, rules] of byListener) {
    const lid = `lr-${listenerArn.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: lid,
      type: "migrate-listener-rules",
      name: `Migrate ${rules.length} listener rules`,
      description: `Migrate listener rules for ${listenerArn} to ${target}`,
      params: { listenerRules: rules, listenerArn, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "network",
      resourceType: "listener-rule",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateParameterSteps(
  parameters: NormalizedParameter[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  if (parameters.length === 0) return [];
  return [{
    id: `params-batch-${randomUUID().slice(0, 8)}`,
    type: "migrate-parameters",
    name: `Migrate ${parameters.length} parameters`,
    description: `Migrate SSM parameters / app config to ${target}`,
    params: { parameters, sourceProvider: source, targetProvider: target },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "identity",
    resourceType: "parameter-store",
    requiresRollback: true,
  }];
}

function generateIAMUserGroupSteps(
  users: NormalizedIAMUser[],
  groups: NormalizedIAMGroup[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  if (groups.length > 0) {
    steps.push({
      id: `iam-groups-${randomUUID().slice(0, 8)}`,
      type: "migrate-iam-groups",
      name: `Migrate ${groups.length} IAM groups`,
      description: `Create IAM groups with policies on ${target}`,
      params: { groups, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "identity",
      resourceType: "iam-group",
      requiresRollback: true,
    });
  }
  if (users.length > 0) {
    const groupStepIds = steps.map((s) => s.id);
    steps.push({
      id: `iam-users-${randomUUID().slice(0, 8)}`,
      type: "migrate-iam-users",
      name: `Migrate ${users.length} IAM users`,
      description: `Create IAM users on ${target} (API keys/passwords NOT transferred)`,
      params: { users, sourceProvider: source, targetProvider: target },
      dependsOn: groupStepIds,
      timeoutMs: 600_000,
      pipeline: "identity",
      resourceType: "iam-user",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateIdentityProviderSteps(
  identityProviders: NormalizedIdentityProvider[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const idp of identityProviders) {
    const iid = `idp-${idp.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: iid,
      type: "migrate-identity-provider",
      name: `Migrate IdP ${idp.name}`,
      description: `Migrate ${idp.type} identity provider (${idp.userCount} users) to ${target}`,
      params: { identityProviders: [idp], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 1_800_000,
      pipeline: "identity",
      resourceType: "identity-provider",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateMonitoringSteps(
  logGroups: NormalizedLogGroup[],
  alarms: NormalizedAlarm[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  if (logGroups.length > 0) {
    steps.push({
      id: `logs-${randomUUID().slice(0, 8)}`,
      type: "migrate-log-groups",
      name: `Migrate ${logGroups.length} log groups`,
      description: `Migrate log group configs (not historical data) to ${target}`,
      params: { logGroups, sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 300_000,
      pipeline: "monitoring",
      resourceType: "log-group",
      requiresRollback: true,
    });
  }
  if (alarms.length > 0) {
    // Alarms depend on log groups (metric filters)
    const logStepIds = steps.map((s) => s.id);
    steps.push({
      id: `alarms-${randomUUID().slice(0, 8)}`,
      type: "migrate-alarms",
      name: `Migrate ${alarms.length} alarms`,
      description: `Migrate monitoring alarms/alert policies to ${target}`,
      params: { alarms, sourceProvider: source, targetProvider: target },
      dependsOn: logStepIds,
      timeoutMs: 300_000,
      pipeline: "monitoring",
      resourceType: "alarm",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateDataPipelineSteps(
  pipelines: NormalizedDataPipeline[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const pipe of pipelines) {
    const pid = `pipe-${pipe.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: pid,
      type: "migrate-data-pipeline",
      name: `Migrate pipeline ${pipe.name}`,
      description: `Migrate ${pipe.type} pipeline to ${target}`,
      params: { pipelines: [pipe], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 1_200_000,
      pipeline: "analytics",
      resourceType: "data-pipeline",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateStreamSteps(
  streams: NormalizedStream[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const stream of streams) {
    const sid = `stream-${stream.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: sid,
      type: "migrate-stream",
      name: `Migrate stream ${stream.name}`,
      description: `Migrate ${stream.type} stream (${stream.shardCount} shards) to ${target}`,
      params: { streams: [stream], sourceProvider: source, targetProvider: target },
      dependsOn: [],
      timeoutMs: 600_000,
      pipeline: "analytics",
      resourceType: "stream",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateGraphDatabaseSteps(
  graphDatabases: NormalizedGraphDatabase[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const db of graphDatabases) {
    const gid = `graph-${db.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: gid,
      type: "migrate-graph-database",
      name: `Migrate graph DB ${db.name}`,
      description: `Migrate ${db.engine} graph database (${db.storageGB} GB) to ${target}`,
      params: { graphDatabases: [db], sourceProvider: source, targetProvider: target, transferData: true },
      dependsOn: [],
      timeoutMs: 7_200_000,
      pipeline: "analytics",
      resourceType: "graph-database",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateDataWarehouseSteps(
  dataWarehouses: NormalizedDataWarehouse[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const dw of dataWarehouses) {
    const did = `dw-${dw.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    steps.push({
      id: did,
      type: "migrate-data-warehouse",
      name: `Migrate warehouse ${dw.name}`,
      description: `Migrate ${dw.engine} data warehouse (${dw.storageGB} GB) to ${target}`,
      params: { dataWarehouses: [dw], sourceProvider: source, targetProvider: target, transferData: true },
      dependsOn: [],
      timeoutMs: 14_400_000,
      pipeline: "analytics",
      resourceType: "data-warehouse",
      requiresRollback: true,
    });
  }
  return steps;
}

function generateBucketPolicySteps(
  bucketPolicies: NormalizedBucketPolicy[],
  source: MigrationProvider,
  target: MigrationProvider,
): MigrationStep[] {
  if (bucketPolicies.length === 0) return [];
  return [{
    id: `bpolicies-${randomUUID().slice(0, 8)}`,
    type: "migrate-bucket-policies",
    name: `Migrate ${bucketPolicies.length} bucket policies`,
    description: `Migrate bucket policies, CORS, and event notifications to ${target}`,
    params: { bucketPolicies, sourceProvider: source, targetProvider: target },
    dependsOn: [],
    timeoutMs: 300_000,
    pipeline: "storage-policy",
    resourceType: "bucket-policy",
    requiresRollback: false,
  }];
}
