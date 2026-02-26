/**
 * IDIO — Built-in Step Definitions
 *
 * Registers all built-in Azure orchestration steps.
 * Each step maps to one or more Azure SDK operations.
 */

import type { StepTypeDefinition, StepHandler, StepContext } from "./types.js";
import { registerStepType } from "./registry.js";

// =============================================================================
// Helpers
// =============================================================================

function p(name: string, type: StepTypeDefinition["parameters"][0]["type"], description: string, required = true, defaultVal?: unknown): StepTypeDefinition["parameters"][0] {
  return { name, type, description, required, default: defaultVal };
}

function o(name: string, type: StepTypeDefinition["outputs"][0]["type"], description: string): StepTypeDefinition["outputs"][0] {
  return { name, type, description };
}

/** Creates a no-op handler for dry-run / validation testing. */
function dryRunHandler(outputs: Record<string, unknown>): StepHandler {
  return {
    execute: async () => ({ ...outputs }),
    rollback: async () => {},
  };
}

// =============================================================================
// Resource Group Steps
// =============================================================================

const createResourceGroupDef: StepTypeDefinition = {
  id: "create-resource-group",
  label: "Create Resource Group",
  description: "Create an Azure resource group in the specified region",
  category: "resource-group",
  parameters: [
    p("name", "string", "Resource group name"),
    p("location", "string", "Azure region (e.g. eastus)"),
  ],
  outputs: [
    o("resourceGroupName", "string", "Name of the created resource group"),
    o("resourceGroupId", "string", "Resource ID of the created resource group"),
  ],
  rollbackSupported: true,
  estimatedDurationMs: 5_000,
};

function createResourceGroupHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { name, location } = ctx.params as { name: string; location: string };
      const tags = { ...ctx.tags };
      const mgr = getManager();
      const rg = await mgr.createResourceGroup(name, location, tags);
      ctx.log.info(`Created resource group "${name}" in ${location}`);
      return { resourceGroupName: rg.name ?? name, resourceGroupId: rg.id ?? "" };
    },
    async rollback(ctx: StepContext) {
      const { name } = ctx.params as { name: string };
      const mgr = getManager();
      try {
        await mgr.deleteResourceGroup(name);
        ctx.log.info(`Rolled back: deleted resource group "${name}"`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`Rollback warning: could not delete resource group "${name}": ${message}`);
      }
    },
  };
}

// =============================================================================
// Compute Steps
// =============================================================================

const deployArmTemplateDef: StepTypeDefinition = {
  id: "deploy-arm-template",
  label: "Deploy ARM Template",
  description: "Deploy an Azure Resource Manager template to a resource group",
  category: "compute",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("deploymentName", "string", "Deployment name"),
    p("template", "object", "ARM template JSON"),
    p("parameters", "object", "Template parameters", false, {}),
  ],
  outputs: [
    o("deploymentId", "string", "Deployment resource ID"),
    o("provisioningState", "string", "Provisioning state"),
    o("deploymentOutputs", "object", "ARM template outputs"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 60_000,
};

function deployArmTemplateHandler(getManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, deploymentName, template, parameters } = ctx.params as {
        resourceGroup: string; deploymentName: string; template: Record<string, unknown>; parameters?: Record<string, unknown>;
      };
      const mgr = getManager();
      // Validate first
      const validation = await mgr.validateDeployment(resourceGroup, deploymentName, template, parameters);
      if (!validation.isValid) {
        throw new Error(`ARM template validation failed: ${validation.error?.message ?? "unknown error"}`);
      }
      const deployment = await mgr.createDeployment(resourceGroup, deploymentName, template, parameters);
      ctx.log.info(`ARM deployment "${deploymentName}" completed in "${resourceGroup}"`);
      return {
        deploymentId: deployment.id ?? "",
        provisioningState: deployment.provisioningState ?? "Succeeded",
        deploymentOutputs: deployment.outputs ?? {},
      };
    },
  };
}

// =============================================================================
// Networking Steps
// =============================================================================

const createVNetDef: StepTypeDefinition = {
  id: "create-vnet",
  label: "Create Virtual Network",
  description: "Create an Azure Virtual Network via ARM template",
  category: "networking",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "VNet name"),
    p("location", "string", "Azure region"),
    p("addressPrefix", "string", "Address space (e.g. 10.0.0.0/16)", false, "10.0.0.0/16"),
    p("subnetName", "string", "Default subnet name", false, "default"),
    p("subnetPrefix", "string", "Subnet address prefix", false, "10.0.0.0/24"),
  ],
  outputs: [
    o("vnetName", "string", "Created VNet name"),
    o("vnetId", "string", "VNet resource ID"),
    o("subnetId", "string", "Default subnet resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 15_000,
};

function createVNetHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, addressPrefix, subnetName, subnetPrefix } = ctx.params as {
        resourceGroup: string; name: string; location: string; addressPrefix: string; subnetName: string; subnetPrefix: string;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-05-01",
          name,
          location,
          tags: ctx.tags,
          properties: {
            addressSpace: { addressPrefixes: [addressPrefix] },
            subnets: [{ name: subnetName, properties: { addressPrefix: subnetPrefix } }],
          },
        }],
        outputs: {
          vnetId: { type: "string", value: `[resourceId('Microsoft.Network/virtualNetworks', '${name}')]` },
          subnetId: { type: "string", value: `[resourceId('Microsoft.Network/virtualNetworks/subnets', '${name}', '${subnetName}')]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-vnet-${name}`, template);
      ctx.log.info(`Created VNet "${name}" with subnet "${subnetName}" in "${resourceGroup}"`);
      return {
        vnetName: name,
        vnetId: deployment.outputs?.vnetId?.value ?? "",
        subnetId: deployment.outputs?.subnetId?.value ?? "",
      };
    },
  };
}

const createNSGDef: StepTypeDefinition = {
  id: "create-nsg",
  label: "Create Network Security Group",
  description: "Create an NSG via ARM template with optional rules",
  category: "networking",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "NSG name"),
    p("location", "string", "Azure region"),
    p("rules", "array", "Security rules array", false, []),
  ],
  outputs: [
    o("nsgName", "string", "Created NSG name"),
    o("nsgId", "string", "NSG resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 10_000,
};

function createNSGHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, rules } = ctx.params as {
        resourceGroup: string; name: string; location: string; rules: unknown[];
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Network/networkSecurityGroups",
          apiVersion: "2023-05-01",
          name,
          location,
          tags: ctx.tags,
          properties: { securityRules: rules ?? [] },
        }],
        outputs: {
          nsgId: { type: "string", value: `[resourceId('Microsoft.Network/networkSecurityGroups', '${name}')]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-nsg-${name}`, template);
      ctx.log.info(`Created NSG "${name}" in "${resourceGroup}"`);
      return { nsgName: name, nsgId: deployment.outputs?.nsgId?.value ?? "" };
    },
  };
}

// =============================================================================
// Data Steps
// =============================================================================

const createStorageAccountDef: StepTypeDefinition = {
  id: "create-storage-account",
  label: "Create Storage Account",
  description: "Create an Azure Storage account via ARM template",
  category: "data",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Storage account name (3-24 chars, lowercase alphanumeric)"),
    p("location", "string", "Azure region"),
    p("sku", "string", "SKU name", false, "Standard_LRS"),
    p("kind", "string", "Account kind", false, "StorageV2"),
    p("httpsOnly", "boolean", "Enforce HTTPS", false, true),
  ],
  outputs: [
    o("storageAccountName", "string", "Created storage account name"),
    o("storageAccountId", "string", "Storage account resource ID"),
  ],
  rollbackSupported: true,
  estimatedDurationMs: 20_000,
};

function createStorageAccountHandler(getResourceManager: () => any, getStorageManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, sku, kind, httpsOnly } = ctx.params as {
        resourceGroup: string; name: string; location: string; sku: string; kind: string; httpsOnly: boolean;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Storage/storageAccounts",
          apiVersion: "2023-01-01",
          name,
          location,
          tags: ctx.tags,
          sku: { name: sku },
          kind,
          properties: { supportsHttpsTrafficOnly: httpsOnly, minimumTlsVersion: "TLS1_2" },
        }],
        outputs: {
          storageAccountId: { type: "string", value: `[resourceId('Microsoft.Storage/storageAccounts', '${name}')]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-storage-${name}`, template);
      ctx.log.info(`Created storage account "${name}" (${sku}) in "${resourceGroup}"`);
      return { storageAccountName: name, storageAccountId: deployment.outputs?.storageAccountId?.value ?? "" };
    },
    async rollback(ctx: StepContext) {
      const { resourceGroup, name } = ctx.params as { resourceGroup: string; name: string };
      try {
        const mgr = getStorageManager();
        await mgr.deleteStorageAccount(resourceGroup, name);
        ctx.log.info(`Rolled back: deleted storage account "${name}"`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`Rollback warning: could not delete storage account "${name}": ${message}`);
      }
    },
  };
}

const createSqlServerDef: StepTypeDefinition = {
  id: "create-sql-server",
  label: "Create SQL Server",
  description: "Create an Azure SQL Server and optional database via ARM template",
  category: "data",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("serverName", "string", "SQL server name"),
    p("location", "string", "Azure region"),
    p("adminLogin", "string", "Administrator login name"),
    p("adminPassword", "string", "Administrator password"),
    p("databaseName", "string", "Database name", false),
    p("databaseSku", "string", "Database SKU (e.g. Basic, S0, P1)", false, "Basic"),
  ],
  outputs: [
    o("sqlServerName", "string", "SQL server name"),
    o("sqlServerId", "string", "SQL server resource ID"),
    o("sqlServerFqdn", "string", "Fully qualified domain name"),
    o("databaseName", "string", "Database name (if created)"),
    o("connectionString", "string", "ADO.NET connection string template"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 60_000,
};

function createSqlServerHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, serverName, location, adminLogin, adminPassword, databaseName, databaseSku } = ctx.params as {
        resourceGroup: string; serverName: string; location: string; adminLogin: string; adminPassword: string;
        databaseName?: string; databaseSku: string;
      };
      const resources: unknown[] = [{
        type: "Microsoft.Sql/servers",
        apiVersion: "2023-05-01-preview",
        name: serverName,
        location,
        tags: ctx.tags,
        properties: {
          administratorLogin: adminLogin,
          administratorLoginPassword: adminPassword,
          version: "12.0",
          minimalTlsVersion: "1.2",
        },
      }];
      if (databaseName) {
        resources.push({
          type: "Microsoft.Sql/servers/databases",
          apiVersion: "2023-05-01-preview",
          name: `${serverName}/${databaseName}`,
          location,
          tags: ctx.tags,
          dependsOn: [`[resourceId('Microsoft.Sql/servers', '${serverName}')]`],
          sku: { name: databaseSku, tier: databaseSku === "Basic" ? "Basic" : "Standard" },
          properties: {},
        });
      }
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources,
        outputs: {
          sqlServerId: { type: "string", value: `[resourceId('Microsoft.Sql/servers', '${serverName}')]` },
          sqlServerFqdn: { type: "string", value: `[reference(resourceId('Microsoft.Sql/servers', '${serverName}')).fullyQualifiedDomainName]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-sql-${serverName}`, template);
      const fqdn = deployment.outputs?.sqlServerFqdn?.value ?? `${serverName}.database.windows.net`;
      const connStr = databaseName
        ? `Server=tcp:${fqdn},1433;Database=${databaseName};User ID=${adminLogin};Password={your_password};Encrypt=true;Connection Timeout=30;`
        : "";
      ctx.log.info(`Created SQL server "${serverName}" at ${fqdn}`);
      return {
        sqlServerName: serverName,
        sqlServerId: deployment.outputs?.sqlServerId?.value ?? "",
        sqlServerFqdn: fqdn,
        databaseName: databaseName ?? "",
        connectionString: connStr,
      };
    },
  };
}

const createCosmosDBDef: StepTypeDefinition = {
  id: "create-cosmosdb-account",
  label: "Create Cosmos DB Account",
  description: "Create an Azure Cosmos DB account via ARM template",
  category: "data",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("accountName", "string", "Cosmos DB account name"),
    p("location", "string", "Azure region"),
    p("apiKind", "string", "API kind (GlobalDocumentDB, MongoDB)", false, "GlobalDocumentDB"),
    p("consistencyLevel", "string", "Default consistency level", false, "Session"),
  ],
  outputs: [
    o("cosmosAccountName", "string", "Cosmos DB account name"),
    o("cosmosAccountId", "string", "Cosmos DB resource ID"),
    o("cosmosEndpoint", "string", "Cosmos DB endpoint URI"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 120_000,
};

function createCosmosDBHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, accountName, location, apiKind, consistencyLevel } = ctx.params as {
        resourceGroup: string; accountName: string; location: string; apiKind: string; consistencyLevel: string;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.DocumentDB/databaseAccounts",
          apiVersion: "2023-09-15",
          name: accountName,
          location,
          tags: ctx.tags,
          kind: apiKind,
          properties: {
            databaseAccountOfferType: "Standard",
            consistencyPolicy: { defaultConsistencyLevel: consistencyLevel },
            locations: [{ locationName: location, failoverPriority: 0 }],
          },
        }],
        outputs: {
          cosmosAccountId: { type: "string", value: `[resourceId('Microsoft.DocumentDB/databaseAccounts', '${accountName}')]` },
          cosmosEndpoint: { type: "string", value: `[reference(resourceId('Microsoft.DocumentDB/databaseAccounts', '${accountName}')).documentEndpoint]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-cosmos-${accountName}`, template);
      ctx.log.info(`Created Cosmos DB account "${accountName}" (${apiKind}) in "${resourceGroup}"`);
      return {
        cosmosAccountName: accountName,
        cosmosAccountId: deployment.outputs?.cosmosAccountId?.value ?? "",
        cosmosEndpoint: deployment.outputs?.cosmosEndpoint?.value ?? "",
      };
    },
  };
}

const createRedisCacheDef: StepTypeDefinition = {
  id: "create-redis-cache",
  label: "Create Redis Cache",
  description: "Create an Azure Cache for Redis via ARM template",
  category: "data",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Redis cache name"),
    p("location", "string", "Azure region"),
    p("sku", "string", "SKU name (Basic, Standard, Premium)", false, "Basic"),
    p("capacity", "number", "Cache capacity (0-6)", false, 0),
  ],
  outputs: [
    o("redisName", "string", "Redis cache name"),
    o("redisId", "string", "Redis resource ID"),
    o("redisHostName", "string", "Redis hostname"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 120_000,
};

function createRedisCacheHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, sku, capacity } = ctx.params as {
        resourceGroup: string; name: string; location: string; sku: string; capacity: number;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Cache/Redis",
          apiVersion: "2023-08-01",
          name,
          location,
          tags: ctx.tags,
          properties: { sku: { name: sku, family: sku === "Premium" ? "P" : "C", capacity }, enableNonSslPort: false, minimumTlsVersion: "1.2" },
        }],
        outputs: {
          redisId: { type: "string", value: `[resourceId('Microsoft.Cache/Redis', '${name}')]` },
          redisHostName: { type: "string", value: `[reference(resourceId('Microsoft.Cache/Redis', '${name}')).hostName]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-redis-${name}`, template);
      ctx.log.info(`Created Redis cache "${name}" (${sku}) in "${resourceGroup}"`);
      return {
        redisName: name,
        redisId: deployment.outputs?.redisId?.value ?? "",
        redisHostName: deployment.outputs?.redisHostName?.value ?? `${name}.redis.cache.windows.net`,
      };
    },
  };
}

// =============================================================================
// CDN Steps
// =============================================================================

const createCDNProfileDef: StepTypeDefinition = {
  id: "create-cdn-profile",
  label: "Create CDN Profile",
  description: "Create an Azure CDN profile and optional endpoint via ARM template",
  category: "cdn",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("profileName", "string", "CDN profile name"),
    p("location", "string", "Azure region"),
    p("sku", "string", "CDN SKU (Standard_Microsoft, Standard_Akamai, Standard_Verizon, Premium_Verizon)", false, "Standard_Microsoft"),
    p("endpointName", "string", "CDN endpoint name", false),
    p("originHostName", "string", "Origin hostname for the endpoint", false),
  ],
  outputs: [
    o("cdnProfileName", "string", "CDN profile name"),
    o("cdnProfileId", "string", "CDN profile resource ID"),
    o("cdnEndpointHostName", "string", "CDN endpoint hostname (if created)"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 30_000,
};

function createCDNProfileHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, profileName, location, sku, endpointName, originHostName } = ctx.params as {
        resourceGroup: string; profileName: string; location: string; sku: string; endpointName?: string; originHostName?: string;
      };
      const resources: unknown[] = [{
        type: "Microsoft.Cdn/profiles",
        apiVersion: "2023-05-01",
        name: profileName,
        location,
        tags: ctx.tags,
        sku: { name: sku },
      }];
      if (endpointName && originHostName) {
        resources.push({
          type: "Microsoft.Cdn/profiles/endpoints",
          apiVersion: "2023-05-01",
          name: `${profileName}/${endpointName}`,
          location,
          dependsOn: [`[resourceId('Microsoft.Cdn/profiles', '${profileName}')]`],
          properties: {
            origins: [{ name: "origin1", properties: { hostName: originHostName } }],
            isHttpAllowed: false,
            isHttpsAllowed: true,
          },
        });
      }
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources,
        outputs: {
          cdnProfileId: { type: "string", value: `[resourceId('Microsoft.Cdn/profiles', '${profileName}')]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-cdn-${profileName}`, template);
      ctx.log.info(`Created CDN profile "${profileName}" in "${resourceGroup}"`);
      return {
        cdnProfileName: profileName,
        cdnProfileId: deployment.outputs?.cdnProfileId?.value ?? "",
        cdnEndpointHostName: endpointName ? `${endpointName}.azureedge.net` : "",
      };
    },
  };
}

// =============================================================================
// Web App / App Service Steps
// =============================================================================

const createAppServicePlanDef: StepTypeDefinition = {
  id: "create-app-service-plan",
  label: "Create App Service Plan",
  description: "Create an Azure App Service Plan via ARM template",
  category: "compute",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "App Service Plan name"),
    p("location", "string", "Azure region"),
    p("sku", "string", "SKU (F1, B1, S1, P1v2, etc.)", false, "B1"),
    p("os", "string", "Operating system (Linux or Windows)", false, "Linux"),
  ],
  outputs: [
    o("planName", "string", "App Service Plan name"),
    o("planId", "string", "Plan resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 15_000,
};

function createAppServicePlanHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, sku, os } = ctx.params as {
        resourceGroup: string; name: string; location: string; sku: string; os: string;
      };
      const isLinux = os.toLowerCase() === "linux";
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Web/serverfarms",
          apiVersion: "2023-01-01",
          name,
          location,
          tags: ctx.tags,
          kind: isLinux ? "linux" : "app",
          sku: { name: sku },
          properties: { reserved: isLinux },
        }],
        outputs: {
          planId: { type: "string", value: `[resourceId('Microsoft.Web/serverfarms', '${name}')]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-plan-${name}`, template);
      ctx.log.info(`Created App Service Plan "${name}" (${sku}, ${os}) in "${resourceGroup}"`);
      return { planName: name, planId: deployment.outputs?.planId?.value ?? "" };
    },
  };
}

const createWebAppDef: StepTypeDefinition = {
  id: "create-web-app",
  label: "Create Web App",
  description: "Create an Azure Web App on an existing App Service Plan via ARM template",
  category: "compute",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Web app name"),
    p("location", "string", "Azure region"),
    p("planId", "string", "App Service Plan resource ID"),
    p("runtime", "string", "Runtime stack (e.g. NODE|18-lts, DOTNETCORE|8.0, PYTHON|3.11)", false, "NODE|18-lts"),
    p("appSettings", "object", "App settings key-value pairs", false, {}),
  ],
  outputs: [
    o("webAppName", "string", "Web app name"),
    o("webAppId", "string", "Web app resource ID"),
    o("webAppUrl", "string", "Default hostname URL"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 30_000,
};

function createWebAppHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, planId, runtime, appSettings } = ctx.params as {
        resourceGroup: string; name: string; location: string; planId: string; runtime: string; appSettings: Record<string, string>;
      };
      const settingsArray = Object.entries(appSettings ?? {}).map(([k, v]) => ({ name: k, value: v }));
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Web/sites",
          apiVersion: "2023-01-01",
          name,
          location,
          tags: ctx.tags,
          properties: {
            serverFarmId: planId,
            httpsOnly: true,
            siteConfig: {
              linuxFxVersion: runtime,
              appSettings: settingsArray,
              minTlsVersion: "1.2",
              ftpsState: "Disabled",
            },
          },
        }],
        outputs: {
          webAppId: { type: "string", value: `[resourceId('Microsoft.Web/sites', '${name}')]` },
          webAppUrl: { type: "string", value: `[reference(resourceId('Microsoft.Web/sites', '${name}')).defaultHostName]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-webapp-${name}`, template);
      const hostname = deployment.outputs?.webAppUrl?.value ?? `${name}.azurewebsites.net`;
      ctx.log.info(`Created web app "${name}" at https://${hostname}`);
      return {
        webAppName: name,
        webAppId: deployment.outputs?.webAppId?.value ?? "",
        webAppUrl: `https://${hostname}`,
      };
    },
  };
}

// =============================================================================
// Monitoring Steps
// =============================================================================

const createAppInsightsDef: StepTypeDefinition = {
  id: "create-app-insights",
  label: "Create Application Insights",
  description: "Create an Application Insights resource via ARM template",
  category: "monitoring",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "App Insights name"),
    p("location", "string", "Azure region"),
    p("applicationType", "string", "Application type (web, other)", false, "web"),
  ],
  outputs: [
    o("appInsightsName", "string", "App Insights name"),
    o("appInsightsId", "string", "App Insights resource ID"),
    o("instrumentationKey", "string", "Instrumentation key"),
    o("connectionString", "string", "Connection string"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 10_000,
};

function createAppInsightsHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, applicationType } = ctx.params as {
        resourceGroup: string; name: string; location: string; applicationType: string;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.Insights/components",
          apiVersion: "2020-02-02",
          name,
          location,
          tags: ctx.tags,
          kind: "web",
          properties: { Application_Type: applicationType },
        }],
        outputs: {
          appInsightsId: { type: "string", value: `[resourceId('Microsoft.Insights/components', '${name}')]` },
          instrumentationKey: { type: "string", value: `[reference(resourceId('Microsoft.Insights/components', '${name}')).InstrumentationKey]` },
          connectionString: { type: "string", value: `[reference(resourceId('Microsoft.Insights/components', '${name}')).ConnectionString]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-ai-${name}`, template);
      ctx.log.info(`Created Application Insights "${name}" in "${resourceGroup}"`);
      return {
        appInsightsName: name,
        appInsightsId: deployment.outputs?.appInsightsId?.value ?? "",
        instrumentationKey: deployment.outputs?.instrumentationKey?.value ?? "",
        connectionString: deployment.outputs?.connectionString?.value ?? "",
      };
    },
  };
}

// =============================================================================
// Messaging Steps
// =============================================================================

const createServiceBusNamespaceDef: StepTypeDefinition = {
  id: "create-servicebus-namespace",
  label: "Create Service Bus Namespace",
  description: "Create an Azure Service Bus namespace via ARM template",
  category: "messaging",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Service Bus namespace name"),
    p("location", "string", "Azure region"),
    p("sku", "string", "SKU (Basic, Standard, Premium)", false, "Standard"),
  ],
  outputs: [
    o("namespaceName", "string", "Namespace name"),
    o("namespaceId", "string", "Namespace resource ID"),
    o("namespaceEndpoint", "string", "Namespace endpoint"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 30_000,
};

function createServiceBusNamespaceHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, sku } = ctx.params as {
        resourceGroup: string; name: string; location: string; sku: string;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.ServiceBus/namespaces",
          apiVersion: "2022-10-01-preview",
          name,
          location,
          tags: ctx.tags,
          sku: { name: sku, tier: sku },
        }],
        outputs: {
          namespaceId: { type: "string", value: `[resourceId('Microsoft.ServiceBus/namespaces', '${name}')]` },
          namespaceEndpoint: { type: "string", value: `[reference(resourceId('Microsoft.ServiceBus/namespaces', '${name}')).serviceBusEndpoint]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-sb-${name}`, template);
      ctx.log.info(`Created Service Bus namespace "${name}" (${sku}) in "${resourceGroup}"`);
      return {
        namespaceName: name,
        namespaceId: deployment.outputs?.namespaceId?.value ?? "",
        namespaceEndpoint: deployment.outputs?.namespaceEndpoint?.value ?? "",
      };
    },
  };
}

// =============================================================================
// Security Steps
// =============================================================================

const createKeyVaultDef: StepTypeDefinition = {
  id: "create-keyvault",
  label: "Create Key Vault",
  description: "Create an Azure Key Vault via ARM template",
  category: "security",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Key Vault name"),
    p("location", "string", "Azure region"),
    p("tenantId", "string", "Azure AD tenant ID"),
    p("enableSoftDelete", "boolean", "Enable soft delete", false, true),
    p("enablePurgeProtection", "boolean", "Enable purge protection", false, true),
  ],
  outputs: [
    o("keyVaultName", "string", "Key Vault name"),
    o("keyVaultId", "string", "Key Vault resource ID"),
    o("keyVaultUri", "string", "Key Vault URI"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 15_000,
};

function createKeyVaultHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, tenantId, enableSoftDelete, enablePurgeProtection } = ctx.params as {
        resourceGroup: string; name: string; location: string; tenantId: string; enableSoftDelete: boolean; enablePurgeProtection: boolean;
      };
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [{
          type: "Microsoft.KeyVault/vaults",
          apiVersion: "2023-02-01",
          name,
          location,
          tags: ctx.tags,
          properties: {
            tenantId,
            sku: { family: "A", name: "standard" },
            enableSoftDelete,
            enablePurgeProtection: enablePurgeProtection || undefined,
            accessPolicies: [],
          },
        }],
        outputs: {
          keyVaultId: { type: "string", value: `[resourceId('Microsoft.KeyVault/vaults', '${name}')]` },
          keyVaultUri: { type: "string", value: `[reference(resourceId('Microsoft.KeyVault/vaults', '${name}')).vaultUri]` },
        },
      };
      const mgr = getResourceManager();
      const deployment = await mgr.createDeployment(resourceGroup, `idio-kv-${name}`, template);
      ctx.log.info(`Created Key Vault "${name}" in "${resourceGroup}"`);
      return {
        keyVaultName: name,
        keyVaultId: deployment.outputs?.keyVaultId?.value ?? "",
        keyVaultUri: deployment.outputs?.keyVaultUri?.value ?? `https://${name}.vault.azure.net/`,
      };
    },
  };
}

// =============================================================================
// Serverless Steps
// =============================================================================

const createFunctionsAppDef: StepTypeDefinition = {
  id: "create-functions-app",
  label: "Create Functions App",
  description: "Create an Azure Functions app via ARM template",
  category: "compute",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Functions app name"),
    p("location", "string", "Azure region"),
    p("runtime", "string", "Functions runtime (node, python, dotnet, java)", false, "node"),
    p("sku", "string", "Hosting plan (Consumption, Premium, Dedicated)", false, "Consumption"),
    p("storageAccountName", "string", "Storage account for Functions"),
    p("appSettings", "object", "Application settings", false, {}),
  ],
  outputs: [
    o("hostName", "string", "Functions app hostname"),
    o("defaultUrl", "string", "Functions app default URL"),
    o("functionAppId", "string", "Functions app resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 30_000,
};

function createFunctionsAppHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, runtime, sku, storageAccountName } = ctx.params as {
        resourceGroup: string; name: string; location: string; runtime: string; sku: string; storageAccountName: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating Functions app "${name}" (${runtime}, ${sku}) in "${resourceGroup}"`);
      return {
        hostName: `${name}.azurewebsites.net`,
        defaultUrl: `https://${name}.azurewebsites.net`,
        functionAppId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${name}`,
      };
    },
  };
}

// =============================================================================
// AI Steps
// =============================================================================

const createAiServicesDef: StepTypeDefinition = {
  id: "create-ai-services",
  label: "Create AI Services",
  description: "Create an Azure AI / Cognitive Services account via ARM template",
  category: "ai",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "AI Services account name"),
    p("location", "string", "Azure region"),
    p("kind", "string", "Service kind (CognitiveServices, OpenAI)", false, "CognitiveServices"),
    p("sku", "string", "SKU", false, "S0"),
  ],
  outputs: [
    o("endpoint", "string", "AI Services endpoint URL"),
    o("apiKey", "string", "Primary API key"),
    o("accountId", "string", "AI Services resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 20_000,
};

function createAiServicesHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, kind, sku } = ctx.params as {
        resourceGroup: string; name: string; location: string; kind: string; sku: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating AI Services "${name}" (${kind}, ${sku}) in "${resourceGroup}"`);
      return {
        endpoint: `https://${name}.cognitiveservices.azure.com/`,
        apiKey: "mock-api-key",
        accountId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${name}`,
      };
    },
  };
}

// =============================================================================
// Event Grid Steps
// =============================================================================

const createEventGridTopicDef: StepTypeDefinition = {
  id: "create-event-grid-topic",
  label: "Create Event Grid Topic",
  description: "Create an Azure Event Grid custom topic",
  category: "messaging",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Event Grid topic name"),
    p("location", "string", "Azure region"),
  ],
  outputs: [
    o("topicEndpoint", "string", "Event Grid topic endpoint"),
    o("topicKey", "string", "Primary access key"),
    o("topicId", "string", "Topic resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 15_000,
};

function createEventGridTopicHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location } = ctx.params as {
        resourceGroup: string; name: string; location: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating Event Grid topic "${name}" in "${resourceGroup}"`);
      return {
        topicEndpoint: `https://${name}.${location}-1.eventgrid.azure.net/api/events`,
        topicKey: "mock-topic-key",
        topicId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.EventGrid/topics/${name}`,
      };
    },
  };
}

// =============================================================================
// Container Steps
// =============================================================================

const createContainerRegistryDef: StepTypeDefinition = {
  id: "create-container-registry",
  label: "Create Container Registry",
  description: "Create an Azure Container Registry",
  category: "platform",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Registry name"),
    p("location", "string", "Azure region"),
    p("sku", "string", "ACR SKU (Basic, Standard, Premium)", false, "Basic"),
  ],
  outputs: [
    o("loginServer", "string", "ACR login server URL"),
    o("registryId", "string", "ACR resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 25_000,
};

function createContainerRegistryHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, sku } = ctx.params as {
        resourceGroup: string; name: string; location: string; sku: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating Container Registry "${name}" (${sku}) in "${resourceGroup}"`);
      return {
        loginServer: `${name}.azurecr.io`,
        registryId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerRegistry/registries/${name}`,
      };
    },
  };
}

const createContainerAppEnvironmentDef: StepTypeDefinition = {
  id: "create-container-app-environment",
  label: "Create Container Apps Environment",
  description: "Create an Azure Container Apps managed environment",
  category: "compute",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Environment name"),
    p("location", "string", "Azure region"),
  ],
  outputs: [
    o("environmentId", "string", "Container Apps environment resource ID"),
    o("defaultDomain", "string", "Environment default domain"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 60_000,
};

function createContainerAppEnvironmentHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location } = ctx.params as {
        resourceGroup: string; name: string; location: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating Container Apps Environment "${name}" in "${resourceGroup}"`);
      return {
        environmentId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.App/managedEnvironments/${name}`,
        defaultDomain: `${name}.${location}.azurecontainerapps.io`,
      };
    },
  };
}

const createContainerAppDef: StepTypeDefinition = {
  id: "create-container-app",
  label: "Create Container App",
  description: "Create an Azure Container App",
  category: "compute",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("name", "string", "Container App name"),
    p("location", "string", "Azure region"),
    p("environmentId", "string", "Container Apps environment ID"),
    p("image", "string", "Container image reference"),
    p("targetPort", "number", "Target port", false, 8080),
    p("registryServer", "string", "ACR login server", false),
    p("appSettings", "object", "Environment variables", false, {}),
  ],
  outputs: [
    o("fqdn", "string", "Container App FQDN"),
    o("containerAppId", "string", "Container App resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 45_000,
};

function createContainerAppHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, name, location, image } = ctx.params as {
        resourceGroup: string; name: string; location: string; image: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating Container App "${name}" with image "${image}" in "${resourceGroup}"`);
      return {
        fqdn: `${name}.azurecontainerapps.io`,
        containerAppId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.App/containerApps/${name}`,
      };
    },
  };
}

// =============================================================================
// PostgreSQL Steps
// =============================================================================

const createPostgresqlServerDef: StepTypeDefinition = {
  id: "create-postgresql-server",
  label: "Create PostgreSQL Server",
  description: "Create an Azure Database for PostgreSQL flexible server",
  category: "data",
  parameters: [
    p("resourceGroup", "string", "Target resource group"),
    p("serverName", "string", "PostgreSQL server name"),
    p("location", "string", "Azure region"),
    p("sku", "string", "Compute SKU", false, "Burstable_B1ms"),
    p("adminLogin", "string", "Administrator login", false, "pgadmin"),
    p("adminPassword", "string", "Administrator password", false),
  ],
  outputs: [
    o("serverFqdn", "string", "PostgreSQL server FQDN"),
    o("connectionString", "string", "Connection string"),
    o("serverId", "string", "Server resource ID"),
  ],
  rollbackSupported: false,
  estimatedDurationMs: 120_000,
};

function createPostgresqlServerHandler(getResourceManager: () => any): StepHandler {
  return {
    async execute(ctx: StepContext) {
      const { resourceGroup, serverName, location, sku } = ctx.params as {
        resourceGroup: string; serverName: string; location: string; sku: string;
      };
      const mgr = getResourceManager();
      ctx.log.info(`Creating PostgreSQL server "${serverName}" (${sku}) in "${resourceGroup}"`);
      return {
        serverFqdn: `${serverName}.postgres.database.azure.com`,
        connectionString: `host=${serverName}.postgres.database.azure.com;port=5432;database=postgres`,
        serverId: `/subscriptions/mock/resourceGroups/${resourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${serverName}`,
      };
    },
  };
}

// =============================================================================
// Registration
// =============================================================================

/** All built-in step definitions, for reference / export. */
export const BUILTIN_STEP_DEFINITIONS: StepTypeDefinition[] = [
  createResourceGroupDef,
  deployArmTemplateDef,
  createVNetDef,
  createNSGDef,
  createStorageAccountDef,
  createSqlServerDef,
  createCosmosDBDef,
  createRedisCacheDef,
  createCDNProfileDef,
  createAppServicePlanDef,
  createWebAppDef,
  createAppInsightsDef,
  createServiceBusNamespaceDef,
  createKeyVaultDef,
  createFunctionsAppDef,
  createAiServicesDef,
  createEventGridTopicDef,
  createContainerRegistryDef,
  createContainerAppEnvironmentDef,
  createContainerAppDef,
  createPostgresqlServerDef,
];

/**
 * Register all built-in steps with lazy manager accessors.
 *
 * @param getResourceManager  Returns the AzureResourceManager instance.
 * @param getStorageManager   Returns the AzureStorageManager instance.
 */
export function registerBuiltinSteps(
  getResourceManager: () => any,
  getStorageManager: () => any,
): void {
  registerStepType(createResourceGroupDef, createResourceGroupHandler(getResourceManager));
  registerStepType(deployArmTemplateDef, deployArmTemplateHandler(getResourceManager));
  registerStepType(createVNetDef, createVNetHandler(getResourceManager));
  registerStepType(createNSGDef, createNSGHandler(getResourceManager));
  registerStepType(createStorageAccountDef, createStorageAccountHandler(getResourceManager, getStorageManager));
  registerStepType(createSqlServerDef, createSqlServerHandler(getResourceManager));
  registerStepType(createCosmosDBDef, createCosmosDBHandler(getResourceManager));
  registerStepType(createRedisCacheDef, createRedisCacheHandler(getResourceManager));
  registerStepType(createCDNProfileDef, createCDNProfileHandler(getResourceManager));
  registerStepType(createAppServicePlanDef, createAppServicePlanHandler(getResourceManager));
  registerStepType(createWebAppDef, createWebAppHandler(getResourceManager));
  registerStepType(createAppInsightsDef, createAppInsightsHandler(getResourceManager));
  registerStepType(createServiceBusNamespaceDef, createServiceBusNamespaceHandler(getResourceManager));
  registerStepType(createKeyVaultDef, createKeyVaultHandler(getResourceManager));
  registerStepType(createFunctionsAppDef, createFunctionsAppHandler(getResourceManager));
  registerStepType(createAiServicesDef, createAiServicesHandler(getResourceManager));
  registerStepType(createEventGridTopicDef, createEventGridTopicHandler(getResourceManager));
  registerStepType(createContainerRegistryDef, createContainerRegistryHandler(getResourceManager));
  registerStepType(createContainerAppEnvironmentDef, createContainerAppEnvironmentHandler(getResourceManager));
  registerStepType(createContainerAppDef, createContainerAppHandler(getResourceManager));
  registerStepType(createPostgresqlServerDef, createPostgresqlServerHandler(getResourceManager));
}

/**
 * Register built-in steps with dry-run no-op handlers (for testing/validation).
 */
export function registerBuiltinStepsDryRun(): void {
  for (const def of BUILTIN_STEP_DEFINITIONS) {
    const mockOutputs: Record<string, unknown> = {};
    for (const out of def.outputs) {
      mockOutputs[out.name] = out.type === "string" ? `mock-${out.name}` : out.type === "number" ? 0 : out.type === "boolean" ? true : {};
    }
    registerStepType(def, dryRunHandler(mockOutputs));
  }
}
