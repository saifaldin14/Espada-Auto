/**
 * Azure Intent Compiler
 *
 * Compiles a declarative ApplicationIntent into an executable InfrastructurePlan.
 * Runs compilation phases: Network → Security → Data → Compute → Monitoring → DR.
 */

import { randomUUID } from "node:crypto";
import type {
  ApplicationIntent,
  ApplicationTierIntent,
  InfrastructurePlan,
  PlannedResource,
  CostBreakdownItem,
  PolicyValidationResult,
  GuardrailCheckResult,
  RollbackPlan,
  RollbackStep,
  IntentCompilerConfig,
} from "./types.js";

// =============================================================================
// Cost Estimates (simplified reference pricing)
// =============================================================================

const COST_ESTIMATES: Record<string, Record<string, number>> = {
  "app-service": { small: 13, medium: 55, large: 110, xlarge: 220 },
  "container-app": { small: 10, medium: 40, large: 90, xlarge: 180 },
  functions: { small: 0, medium: 5, large: 20, xlarge: 50 },
  vm: { small: 30, medium: 70, large: 150, xlarge: 350 },
  aks: { small: 70, medium: 150, large: 300, xlarge: 600 },
  "spring-apps": { small: 50, medium: 100, large: 200, xlarge: 400 },
  "sql-server": { basic: 5, standard: 25, premium: 125 },
  postgresql: { basic: 25, standard: 50, premium: 200 },
  mysql: { basic: 25, standard: 50, premium: 200 },
  cosmosdb: { basic: 25, standard: 100, premium: 400 },
  redis: { basic: 15, standard: 50, premium: 200 },
  "storage-blob": { basic: 1, standard: 5, premium: 20 },
  "storage-table": { basic: 1, standard: 3, premium: 10 },
  vnet: { default: 0 },
  nsg: { default: 0 },
  "key-vault": { default: 1 },
  "app-insights": { default: 10 },
  cdn: { default: 20 },
  waf: { default: 60 },
};

// =============================================================================
// Intent Compiler
// =============================================================================

export class IntentCompiler {
  private config: IntentCompilerConfig;

  constructor(config: IntentCompilerConfig) {
    this.config = config;
  }

  /**
   * Compile a declarative intent into an infrastructure plan.
   */
  compile(intent: ApplicationIntent): InfrastructurePlan {
    const planId = randomUUID();
    const resources: PlannedResource[] = [];
    const rgName = this.resolveResourceGroupName(intent);
    const region = intent.region || this.config.defaultRegion;
    const tags = { ...this.config.defaultTags, ...intent.tags, environment: intent.environment };

    // Phase 1: Resource Group
    resources.push(this.createResourceGroupResource(planId, rgName, region, tags, intent));

    // Phase 2: Networking
    if (this.needsVNet(intent)) {
      resources.push(...this.compileNetworking(rgName, region, tags, intent));
    }

    // Phase 3: Security
    resources.push(...this.compileSecurity(rgName, region, tags, intent));

    // Phase 4: Data tier
    for (const tier of intent.tiers.filter((t) => t.type === "data" || t.type === "cache" || t.dataStore)) {
      resources.push(...this.compileDataTier(rgName, region, tags, intent, tier));
    }

    // Phase 5: Compute tiers
    for (const tier of intent.tiers.filter((t) => t.type !== "data" && t.type !== "cache" && !t.dataStore)) {
      resources.push(...this.compileComputeTier(rgName, region, tags, intent, tier));
    }

    // Phase 6: Monitoring
    resources.push(...this.compileMonitoring(rgName, region, tags, intent));

    // Phase 7: DR (if requested)
    if (intent.disasterRecovery?.secondaryRegion) {
      resources.push(...this.compileDR(rgName, tags, intent));
    }

    // Cost estimation
    const costBreakdown = this.estimateCosts(resources);
    const estimatedMonthlyCostUsd = costBreakdown.reduce((sum, c) => sum + c.monthlyCostUsd, 0);

    // Policy validation
    const policyValidation = this.validatePolicies(resources, intent);

    // Guardrail checks
    const guardrailChecks = this.runGuardrailChecks(resources, intent);

    // Execution order (topological layers)
    const executionOrder = this.computeExecutionOrder(resources);

    // Rollback plan
    const rollbackPlan = this.buildRollbackPlan(resources);

    return {
      id: planId,
      intent,
      resources,
      estimatedMonthlyCostUsd,
      costBreakdown,
      policyValidation,
      guardrailChecks,
      executionOrder,
      rollbackPlan,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Validate an intent without compiling it.
   */
  validateIntent(intent: ApplicationIntent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!intent.name?.trim()) errors.push("Intent must have a name");
    if (!intent.tiers?.length) errors.push("Intent must define at least one tier");
    if (!intent.environment) errors.push("Intent must specify an environment");

    for (const tier of intent.tiers ?? []) {
      if (!tier.name?.trim()) errors.push("Each tier must have a name");
      if (!tier.type) errors.push(`Tier "${tier.name}" must have a type`);

      if (tier.compute && !tier.compute.platform) {
        errors.push(`Tier "${tier.name}" compute must specify a platform`);
      }

      if (tier.dataStore && !tier.dataStore.engine) {
        errors.push(`Tier "${tier.name}" dataStore must specify an engine`);
      }

      // Check circular dependencies
      if (tier.dependsOn?.includes(tier.name)) {
        errors.push(`Tier "${tier.name}" cannot depend on itself`);
      }
    }

    // Check dependency references
    const tierNames = new Set((intent.tiers ?? []).map((t) => t.name));
    for (const tier of intent.tiers ?? []) {
      for (const dep of tier.dependsOn ?? []) {
        if (!tierNames.has(dep)) {
          errors.push(`Tier "${tier.name}" depends on unknown tier "${dep}"`);
        }
      }
    }

    if (intent.cost?.maxMonthlyCostUsd !== undefined && intent.cost.maxMonthlyCostUsd <= 0) {
      errors.push("Cost constraint maxMonthlyCostUsd must be positive");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Estimate cost for an intent without full compilation.
   */
  estimateCost(intent: ApplicationIntent): { estimatedMonthlyCostUsd: number; breakdown: CostBreakdownItem[] } {
    const plan = this.compile(intent);
    return {
      estimatedMonthlyCostUsd: plan.estimatedMonthlyCostUsd,
      breakdown: plan.costBreakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // Compilation Phases
  // ---------------------------------------------------------------------------

  private resolveResourceGroupName(intent: ApplicationIntent): string {
    const pattern = this.config.resourceGroupPattern ?? "rg-{name}-{env}";
    return pattern
      .replace("{name}", intent.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
      .replace("{env}", intent.environment);
  }

  private needsVNet(intent: ApplicationIntent): boolean {
    return intent.tiers.some((t) => t.networking?.vnet) ||
      intent.security?.privateEndpoints === true ||
      intent.environment === "production";
  }

  private createResourceGroupResource(
    _planId: string, rgName: string, region: string,
    tags: Record<string, string>, intent: ApplicationIntent,
  ): PlannedResource {
    return {
      id: `rg-${intent.name}`,
      type: "Microsoft.Resources/resourceGroups",
      name: rgName,
      region,
      resourceGroup: rgName,
      properties: {},
      dependsOn: [],
      tier: "infrastructure",
      estimatedMonthlyCostUsd: 0,
      tags,
    };
  }

  private compileNetworking(
    rgName: string, region: string, tags: Record<string, string>,
    intent: ApplicationIntent,
  ): PlannedResource[] {
    const resources: PlannedResource[] = [];
    const vnetName = `vnet-${intent.name}-${intent.environment}`;

    resources.push({
      id: `vnet-${intent.name}`,
      type: "Microsoft.Network/virtualNetworks",
      name: vnetName,
      region,
      resourceGroup: rgName,
      properties: {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: intent.tiers.map((tier, i) => ({
          name: `snet-${tier.name}`,
          addressPrefix: `10.0.${i + 1}.0/24`,
        })),
      },
      dependsOn: [`rg-${intent.name}`],
      tier: "networking",
      estimatedMonthlyCostUsd: 0,
      tags,
    });

    // NSG per tier
    for (const tier of intent.tiers) {
      resources.push({
        id: `nsg-${tier.name}`,
        type: "Microsoft.Network/networkSecurityGroups",
        name: `nsg-${tier.name}-${intent.environment}`,
        region,
        resourceGroup: rgName,
        properties: {
          securityRules: this.generateNsgRules(tier, intent),
        },
        dependsOn: [`vnet-${intent.name}`],
        tier: "networking",
        estimatedMonthlyCostUsd: 0,
        tags,
      });
    }

    return resources;
  }

  private compileSecurity(
    rgName: string, region: string, tags: Record<string, string>,
    intent: ApplicationIntent,
  ): PlannedResource[] {
    const resources: PlannedResource[] = [];

    // Key Vault (always for production, on request otherwise)
    if (intent.environment === "production" || intent.security?.encryptionAtRest) {
      resources.push({
        id: `kv-${intent.name}`,
        type: "Microsoft.KeyVault/vaults",
        name: `kv-${intent.name.substring(0, 16)}-${intent.environment.substring(0, 4)}`,
        region,
        resourceGroup: rgName,
        properties: {
          sku: { family: "A", name: "standard" },
          enableSoftDelete: true,
          enablePurgeProtection: intent.environment === "production",
          enableRbacAuthorization: true,
        },
        dependsOn: [`rg-${intent.name}`],
        tier: "security",
        estimatedMonthlyCostUsd: 1,
        tags,
      });
    }

    // WAF (if requested or compliance requires it)
    if (intent.security?.waf || intent.compliance?.some((c) => c === "pci-dss")) {
      resources.push({
        id: `waf-${intent.name}`,
        type: "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies",
        name: `waf-${intent.name}-${intent.environment}`,
        region,
        resourceGroup: rgName,
        properties: {
          policySettings: { state: "Enabled", mode: "Prevention" },
          managedRules: { managedRuleSets: [{ ruleSetType: "OWASP", ruleSetVersion: "3.2" }] },
        },
        dependsOn: [`rg-${intent.name}`],
        tier: "security",
        estimatedMonthlyCostUsd: 60,
        tags,
      });
    }

    return resources;
  }

  private compileDataTier(
    rgName: string, region: string, tags: Record<string, string>,
    intent: ApplicationIntent, tier: ApplicationTierIntent,
  ): PlannedResource[] {
    const resources: PlannedResource[] = [];
    const ds = tier.dataStore;
    if (!ds) return resources;

    const dbTier = ds.tier ?? "standard";
    const depIds = [`rg-${intent.name}`];
    if (this.needsVNet(intent)) depIds.push(`vnet-${intent.name}`);

    switch (ds.engine) {
      case "sql-server": {
        resources.push({
          id: `sql-${tier.name}`,
          type: "Microsoft.Sql/servers",
          name: `sql-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            administratorLogin: "sqladmin",
            version: "12.0",
            databases: [{ name: `db-${tier.name}`, sku: { name: this.mapSqlSku(dbTier) }, maxSizeBytes: (ds.sizeGb ?? 10) * 1073741824 }],
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES["sql-server"]?.[dbTier] ?? 25,
          tags,
        });
        break;
      }
      case "postgresql": {
        resources.push({
          id: `pg-${tier.name}`,
          type: "Microsoft.DBforPostgreSQL/flexibleServers",
          name: `pg-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            version: "15",
            sku: { name: this.mapFlexibleSku(dbTier), tier: this.mapFlexibleSkuTier(dbTier) },
            storage: { storageSizeGB: ds.sizeGb ?? 32 },
            backup: { backupRetentionDays: ds.backupRetentionDays ?? 7, geoRedundantBackup: intent.availability?.geoReplication ? "Enabled" : "Disabled" },
            highAvailability: { mode: intent.availability?.zoneRedundant ? "ZoneRedundant" : "Disabled" },
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.postgresql?.[dbTier] ?? 50,
          tags,
        });
        break;
      }
      case "mysql": {
        resources.push({
          id: `mysql-${tier.name}`,
          type: "Microsoft.DBforMySQL/flexibleServers",
          name: `mysql-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            version: "8.0.21",
            sku: { name: this.mapFlexibleSku(dbTier), tier: this.mapFlexibleSkuTier(dbTier) },
            storage: { storageSizeGB: ds.sizeGb ?? 32 },
            backup: { backupRetentionDays: ds.backupRetentionDays ?? 7 },
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.mysql?.[dbTier] ?? 50,
          tags,
        });
        break;
      }
      case "cosmosdb": {
        resources.push({
          id: `cosmos-${tier.name}`,
          type: "Microsoft.DocumentDB/databaseAccounts",
          name: `cosmos-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            databaseAccountOfferType: "Standard",
            locations: [{ locationName: region, failoverPriority: 0, isZoneRedundant: intent.availability?.zoneRedundant ?? false }],
            consistencyPolicy: { defaultConsistencyLevel: "Session" },
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.cosmosdb?.[dbTier] ?? 100,
          tags,
        });
        break;
      }
      case "redis": {
        resources.push({
          id: `redis-${tier.name}`,
          type: "Microsoft.Cache/Redis",
          name: `redis-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            sku: { name: this.mapRedisSku(dbTier), family: dbTier === "premium" ? "P" : "C", capacity: dbTier === "basic" ? 0 : 1 },
            enableNonSslPort: false,
            minimumTlsVersion: "1.2",
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.redis?.[dbTier] ?? 50,
          tags,
        });
        break;
      }
      case "storage-blob":
      case "storage-table": {
        resources.push({
          id: `storage-${tier.name}`,
          type: "Microsoft.Storage/storageAccounts",
          name: `st${intent.name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 16)}${intent.environment.substring(0, 4)}`,
          region,
          resourceGroup: rgName,
          properties: {
            sku: { name: dbTier === "premium" ? "Premium_LRS" : "Standard_LRS" },
            kind: "StorageV2",
            supportsHttpsTrafficOnly: true,
            minimumTlsVersion: "TLS1_2",
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES[ds.engine]?.[dbTier] ?? 5,
          tags,
        });
        break;
      }
    }

    return resources;
  }

  private compileComputeTier(
    rgName: string, region: string, tags: Record<string, string>,
    intent: ApplicationIntent, tier: ApplicationTierIntent,
  ): PlannedResource[] {
    const resources: PlannedResource[] = [];
    const compute = tier.compute;
    if (!compute) return resources;

    const size = compute.size ?? "medium";
    const depIds = [`rg-${intent.name}`];
    if (this.needsVNet(intent)) depIds.push(`vnet-${intent.name}`);
    // Add data dependencies
    for (const dep of tier.dependsOn ?? []) {
      const dataTier = intent.tiers.find((t) => t.name === dep);
      if (dataTier?.dataStore) {
        const prefix = this.dataStorePrefix(dataTier.dataStore.engine);
        depIds.push(`${prefix}-${dep}`);
      }
    }

    switch (compute.platform) {
      case "app-service": {
        const planName = `plan-${intent.name}-${tier.name}-${intent.environment}`;
        resources.push({
          id: `plan-${tier.name}`,
          type: "Microsoft.Web/serverfarms",
          name: planName,
          region,
          resourceGroup: rgName,
          properties: {
            sku: { name: this.mapAppServiceSku(size), tier: this.mapAppServiceTier(size) },
            reserved: compute.runtime?.startsWith("node") || compute.runtime?.startsWith("python"),
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: (COST_ESTIMATES["app-service"]?.[size] ?? 55) * (compute.instanceCount ?? 1),
          tags,
        });

        resources.push({
          id: `app-${tier.name}`,
          type: "Microsoft.Web/sites",
          name: `app-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            serverFarmId: `plan-${tier.name}`,
            httpsOnly: true,
            siteConfig: {
              linuxFxVersion: compute.runtime ? this.mapLinuxFxVersion(compute.runtime) : undefined,
              alwaysOn: intent.environment === "production",
              minTlsVersion: "1.2",
            },
          },
          dependsOn: [`plan-${tier.name}`],
          tier: tier.name,
          estimatedMonthlyCostUsd: 0, // Included in plan cost
          tags,
        });
        break;
      }
      case "container-app": {
        resources.push({
          id: `cae-${tier.name}`,
          type: "Microsoft.App/managedEnvironments",
          name: `cae-${intent.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            zoneRedundant: intent.availability?.zoneRedundant ?? false,
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: 0,
          tags,
        });

        resources.push({
          id: `ca-${tier.name}`,
          type: "Microsoft.App/containerApps",
          name: `ca-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            managedEnvironmentId: `cae-${tier.name}`,
            template: {
              scale: {
                minReplicas: tier.scaling?.minInstances ?? (intent.environment === "production" ? 2 : 0),
                maxReplicas: tier.scaling?.maxInstances ?? 10,
              },
            },
            ingress: { external: tier.networking?.publicAccess ?? true, targetPort: 8080 },
          },
          dependsOn: [`cae-${tier.name}`],
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES["container-app"]?.[size] ?? 40,
          tags,
        });
        break;
      }
      case "functions": {
        resources.push({
          id: `func-${tier.name}`,
          type: "Microsoft.Web/sites",
          name: `func-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            kind: "functionapp",
            siteConfig: {
              linuxFxVersion: compute.runtime ? this.mapLinuxFxVersion(compute.runtime) : undefined,
            },
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.functions?.[size] ?? 5,
          tags,
        });
        break;
      }
      case "aks": {
        resources.push({
          id: `aks-${tier.name}`,
          type: "Microsoft.ContainerService/managedClusters",
          name: `aks-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            kubernetesVersion: "1.29",
            agentPoolProfiles: [{
              name: "default",
              count: compute.instanceCount ?? 3,
              vmSize: this.mapAksVmSize(size),
              mode: "System",
              enableAutoScaling: tier.scaling !== undefined,
              minCount: tier.scaling?.minInstances ?? 1,
              maxCount: tier.scaling?.maxInstances ?? 10,
            }],
            networkProfile: { networkPlugin: "azure", networkPolicy: "calico" },
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.aks?.[size] ?? 150,
          tags,
        });
        break;
      }
      default: {
        resources.push({
          id: `compute-${tier.name}`,
          type: "Microsoft.Compute/virtualMachines",
          name: `vm-${intent.name}-${tier.name}-${intent.environment}`,
          region,
          resourceGroup: rgName,
          properties: {
            hardwareProfile: { vmSize: this.mapVmSize(size) },
          },
          dependsOn: depIds,
          tier: tier.name,
          estimatedMonthlyCostUsd: COST_ESTIMATES.vm?.[size] ?? 70,
          tags,
        });
      }
    }

    return resources;
  }

  private compileMonitoring(
    rgName: string, region: string, tags: Record<string, string>,
    intent: ApplicationIntent,
  ): PlannedResource[] {
    return [{
      id: `insights-${intent.name}`,
      type: "Microsoft.Insights/components",
      name: `appi-${intent.name}-${intent.environment}`,
      region,
      resourceGroup: rgName,
      properties: {
        applicationType: "web",
        retentionInDays: intent.environment === "production" ? 90 : 30,
      },
      dependsOn: [`rg-${intent.name}`],
      tier: "monitoring",
      estimatedMonthlyCostUsd: 10,
      tags,
    }];
  }

  private compileDR(
    rgName: string, tags: Record<string, string>,
    intent: ApplicationIntent,
  ): PlannedResource[] {
    const secondaryRegion = intent.disasterRecovery!.secondaryRegion!;
    return [{
      id: `dr-vault-${intent.name}`,
      type: "Microsoft.RecoveryServices/vaults",
      name: `rsv-${intent.name}-${intent.environment}`,
      region: secondaryRegion,
      resourceGroup: rgName,
      properties: {
        sku: { name: "RS0", tier: "Standard" },
        replicationPolicy: {
          rpoMinutes: intent.disasterRecovery!.rpoMinutes ?? 60,
          rtoMinutes: intent.disasterRecovery!.rtoMinutes ?? 240,
        },
      },
      dependsOn: [`rg-${intent.name}`],
      tier: "disaster-recovery",
      estimatedMonthlyCostUsd: 25,
      tags,
    }];
  }

  // ---------------------------------------------------------------------------
  // Cost Estimation
  // ---------------------------------------------------------------------------

  private estimateCosts(resources: PlannedResource[]): CostBreakdownItem[] {
    return resources
      .filter((r) => r.estimatedMonthlyCostUsd > 0)
      .map((r) => ({
        resourceId: r.id,
        resourceName: r.name,
        resourceType: r.type,
        monthlyCostUsd: r.estimatedMonthlyCostUsd,
        pricingTier: typeof r.properties.sku === "object" && r.properties.sku !== null
          ? ((r.properties.sku as Record<string, unknown>).name as string ?? (r.properties.sku as Record<string, unknown>).tier as string ?? "default")
          : String(r.properties.sku ?? "default"),
      }));
  }

  // ---------------------------------------------------------------------------
  // Policy Validation
  // ---------------------------------------------------------------------------

  private validatePolicies(resources: PlannedResource[], intent: ApplicationIntent): PolicyValidationResult {
    const violations: PolicyValidationResult["violations"] = [];
    const warnings: string[] = [];

    // Check: production requires HTTPS
    if (intent.environment === "production") {
      for (const r of resources.filter((r) => r.type === "Microsoft.Web/sites")) {
        if (!(r.properties as Record<string, unknown>).httpsOnly) {
          violations.push({
            policyId: "require-https",
            policyName: "Require HTTPS",
            resourceId: r.id,
            severity: "high",
            message: `Web app "${r.name}" must enforce HTTPS in production`,
            remediation: "Set httpsOnly: true",
          });
        }
      }
    }

    // Check: encryption at rest
    if (intent.security?.encryptionAtRest) {
      const hasKeyVault = resources.some((r) => r.type === "Microsoft.KeyVault/vaults");
      if (!hasKeyVault) {
        warnings.push("Encryption at rest requested but no Key Vault planned — using platform-managed keys");
      }
    }

    // Check: compliance frameworks
    for (const framework of intent.compliance ?? []) {
      if (framework === "hipaa" || framework === "pci-dss") {
        const hasWaf = resources.some((r) => r.type.includes("WebApplicationFirewall"));
        if (!hasWaf) {
          violations.push({
            policyId: `${framework}-waf`,
            policyName: `${framework.toUpperCase()} WAF Requirement`,
            resourceId: "plan",
            severity: "high",
            message: `${framework.toUpperCase()} compliance requires a Web Application Firewall`,
            remediation: "Enable WAF in security requirements",
          });
        }
      }
    }

    return { passed: violations.length === 0, violations, warnings };
  }

  // ---------------------------------------------------------------------------
  // Guardrail Checks
  // ---------------------------------------------------------------------------

  private runGuardrailChecks(resources: PlannedResource[], intent: ApplicationIntent): GuardrailCheckResult[] {
    const checks: GuardrailCheckResult[] = [];

    // Naming convention check
    for (const r of resources) {
      const validPattern = /^[a-z][a-z0-9-]*$/;
      checks.push({
        checkName: `naming:${r.id}`,
        passed: validPattern.test(r.name),
        message: validPattern.test(r.name)
          ? `Resource "${r.name}" follows naming conventions`
          : `Resource "${r.name}" does not follow naming conventions (lowercase alphanumeric with hyphens)`,
        category: "naming",
      });
    }

    // Tagging check
    const requiredTags = ["environment"];
    for (const r of resources.filter((r) => r.type !== "Microsoft.Resources/resourceGroups")) {
      const missingTags = requiredTags.filter((t) => !r.tags[t]);
      checks.push({
        checkName: `tagging:${r.id}`,
        passed: missingTags.length === 0,
        message: missingTags.length === 0
          ? `Resource "${r.name}" has all required tags`
          : `Resource "${r.name}" missing tags: ${missingTags.join(", ")}`,
        category: "tagging",
      });
    }

    // Cost check
    const totalCost = resources.reduce((sum, r) => sum + r.estimatedMonthlyCostUsd, 0);
    if (intent.cost?.maxMonthlyCostUsd) {
      checks.push({
        checkName: "cost:budget",
        passed: totalCost <= intent.cost.maxMonthlyCostUsd,
        message: totalCost <= intent.cost.maxMonthlyCostUsd
          ? `Estimated cost $${totalCost}/mo is within budget $${intent.cost.maxMonthlyCostUsd}/mo`
          : `Estimated cost $${totalCost}/mo exceeds budget $${intent.cost.maxMonthlyCostUsd}/mo`,
        category: "cost",
      });
    }

    // Security checks
    if (intent.environment === "production") {
      const hasKeyVault = resources.some((r) => r.type === "Microsoft.KeyVault/vaults");
      checks.push({
        checkName: "security:keyvault",
        passed: hasKeyVault,
        message: hasKeyVault ? "Key Vault present for secret management" : "Production environment should use Key Vault for secrets",
        category: "security",
      });
    }

    return checks;
  }

  // ---------------------------------------------------------------------------
  // Execution Order
  // ---------------------------------------------------------------------------

  private computeExecutionOrder(resources: PlannedResource[]): string[][] {
    const layers: string[][] = [];
    const completed = new Set<string>();
    let remaining = [...resources];

    while (remaining.length > 0) {
      const layer = remaining.filter((r) => r.dependsOn.every((d) => completed.has(d)));
      if (layer.length === 0) {
        // Remaining resources have unresolvable dependencies — add them as a final layer
        layers.push(remaining.map((r) => r.id));
        break;
      }
      layers.push(layer.map((r) => r.id));
      for (const r of layer) completed.add(r.id);
      remaining = remaining.filter((r) => !completed.has(r.id));
    }

    return layers;
  }

  // ---------------------------------------------------------------------------
  // Rollback Plan
  // ---------------------------------------------------------------------------

  private buildRollbackPlan(resources: PlannedResource[]): RollbackPlan {
    const steps: RollbackStep[] = resources
      .filter((r) => r.type !== "Microsoft.Resources/resourceGroups")
      .reverse()
      .map((r, i) => ({ resourceId: r.id, action: "delete" as const, order: i }));

    // Resource group deletion last
    const rg = resources.find((r) => r.type === "Microsoft.Resources/resourceGroups");
    if (rg) {
      steps.push({ resourceId: rg.id, action: "delete", order: steps.length });
    }

    return { steps, estimatedDurationMs: steps.length * 30_000 };
  }

  // ---------------------------------------------------------------------------
  // SKU Mapping Helpers
  // ---------------------------------------------------------------------------

  private mapSqlSku(tier: string): string {
    switch (tier) {
      case "basic": return "Basic";
      case "premium": return "P1";
      default: return "S0";
    }
  }

  private mapFlexibleSku(tier: string): string {
    switch (tier) {
      case "basic": return "Standard_B1ms";
      case "premium": return "Standard_D4ds_v5";
      default: return "Standard_D2ds_v5";
    }
  }

  private mapFlexibleSkuTier(tier: string): string {
    switch (tier) {
      case "basic": return "Burstable";
      case "premium": return "GeneralPurpose";
      default: return "GeneralPurpose";
    }
  }

  private mapRedisSku(tier: string): string {
    switch (tier) {
      case "basic": return "Basic";
      case "premium": return "Premium";
      default: return "Standard";
    }
  }

  private mapAppServiceSku(size: string): string {
    switch (size) {
      case "small": return "B1";
      case "large": return "P1v3";
      case "xlarge": return "P3v3";
      default: return "S1";
    }
  }

  private mapAppServiceTier(size: string): string {
    switch (size) {
      case "small": return "Basic";
      case "large":
      case "xlarge": return "PremiumV3";
      default: return "Standard";
    }
  }

  private mapLinuxFxVersion(runtime: string): string {
    if (runtime.startsWith("node")) return `NODE|${runtime.replace("node", "")}`;
    if (runtime.startsWith("python")) return `PYTHON|${runtime.replace("python", "")}`;
    if (runtime.startsWith("dotnet")) return `DOTNETCORE|${runtime.replace("dotnet", "")}`;
    if (runtime.startsWith("java")) return `JAVA|${runtime.replace("java", "")}`;
    return runtime;
  }

  private mapVmSize(size: string): string {
    switch (size) {
      case "small": return "Standard_B1ms";
      case "large": return "Standard_D4s_v5";
      case "xlarge": return "Standard_D8s_v5";
      default: return "Standard_D2s_v5";
    }
  }

  private mapAksVmSize(size: string): string {
    switch (size) {
      case "small": return "Standard_DS2_v2";
      case "large": return "Standard_D4s_v5";
      case "xlarge": return "Standard_D8s_v5";
      default: return "Standard_D2s_v5";
    }
  }

  private dataStorePrefix(engine: string): string {
    switch (engine) {
      case "sql-server": return "sql";
      case "postgresql": return "pg";
      case "mysql": return "mysql";
      case "cosmosdb": return "cosmos";
      case "redis": return "redis";
      default: return "storage";
    }
  }

  private generateNsgRules(tier: ApplicationTierIntent, intent: ApplicationIntent): unknown[] {
    const rules: unknown[] = [];
    if (tier.networking?.publicAccess !== false) {
      rules.push({ name: "allow-https", priority: 100, direction: "Inbound", access: "Allow", protocol: "Tcp", destinationPortRange: "443" });
    }
    if (intent.security?.ipRestrictions?.length) {
      rules.push({ name: "restrict-ips", priority: 200, direction: "Inbound", access: "Allow", protocol: "*", sourceAddressPrefixes: intent.security.ipRestrictions });
    }
    rules.push({ name: "deny-all", priority: 4096, direction: "Inbound", access: "Deny", protocol: "*", sourceAddressPrefix: "*" });
    return rules;
  }
}

/** Create an IntentCompiler with the given configuration. */
export function createIntentCompiler(config: IntentCompilerConfig): IntentCompiler {
  return new IntentCompiler(config);
}
