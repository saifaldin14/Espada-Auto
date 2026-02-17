/**
 * IDIO — Built-in Step Definitions (GCP)
 *
 * Registers all built-in GCP orchestration steps.
 * Each step maps to one or more GCP API operations.
 */

import type { StepDefinition, StepHandler, StepExecutionContext } from "./types.js";

// =============================================================================
// Step Registry
// =============================================================================

const stepRegistry = new Map<string, { definition: StepDefinition; handler: StepHandler }>();

/**
 * Register a step type with its definition and handler.
 */
export function registerStepType(definition: StepDefinition, handler: StepHandler): void {
  if (stepRegistry.has(definition.type)) {
    throw new Error(`Step type "${definition.type}" is already registered`);
  }
  stepRegistry.set(definition.type, { definition, handler });
}

/**
 * Get a step definition by type ID.
 */
export function getStepDefinition(type: string): StepDefinition | undefined {
  return stepRegistry.get(type)?.definition;
}

/**
 * Get a step handler by type ID.
 */
export function getStepHandler(type: string): StepHandler | undefined {
  return stepRegistry.get(type)?.handler;
}

/**
 * List all registered step types.
 */
export function listStepTypes(): StepDefinition[] {
  return [...stepRegistry.values()].map((entry) => entry.definition);
}

/**
 * Check if a step type is registered.
 */
export function hasStepType(type: string): boolean {
  return stepRegistry.has(type);
}

/**
 * Clear all registered step types (useful for testing).
 */
export function clearStepRegistry(): void {
  stepRegistry.clear();
}

// =============================================================================
// Step Definitions
// =============================================================================

const createProjectDef: StepDefinition = {
  type: "create-project",
  category: "foundation",
  description: "Create a new GCP project under a specified organization or folder",
  requiredParams: ["projectId", "projectName"],
  optionalParams: ["orgId", "folderId", "labels"],
  outputs: ["projectId", "projectNumber"],
};

const createVpcNetworkDef: StepDefinition = {
  type: "create-vpc-network",
  category: "networking",
  description: "Create a VPC network in the specified project",
  requiredParams: ["project", "networkName"],
  optionalParams: ["autoCreateSubnetworks", "routingMode", "description"],
  outputs: ["networkId", "networkSelfLink"],
};

const createFirewallRuleDef: StepDefinition = {
  type: "create-firewall-rule",
  category: "networking",
  description: "Create a firewall rule in the specified VPC network",
  requiredParams: ["project", "ruleName", "network"],
  optionalParams: ["direction", "priority", "sourceRanges", "allowed", "denied", "targetTags"],
  outputs: ["firewallId", "firewallSelfLink"],
};

const createGcsBucketDef: StepDefinition = {
  type: "create-gcs-bucket",
  category: "storage",
  description: "Create a Google Cloud Storage bucket",
  requiredParams: ["project", "bucketName", "location"],
  optionalParams: ["storageClass", "versioning", "uniformBucketLevelAccess", "labels"],
  outputs: ["bucketName", "bucketSelfLink"],
};

const createCloudSqlDef: StepDefinition = {
  type: "create-cloud-sql",
  category: "database",
  description: "Create a Cloud SQL instance with a database",
  requiredParams: ["project", "instanceName", "region", "databaseVersion", "tier"],
  optionalParams: ["databaseName", "rootPassword", "ipConfiguration", "backupEnabled", "highAvailability"],
  outputs: ["instanceName", "connectionString", "ipAddress"],
};

const createFirestoreDbDef: StepDefinition = {
  type: "create-firestore-db",
  category: "database",
  description: "Create a Firestore database in the specified project",
  requiredParams: ["project", "locationId"],
  optionalParams: ["databaseId", "type"],
  outputs: ["databaseId", "locationId"],
};

const createRedisInstanceDef: StepDefinition = {
  type: "create-redis-instance",
  category: "database",
  description: "Create a Memorystore for Redis instance",
  requiredParams: ["project", "region", "instanceId", "tier", "memorySizeGb"],
  optionalParams: ["redisVersion", "displayName", "network", "labels"],
  outputs: ["host", "port", "instanceId"],
};

const createGkeClusterDef: StepDefinition = {
  type: "create-gke-cluster",
  category: "compute",
  description: "Create a Google Kubernetes Engine cluster",
  requiredParams: ["project", "zone", "clusterName"],
  optionalParams: ["initialNodeCount", "machineType", "network", "subnetwork", "releaseChannel", "enableAutopilot"],
  outputs: ["clusterEndpoint", "clusterName", "clusterId"],
};

const createCloudRunServiceDef: StepDefinition = {
  type: "create-cloud-run-service",
  category: "compute",
  description: "Deploy a Cloud Run service from a container image",
  requiredParams: ["project", "region", "serviceName", "image"],
  optionalParams: ["port", "memory", "cpu", "maxInstances", "minInstances", "envVars", "allowUnauthenticated"],
  outputs: ["serviceUrl", "serviceName", "serviceId"],
};

const createCloudFunctionDef: StepDefinition = {
  type: "create-cloud-function",
  category: "compute",
  description: "Deploy a Cloud Function (2nd gen)",
  requiredParams: ["project", "region", "functionName", "runtime", "entryPoint"],
  optionalParams: ["sourceDir", "memory", "timeout", "triggerHttp", "triggerTopic", "envVars"],
  outputs: ["functionUrl", "functionName", "functionId"],
};

const createAppEngineDef: StepDefinition = {
  type: "create-app-engine",
  category: "compute",
  description: "Create an App Engine application in the specified project",
  requiredParams: ["project", "locationId"],
  optionalParams: ["servingStatus", "featureSettings"],
  outputs: ["defaultHostname", "appId"],
};

const createPubsubTopicDef: StepDefinition = {
  type: "create-pubsub-topic",
  category: "messaging",
  description: "Create a Pub/Sub topic with optional subscriptions",
  requiredParams: ["project", "topicName"],
  optionalParams: ["labels", "messageRetentionDuration", "schemaSettings"],
  outputs: ["topicName", "topicId"],
};

const createMonitoringAlertDef: StepDefinition = {
  type: "create-monitoring-alert",
  category: "monitoring",
  description: "Create a Cloud Monitoring alert policy",
  requiredParams: ["project", "displayName", "conditions"],
  optionalParams: ["notificationChannels", "combiner", "documentation"],
  outputs: ["alertPolicyId", "alertPolicyName"],
};

const createSecretDef: StepDefinition = {
  type: "create-secret",
  category: "security",
  description: "Create a secret in Secret Manager",
  requiredParams: ["project", "secretId"],
  optionalParams: ["replication", "labels", "secretData"],
  outputs: ["secretId", "secretName"],
};

// =============================================================================
// All built-in definitions for listing
// =============================================================================

export const BUILTIN_STEP_DEFINITIONS: StepDefinition[] = [
  createProjectDef,
  createVpcNetworkDef,
  createFirewallRuleDef,
  createGcsBucketDef,
  createCloudSqlDef,
  createFirestoreDbDef,
  createRedisInstanceDef,
  createGkeClusterDef,
  createCloudRunServiceDef,
  createCloudFunctionDef,
  createAppEngineDef,
  createPubsubTopicDef,
  createMonitoringAlertDef,
  createSecretDef,
];

// =============================================================================
// Handler Factories
// =============================================================================

function createProjectHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return { projectId: ctx.params.projectId ?? "dry-run-project", projectNumber: "123456789012" };
      }
      const mgr = getManager();
      const result = await mgr.createProject(ctx.params.projectId, ctx.params.projectName, ctx.params);
      ctx.logger.info(`Created project "${ctx.params.projectId}"`);
      return { projectId: result.projectId ?? ctx.params.projectId, projectNumber: result.projectNumber ?? "" };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteProject(ctx.params.projectId as string);
        ctx.logger.info(`Rolled back: deleted project "${ctx.params.projectId}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete project "${ctx.params.projectId}": ${err.message}`);
      }
    },
  };
}

function createVpcNetworkHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          networkId: `projects/${ctx.params.project}/global/networks/${ctx.params.networkName}`,
          networkSelfLink: `https://compute.googleapis.com/compute/v1/projects/${ctx.params.project}/global/networks/${ctx.params.networkName}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.createNetwork(ctx.params.project, ctx.params.networkName, ctx.params);
      ctx.logger.info(`Created VPC network "${ctx.params.networkName}" in project "${ctx.params.project}"`);
      return { networkId: result.id ?? "", networkSelfLink: result.selfLink ?? "" };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteNetwork(ctx.params.project as string, ctx.params.networkName as string);
        ctx.logger.info(`Rolled back: deleted VPC network "${ctx.params.networkName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete network "${ctx.params.networkName}": ${err.message}`);
      }
    },
  };
}

function createFirewallRuleHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          firewallId: `projects/${ctx.params.project}/global/firewalls/${ctx.params.ruleName}`,
          firewallSelfLink: `https://compute.googleapis.com/compute/v1/projects/${ctx.params.project}/global/firewalls/${ctx.params.ruleName}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.createFirewallRule(ctx.params.project, ctx.params.ruleName, ctx.params);
      ctx.logger.info(`Created firewall rule "${ctx.params.ruleName}" in project "${ctx.params.project}"`);
      return { firewallId: result.id ?? "", firewallSelfLink: result.selfLink ?? "" };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteFirewallRule(ctx.params.project as string, ctx.params.ruleName as string);
        ctx.logger.info(`Rolled back: deleted firewall rule "${ctx.params.ruleName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete firewall rule "${ctx.params.ruleName}": ${err.message}`);
      }
    },
  };
}

function createGcsBucketHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          bucketName: ctx.params.bucketName as string,
          bucketSelfLink: `https://storage.googleapis.com/storage/v1/b/${ctx.params.bucketName}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.createBucket(ctx.params.project, ctx.params.bucketName, ctx.params);
      ctx.logger.info(`Created GCS bucket "${ctx.params.bucketName}" in ${ctx.params.location}`);
      return { bucketName: result.name ?? ctx.params.bucketName, bucketSelfLink: result.selfLink ?? "" };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteBucket(ctx.params.bucketName as string);
        ctx.logger.info(`Rolled back: deleted GCS bucket "${ctx.params.bucketName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete bucket "${ctx.params.bucketName}": ${err.message}`);
      }
    },
  };
}

function createCloudSqlHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          instanceName: ctx.params.instanceName as string,
          connectionString: `${ctx.params.project}:${ctx.params.region}:${ctx.params.instanceName}`,
          ipAddress: "10.0.0.1",
        };
      }
      const mgr = getManager();
      const result = await mgr.createInstance(ctx.params.project, ctx.params.instanceName, ctx.params);
      ctx.logger.info(`Created Cloud SQL instance "${ctx.params.instanceName}" in ${ctx.params.region}`);
      return {
        instanceName: result.name ?? ctx.params.instanceName,
        connectionString: result.connectionName ?? "",
        ipAddress: result.ipAddresses?.[0]?.ipAddress ?? "",
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteInstance(ctx.params.project as string, ctx.params.instanceName as string);
        ctx.logger.info(`Rolled back: deleted Cloud SQL instance "${ctx.params.instanceName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete SQL instance "${ctx.params.instanceName}": ${err.message}`);
      }
    },
  };
}

function createFirestoreDbHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          databaseId: (ctx.params.databaseId as string) ?? "(default)",
          locationId: ctx.params.locationId as string,
        };
      }
      const mgr = getManager();
      const result = await mgr.createDatabase(ctx.params.project, ctx.params);
      ctx.logger.info(`Created Firestore database in project "${ctx.params.project}" at ${ctx.params.locationId}`);
      return { databaseId: result.name ?? "(default)", locationId: result.locationId ?? ctx.params.locationId };
    },
  };
}

function createRedisInstanceHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          host: "10.0.0.2",
          port: 6379,
          instanceId: `projects/${ctx.params.project}/locations/${ctx.params.region}/instances/${ctx.params.instanceId}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.createInstance(ctx.params.project, ctx.params.region, ctx.params.instanceId, ctx.params);
      ctx.logger.info(`Created Redis instance "${ctx.params.instanceId}" in ${ctx.params.region}`);
      return {
        host: result.host ?? "",
        port: result.port ?? 6379,
        instanceId: result.name ?? "",
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteInstance(ctx.params.project as string, ctx.params.region as string, ctx.params.instanceId as string);
        ctx.logger.info(`Rolled back: deleted Redis instance "${ctx.params.instanceId}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete Redis instance "${ctx.params.instanceId}": ${err.message}`);
      }
    },
  };
}

function createGkeClusterHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          clusterEndpoint: "https://35.192.0.1",
          clusterName: ctx.params.clusterName as string,
          clusterId: `projects/${ctx.params.project}/locations/${ctx.params.zone}/clusters/${ctx.params.clusterName}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.createCluster(ctx.params.project, ctx.params.zone, ctx.params.clusterName, ctx.params);
      ctx.logger.info(`Created GKE cluster "${ctx.params.clusterName}" in ${ctx.params.zone}`);
      return {
        clusterEndpoint: result.endpoint ?? "",
        clusterName: result.name ?? ctx.params.clusterName,
        clusterId: result.selfLink ?? "",
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteCluster(ctx.params.project as string, ctx.params.zone as string, ctx.params.clusterName as string);
        ctx.logger.info(`Rolled back: deleted GKE cluster "${ctx.params.clusterName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete GKE cluster "${ctx.params.clusterName}": ${err.message}`);
      }
    },
  };
}

function createCloudRunServiceHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          serviceUrl: `https://${ctx.params.serviceName}-run.app`,
          serviceName: ctx.params.serviceName as string,
          serviceId: `projects/${ctx.params.project}/locations/${ctx.params.region}/services/${ctx.params.serviceName}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.deployService(ctx.params.project, ctx.params.region, ctx.params.serviceName, ctx.params);
      ctx.logger.info(`Deployed Cloud Run service "${ctx.params.serviceName}" in ${ctx.params.region}`);
      return {
        serviceUrl: result.uri ?? "",
        serviceName: result.name ?? ctx.params.serviceName,
        serviceId: result.uid ?? "",
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteService(ctx.params.project as string, ctx.params.region as string, ctx.params.serviceName as string);
        ctx.logger.info(`Rolled back: deleted Cloud Run service "${ctx.params.serviceName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete Cloud Run service "${ctx.params.serviceName}": ${err.message}`);
      }
    },
  };
}

function createCloudFunctionHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          functionUrl: `https://${ctx.params.region}-${ctx.params.project}.cloudfunctions.net/${ctx.params.functionName}`,
          functionName: ctx.params.functionName as string,
          functionId: `projects/${ctx.params.project}/locations/${ctx.params.region}/functions/${ctx.params.functionName}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.deployFunction(ctx.params.project, ctx.params.region, ctx.params.functionName, ctx.params);
      ctx.logger.info(`Deployed Cloud Function "${ctx.params.functionName}" in ${ctx.params.region}`);
      return {
        functionUrl: result.httpsTrigger?.url ?? result.url ?? "",
        functionName: result.name ?? ctx.params.functionName,
        functionId: result.uid ?? "",
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteFunction(ctx.params.project as string, ctx.params.region as string, ctx.params.functionName as string);
        ctx.logger.info(`Rolled back: deleted Cloud Function "${ctx.params.functionName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete Cloud Function "${ctx.params.functionName}": ${err.message}`);
      }
    },
  };
}

function createAppEngineHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          defaultHostname: `${ctx.params.project}.appspot.com`,
          appId: ctx.params.project as string,
        };
      }
      const mgr = getManager();
      const result = await mgr.createApplication(ctx.params.project, ctx.params.locationId, ctx.params);
      ctx.logger.info(`Created App Engine application in project "${ctx.params.project}" at ${ctx.params.locationId}`);
      return {
        defaultHostname: result.defaultHostname ?? `${ctx.params.project}.appspot.com`,
        appId: result.id ?? ctx.params.project,
      };
    },
    // App Engine cannot be deleted once created
  };
}

function createPubsubTopicHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          topicName: `projects/${ctx.params.project}/topics/${ctx.params.topicName}`,
          topicId: ctx.params.topicName as string,
        };
      }
      const mgr = getManager();
      const result = await mgr.createTopic(ctx.params.project, ctx.params.topicName, ctx.params);
      ctx.logger.info(`Created Pub/Sub topic "${ctx.params.topicName}" in project "${ctx.params.project}"`);
      return {
        topicName: result.name ?? `projects/${ctx.params.project}/topics/${ctx.params.topicName}`,
        topicId: ctx.params.topicName,
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteTopic(ctx.params.project as string, ctx.params.topicName as string);
        ctx.logger.info(`Rolled back: deleted Pub/Sub topic "${ctx.params.topicName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete Pub/Sub topic "${ctx.params.topicName}": ${err.message}`);
      }
    },
  };
}

function createMonitoringAlertHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          alertPolicyId: `projects/${ctx.params.project}/alertPolicies/dry-run-policy`,
          alertPolicyName: ctx.params.displayName as string,
        };
      }
      const mgr = getManager();
      const result = await mgr.createAlertPolicy(ctx.params.project, ctx.params);
      ctx.logger.info(`Created monitoring alert policy "${ctx.params.displayName}" in project "${ctx.params.project}"`);
      return {
        alertPolicyId: result.name ?? "",
        alertPolicyName: result.displayName ?? ctx.params.displayName,
      };
    },
    async rollback(ctx: StepExecutionContext, outputs: Record<string, unknown>) {
      const mgr = getManager();
      try {
        await mgr.deleteAlertPolicy(outputs.alertPolicyId as string);
        ctx.logger.info(`Rolled back: deleted alert policy "${outputs.alertPolicyName}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete alert policy: ${err.message}`);
      }
    },
  };
}

function createSecretHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepExecutionContext) {
      if (ctx.dryRun) {
        return {
          secretId: ctx.params.secretId as string,
          secretName: `projects/${ctx.params.project}/secrets/${ctx.params.secretId}`,
        };
      }
      const mgr = getManager();
      const result = await mgr.createSecret(ctx.params.project, ctx.params.secretId, ctx.params);
      ctx.logger.info(`Created secret "${ctx.params.secretId}" in project "${ctx.params.project}"`);
      return {
        secretId: ctx.params.secretId,
        secretName: result.name ?? `projects/${ctx.params.project}/secrets/${ctx.params.secretId}`,
      };
    },
    async rollback(ctx: StepExecutionContext) {
      const mgr = getManager();
      try {
        await mgr.deleteSecret(ctx.params.project as string, ctx.params.secretId as string);
        ctx.logger.info(`Rolled back: deleted secret "${ctx.params.secretId}"`);
      } catch (err: any) {
        ctx.logger.warn(`Rollback warning: could not delete secret "${ctx.params.secretId}": ${err.message}`);
      }
    },
  };
}

// =============================================================================
// Dry-Run Registration (no external managers needed)
// =============================================================================

/**
 * Register all built-in steps with dry-run-only handlers.
 * Useful for plan validation and testing without real GCP credentials.
 */
export function registerBuiltinStepsDryRun(): void {
  const noop = () => ({} as any);
  registerBuiltinSteps({
    getProjectManager: noop,
    getNetworkManager: noop,
    getStorageManager: noop,
    getSqlManager: noop,
    getFirestoreManager: noop,
    getRedisManager: noop,
    getGkeManager: noop,
    getCloudRunManager: noop,
    getCloudFunctionManager: noop,
    getAppEngineManager: noop,
    getPubsubManager: noop,
    getMonitoringManager: noop,
    getSecretManager: noop,
  });
}

// =============================================================================
// Registration
// =============================================================================

export type ResourceManagerFactories = {
  getProjectManager: () => any;
  getNetworkManager: () => any;
  getStorageManager: () => any;
  getSqlManager: () => any;
  getFirestoreManager: () => any;
  getRedisManager: () => any;
  getGkeManager: () => any;
  getCloudRunManager: () => any;
  getCloudFunctionManager: () => any;
  getAppEngineManager: () => any;
  getPubsubManager: () => any;
  getMonitoringManager: () => any;
  getSecretManager: () => any;
};

/**
 * Register all 14 built-in GCP step types with real resource manager factories.
 */
export function registerBuiltinSteps(factories: ResourceManagerFactories): void {
  const registrations: [StepDefinition, StepHandler][] = [
    [createProjectDef, createProjectHandler(factories.getProjectManager)],
    [createVpcNetworkDef, createVpcNetworkHandler(factories.getNetworkManager)],
    [createFirewallRuleDef, createFirewallRuleHandler(factories.getNetworkManager)],
    [createGcsBucketDef, createGcsBucketHandler(factories.getStorageManager)],
    [createCloudSqlDef, createCloudSqlHandler(factories.getSqlManager)],
    [createFirestoreDbDef, createFirestoreDbHandler(factories.getFirestoreManager)],
    [createRedisInstanceDef, createRedisInstanceHandler(factories.getRedisManager)],
    [createGkeClusterDef, createGkeClusterHandler(factories.getGkeManager)],
    [createCloudRunServiceDef, createCloudRunServiceHandler(factories.getCloudRunManager)],
    [createCloudFunctionDef, createCloudFunctionHandler(factories.getCloudFunctionManager)],
    [createAppEngineDef, createAppEngineHandler(factories.getAppEngineManager)],
    [createPubsubTopicDef, createPubsubTopicHandler(factories.getPubsubManager)],
    [createMonitoringAlertDef, createMonitoringAlertHandler(factories.getMonitoringManager)],
    [createSecretDef, createSecretHandler(factories.getSecretManager)],
  ];

  for (const [def, handler] of registrations) {
    if (!hasStepType(def.type)) {
      registerStepType(def, handler);
    }
  }
}
