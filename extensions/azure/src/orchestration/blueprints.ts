/**
 * IDIO — Built-in Blueprints
 *
 * Reusable, parameterized templates that generate ExecutionPlans for
 * common multi-resource Azure architectures.
 */

import type { Blueprint, BlueprintParameter, ExecutionPlan, PlanStep, StepInstanceId } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function bp(
  name: string,
  type: BlueprintParameter["type"],
  description: string,
  required = true,
  defaultVal?: unknown,
): BlueprintParameter {
  return { name, type, description, required, default: defaultVal };
}

let planCounter = 0;
function nextPlanId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++planCounter}`;
}

function step(id: string, type: string, params: Record<string, unknown>, dependsOn: string[] = [], stepName?: string): PlanStep {
  return {
    id: id as StepInstanceId,
    type,
    name: stepName ?? id,
    params,
    dependsOn: dependsOn as StepInstanceId[],
  };
}

// =============================================================================
// Web App with SQL Backend
// =============================================================================

export const webAppWithSqlBlueprint: Blueprint = {
  id: "web-app-with-sql",
  name: "Web App with SQL Backend",
  description: "Deploys a web app on App Service with an Azure SQL database, App Insights monitoring, and optional Key Vault",
  category: "web-app",
  parameters: [
    bp("projectName", "string", "Project name used as prefix for all resources"),
    bp("location", "string", "Azure region (e.g. eastus)"),
    bp("sqlAdminLogin", "string", "SQL Server administrator login"),
    bp("sqlAdminPassword", "string", "SQL Server administrator password"),
    bp("runtime", "string", "Web app runtime stack", false, "NODE|18-lts"),
    bp("appServiceSku", "string", "App Service Plan SKU", false, "B1"),
    bp("sqlDatabaseSku", "string", "SQL Database SKU", false, "Basic"),
    bp("includeKeyVault", "boolean", "Include a Key Vault for secrets", false, false),
    bp("tenantId", "string", "Azure AD tenant ID (required if includeKeyVault=true)", false),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; sqlAdminLogin: string; sqlAdminPassword: string;
      runtime?: string; appServiceSku?: string; sqlDatabaseSku?: string; includeKeyVault?: boolean; tenantId?: string;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}`;
    const steps: PlanStep[] = [];

    // 1. Resource Group
    steps.push(step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"));

    // 2. App Service Plan
    steps.push(step("plan", "create-app-service-plan", {
      resourceGroup: `rg.outputs.resourceGroupName`,
      name: `plan-${prefix}`,
      location: p.location,
      sku: p.appServiceSku ?? "B1",
      os: "Linux",
    }, ["rg"], "Create App Service Plan"));

    // 3. App Insights
    steps.push(step("insights", "create-app-insights", {
      resourceGroup: `rg.outputs.resourceGroupName`,
      name: `ai-${prefix}`,
      location: p.location,
    }, ["rg"], "Create Application Insights"));

    // 4. SQL Server + Database
    steps.push(step("sql", "create-sql-server", {
      resourceGroup: `rg.outputs.resourceGroupName`,
      serverName: `sql-${prefix}`,
      location: p.location,
      adminLogin: p.sqlAdminLogin,
      adminPassword: p.sqlAdminPassword,
      databaseName: `db-${prefix}`,
      databaseSku: p.sqlDatabaseSku ?? "Basic",
    }, ["rg"], "Create SQL Server & Database"));

    // 5. Web App (depends on plan, insights, sql)
    const appSettings: Record<string, string> = {
      APPLICATIONINSIGHTS_CONNECTION_STRING: "insights.outputs.connectionString",
      SQL_CONNECTION_STRING: "sql.outputs.connectionString",
    };
    steps.push(step("webapp", "create-web-app", {
      resourceGroup: `rg.outputs.resourceGroupName`,
      name: `app-${prefix}`,
      location: p.location,
      planId: "plan.outputs.planId",
      runtime: p.runtime ?? "NODE|18-lts",
      appSettings,
    }, ["plan", "insights", "sql"], "Create Web App"));

    // 6. Optional Key Vault
    if (p.includeKeyVault && p.tenantId) {
      steps.push(step("keyvault", "create-keyvault", {
        resourceGroup: `rg.outputs.resourceGroupName`,
        name: `kv-${prefix}`,
        location: p.location,
        tenantId: p.tenantId,
      }, ["rg"], "Create Key Vault"));
    }

    return {
      id: nextPlanId("web-sql"),
      name: `Web App with SQL — ${p.projectName}`,
      description: `Deploy ${p.projectName} web app with SQL backend in ${p.location}`,
      steps,
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Static Website with CDN
// =============================================================================

export const staticWebWithCdnBlueprint: Blueprint = {
  id: "static-web-with-cdn",
  name: "Static Website with CDN",
  description: "Deploys a storage account for static hosting with a CDN profile and endpoint",
  category: "web-app",
  parameters: [
    bp("projectName", "string", "Project name used as prefix for all resources"),
    bp("location", "string", "Azure region (e.g. eastus)"),
    bp("cdnSku", "string", "CDN SKU", false, "Standard_Microsoft"),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as { projectName: string; location: string; cdnSku?: string };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}`;

    return {
      id: nextPlanId("static-cdn"),
      name: `Static Website with CDN — ${p.projectName}`,
      description: `Deploy a static site with CDN in ${p.location}`,
      steps: [
        step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"),
        step("storage", "create-storage-account", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `st${prefix}`.slice(0, 24),
          location: p.location,
          sku: "Standard_LRS",
          kind: "StorageV2",
        }, ["rg"], "Create Storage Account"),
        step("cdn", "create-cdn-profile", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          profileName: `cdn-${prefix}`,
          location: p.location,
          sku: p.cdnSku ?? "Standard_Microsoft",
          endpointName: `ep-${prefix}`,
          originHostName: `st${prefix}.blob.core.windows.net`.slice(0, 60),
        }, ["storage"], "Create CDN Profile & Endpoint"),
      ],
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// API Backend with Monitoring
// =============================================================================

export const apiBackendBlueprint: Blueprint = {
  id: "api-backend",
  name: "API Backend",
  description: "Deploys an API web app with VNet integration, NSG, Key Vault, Application Insights, and SQL backend",
  category: "api",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("sqlAdminLogin", "string", "SQL admin login"),
    bp("sqlAdminPassword", "string", "SQL admin password"),
    bp("tenantId", "string", "Azure AD tenant ID"),
    bp("runtime", "string", "Web app runtime", false, "DOTNETCORE|8.0"),
    bp("appServiceSku", "string", "App Service Plan SKU", false, "S1"),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; sqlAdminLogin: string; sqlAdminPassword: string;
      tenantId: string; runtime?: string; appServiceSku?: string;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}`;

    return {
      id: nextPlanId("api-backend"),
      name: `API Backend — ${p.projectName}`,
      description: `Deploy a secure API backend with networking and monitoring in ${p.location}`,
      steps: [
        step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"),

        // Networking layer (parallel)
        step("vnet", "create-vnet", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `vnet-${prefix}`,
          location: p.location,
          addressPrefix: "10.0.0.0/16",
          subnetName: "app-subnet",
          subnetPrefix: "10.0.1.0/24",
        }, ["rg"], "Create VNet"),
        step("nsg", "create-nsg", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `nsg-${prefix}`,
          location: p.location,
          rules: [
            { name: "AllowHTTPS", priority: 100, direction: "Inbound", access: "Allow", protocol: "Tcp", sourcePortRange: "*", destinationPortRange: "443", sourceAddressPrefix: "*", destinationAddressPrefix: "*" },
          ],
        }, ["rg"], "Create NSG"),

        // Security + monitoring (parallel)
        step("keyvault", "create-keyvault", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `kv-${prefix}`,
          location: p.location,
          tenantId: p.tenantId,
        }, ["rg"], "Create Key Vault"),
        step("insights", "create-app-insights", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `ai-${prefix}`,
          location: p.location,
        }, ["rg"], "Create App Insights"),

        // Data layer
        step("sql", "create-sql-server", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          serverName: `sql-${prefix}`,
          location: p.location,
          adminLogin: p.sqlAdminLogin,
          adminPassword: p.sqlAdminPassword,
          databaseName: `db-${prefix}`,
        }, ["rg"], "Create SQL Server & Database"),

        // Compute layer
        step("plan", "create-app-service-plan", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `plan-${prefix}`,
          location: p.location,
          sku: p.appServiceSku ?? "S1",
          os: "Linux",
        }, ["rg"], "Create App Service Plan"),
        step("api", "create-web-app", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `api-${prefix}`,
          location: p.location,
          planId: "plan.outputs.planId",
          runtime: p.runtime ?? "DOTNETCORE|8.0",
          appSettings: {
            APPLICATIONINSIGHTS_CONNECTION_STRING: "insights.outputs.connectionString",
            SQL_CONNECTION_STRING: "sql.outputs.connectionString",
            KEY_VAULT_URI: "keyvault.outputs.keyVaultUri",
          },
        }, ["plan", "insights", "sql", "keyvault", "vnet"], "Create API App"),
      ],
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Microservices Backbone
// =============================================================================

export const microservicesBackboneBlueprint: Blueprint = {
  id: "microservices-backbone",
  name: "Microservices Backbone",
  description: "Deploys foundational infrastructure for microservices: VNet, Service Bus, Redis Cache, Key Vault, and Application Insights",
  category: "microservices",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("tenantId", "string", "Azure AD tenant ID"),
    bp("serviceBusSku", "string", "Service Bus SKU", false, "Standard"),
    bp("redisSku", "string", "Redis SKU", false, "Standard"),
    bp("redisCapacity", "number", "Redis capacity", false, 1),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; tenantId: string;
      serviceBusSku?: string; redisSku?: string; redisCapacity?: number;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}`;

    return {
      id: nextPlanId("microservices"),
      name: `Microservices Backbone — ${p.projectName}`,
      description: `Deploy microservices foundation in ${p.location}`,
      steps: [
        step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"),

        // Networking
        step("vnet", "create-vnet", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `vnet-${prefix}`,
          location: p.location,
          addressPrefix: "10.0.0.0/16",
          subnetName: "services",
          subnetPrefix: "10.0.0.0/20",
        }, ["rg"], "Create VNet"),

        // Messaging
        step("servicebus", "create-servicebus-namespace", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `sb-${prefix}`,
          location: p.location,
          sku: p.serviceBusSku ?? "Standard",
        }, ["rg"], "Create Service Bus Namespace"),

        // Cache
        step("redis", "create-redis-cache", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `redis-${prefix}`,
          location: p.location,
          sku: p.redisSku ?? "Standard",
          capacity: p.redisCapacity ?? 1,
        }, ["rg"], "Create Redis Cache"),

        // Security
        step("keyvault", "create-keyvault", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `kv-${prefix}`,
          location: p.location,
          tenantId: p.tenantId,
        }, ["rg"], "Create Key Vault"),

        // Monitoring
        step("insights", "create-app-insights", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `ai-${prefix}`,
          location: p.location,
        }, ["rg"], "Create App Insights"),
      ],
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Data Platform
// =============================================================================

export const dataPlatformBlueprint: Blueprint = {
  id: "data-platform",
  name: "Data Platform",
  description: "Deploys a data platform with Cosmos DB, Storage, Redis Cache, and monitoring",
  category: "data",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("cosmosApiKind", "string", "Cosmos DB API (GlobalDocumentDB, MongoDB)", false, "GlobalDocumentDB"),
    bp("storageSku", "string", "Storage SKU", false, "Standard_GRS"),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; cosmosApiKind?: string; storageSku?: string;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}-data`;

    return {
      id: nextPlanId("data-platform"),
      name: `Data Platform — ${p.projectName}`,
      description: `Deploy data platform infrastructure in ${p.location}`,
      steps: [
        step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"),

        step("cosmos", "create-cosmosdb-account", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          accountName: `cosmos-${prefix}`,
          location: p.location,
          apiKind: p.cosmosApiKind ?? "GlobalDocumentDB",
        }, ["rg"], "Create Cosmos DB"),

        step("storage", "create-storage-account", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `st${prefix}data`.slice(0, 24),
          location: p.location,
          sku: p.storageSku ?? "Standard_GRS",
          kind: "StorageV2",
        }, ["rg"], "Create Storage Account"),

        step("redis", "create-redis-cache", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `redis-${prefix}`,
          location: p.location,
          sku: "Standard",
          capacity: 1,
        }, ["rg"], "Create Redis Cache"),

        step("insights", "create-app-insights", {
          resourceGroup: `rg.outputs.resourceGroupName`,
          name: `ai-${prefix}-data`,
          location: p.location,
        }, ["rg"], "Create App Insights"),
      ],
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Serverless Functions
// =============================================================================

export const serverlessFunctionsBlueprint: Blueprint = {
  id: "serverless-functions",
  name: "Serverless Functions",
  description: "Deploys Azure Functions with Storage, Application Insights, and optional Service Bus triggers",
  category: "api",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("runtime", "string", "Functions runtime", false, "node"),
    bp("functionsSku", "string", "Functions hosting plan", false, "Consumption"),
    bp("includeServiceBus", "boolean", "Include Service Bus for queue triggers", false, false),
    bp("includeKeyVault", "boolean", "Include Key Vault for secrets", false, false),
    bp("tenantId", "string", "Azure AD tenant ID (for Key Vault)", false),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; runtime?: string; functionsSku?: string;
      includeServiceBus?: boolean; includeKeyVault?: boolean; tenantId?: string;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}-func`;
    const steps: PlanStep[] = [];

    steps.push(step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"));

    // Storage (required for Functions)
    steps.push(step("storage", "create-storage-account", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `st${prefix}func`.slice(0, 24),
      location: p.location,
      sku: "Standard_LRS",
      kind: "StorageV2",
    }, ["rg"], "Create Storage Account"));

    // App Insights
    steps.push(step("insights", "create-app-insights", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `ai-${prefix}`,
      location: p.location,
    }, ["rg"], "Create Application Insights"));

    // Functions App
    const appSettings: Record<string, string> = {
      APPLICATIONINSIGHTS_CONNECTION_STRING: "insights.outputs.connectionString",
      AzureWebJobsStorage: "storage.outputs.connectionString",
    };

    steps.push(step("functions", "create-functions-app", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `func-${prefix}`,
      location: p.location,
      runtime: p.runtime ?? "node",
      sku: p.functionsSku ?? "Consumption",
      storageAccountName: "storage.outputs.storageAccountName",
      appSettings,
    }, ["storage", "insights"], "Create Functions App"));

    // Optional Service Bus
    if (p.includeServiceBus) {
      steps.push(step("servicebus", "create-servicebus-namespace", {
        resourceGroup: "rg.outputs.resourceGroupName",
        name: `sb-${prefix}`,
        location: p.location,
        sku: "Standard",
      }, ["rg"], "Create Service Bus Namespace"));
    }

    // Optional Key Vault
    if (p.includeKeyVault && p.tenantId) {
      steps.push(step("keyvault", "create-keyvault", {
        resourceGroup: "rg.outputs.resourceGroupName",
        name: `kv-${prefix}`,
        location: p.location,
        tenantId: p.tenantId,
      }, ["rg"], "Create Key Vault"));
    }

    return {
      id: nextPlanId("serverless"),
      name: `Serverless Functions — ${p.projectName}`,
      description: `Deploy serverless functions with monitoring in ${p.location}`,
      steps,
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// AI Workload
// =============================================================================

export const aiWorkloadBlueprint: Blueprint = {
  id: "ai-workload",
  name: "AI Workload",
  description: "Deploys Azure AI Services with Cosmos DB for data, Key Vault for secrets, App Service for hosting, and Application Insights",
  category: "ai",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("tenantId", "string", "Azure AD tenant ID"),
    bp("runtime", "string", "App runtime stack", false, "PYTHON|3.11"),
    bp("aiServiceKind", "string", "AI Service kind (CognitiveServices, OpenAI)", false, "CognitiveServices"),
    bp("cosmosApiKind", "string", "Cosmos DB API kind", false, "GlobalDocumentDB"),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; tenantId: string;
      runtime?: string; aiServiceKind?: string; cosmosApiKind?: string;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}-ai`;

    return {
      id: nextPlanId("ai-workload"),
      name: `AI Workload — ${p.projectName}`,
      description: `Deploy AI workload platform in ${p.location}`,
      steps: [
        step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"),

        // AI Services
        step("ai", "create-ai-services", {
          resourceGroup: "rg.outputs.resourceGroupName",
          name: `ai-${prefix}`,
          location: p.location,
          kind: p.aiServiceKind ?? "CognitiveServices",
          sku: "S0",
        }, ["rg"], "Create AI Services"),

        // Data layer — Cosmos DB
        step("cosmos", "create-cosmosdb-account", {
          resourceGroup: "rg.outputs.resourceGroupName",
          accountName: `cosmos-${prefix}`,
          location: p.location,
          apiKind: p.cosmosApiKind ?? "GlobalDocumentDB",
        }, ["rg"], "Create Cosmos DB"),

        // Secrets
        step("keyvault", "create-keyvault", {
          resourceGroup: "rg.outputs.resourceGroupName",
          name: `kv-${prefix}`,
          location: p.location,
          tenantId: p.tenantId,
        }, ["rg"], "Create Key Vault"),

        // Monitoring
        step("insights", "create-app-insights", {
          resourceGroup: "rg.outputs.resourceGroupName",
          name: `ai-insights-${prefix}`,
          location: p.location,
        }, ["rg"], "Create Application Insights"),

        // Compute (App Service)
        step("plan", "create-app-service-plan", {
          resourceGroup: "rg.outputs.resourceGroupName",
          name: `plan-${prefix}`,
          location: p.location,
          sku: "B1",
          os: "Linux",
        }, ["rg"], "Create App Service Plan"),

        step("webapp", "create-web-app", {
          resourceGroup: "rg.outputs.resourceGroupName",
          name: `app-${prefix}`,
          location: p.location,
          planId: "plan.outputs.planId",
          runtime: p.runtime ?? "PYTHON|3.11",
          appSettings: {
            APPLICATIONINSIGHTS_CONNECTION_STRING: "insights.outputs.connectionString",
            AI_ENDPOINT: "ai.outputs.endpoint",
            AI_API_KEY: "ai.outputs.apiKey",
            COSMOS_CONNECTION_STRING: "cosmos.outputs.connectionString",
            KEY_VAULT_URI: "keyvault.outputs.keyVaultUri",
          },
        }, ["plan", "ai", "cosmos", "keyvault", "insights"], "Create Web App"),
      ],
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Event-Driven Pipeline
// =============================================================================

export const eventDrivenPipelineBlueprint: Blueprint = {
  id: "event-driven-pipeline",
  name: "Event-Driven Pipeline",
  description: "Deploys an event-driven architecture with Service Bus, Functions, Storage queues, and monitoring",
  category: "messaging",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("runtime", "string", "Functions runtime", false, "node"),
    bp("serviceBusSku", "string", "Service Bus SKU", false, "Standard"),
    bp("includeEventGrid", "boolean", "Include Event Grid for pub/sub", false, true),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; runtime?: string;
      serviceBusSku?: string; includeEventGrid?: boolean;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}-events`;
    const steps: PlanStep[] = [];

    steps.push(step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"));

    // Storage (Functions requires it + queue storage)
    steps.push(step("storage", "create-storage-account", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `st${prefix}evt`.slice(0, 24),
      location: p.location,
      sku: "Standard_LRS",
      kind: "StorageV2",
    }, ["rg"], "Create Storage Account"));

    // Service Bus
    steps.push(step("servicebus", "create-servicebus-namespace", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `sb-${prefix}`,
      location: p.location,
      sku: p.serviceBusSku ?? "Standard",
    }, ["rg"], "Create Service Bus Namespace"));

    // Monitoring
    steps.push(step("insights", "create-app-insights", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `ai-${prefix}`,
      location: p.location,
    }, ["rg"], "Create Application Insights"));

    // Functions — event processors
    steps.push(step("functions", "create-functions-app", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `func-${prefix}`,
      location: p.location,
      runtime: p.runtime ?? "node",
      sku: "Consumption",
      storageAccountName: "storage.outputs.storageAccountName",
      appSettings: {
        APPLICATIONINSIGHTS_CONNECTION_STRING: "insights.outputs.connectionString",
        SERVICE_BUS_CONNECTION_STRING: "servicebus.outputs.namespaceEndpoint",
      },
    }, ["storage", "servicebus", "insights"], "Create Functions App"));

    // Optional Event Grid
    if (p.includeEventGrid !== false) {
      steps.push(step("eventgrid", "create-event-grid-topic", {
        resourceGroup: "rg.outputs.resourceGroupName",
        name: `eg-${prefix}`,
        location: p.location,
      }, ["rg"], "Create Event Grid Topic"));
    }

    return {
      id: nextPlanId("event-driven"),
      name: `Event-Driven Pipeline — ${p.projectName}`,
      description: `Deploy event-driven architecture in ${p.location}`,
      steps,
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Containerized API
// =============================================================================

export const containerizedApiBlueprint: Blueprint = {
  id: "containerized-api",
  name: "Containerized API",
  description: "Deploys a containerized API on Container Apps with ACR, Key Vault, Application Insights, and optional database",
  category: "api",
  parameters: [
    bp("projectName", "string", "Project name"),
    bp("location", "string", "Azure region"),
    bp("tenantId", "string", "Azure AD tenant ID"),
    bp("acrSku", "string", "Container Registry SKU", false, "Basic"),
    bp("includePostgres", "boolean", "Include PostgreSQL database", false, false),
    bp("includeRedis", "boolean", "Include Redis cache", false, false),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectName: string; location: string; tenantId: string;
      acrSku?: string; includePostgres?: boolean; includeRedis?: boolean;
    };
    const prefix = p.projectName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rgName = `rg-${prefix}-containers`;
    const steps: PlanStep[] = [];

    steps.push(step("rg", "create-resource-group", { name: rgName, location: p.location }, [], "Create Resource Group"));

    // ACR
    steps.push(step("acr", "create-container-registry", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `acr${prefix}`.slice(0, 50),
      location: p.location,
      sku: p.acrSku ?? "Basic",
    }, ["rg"], "Create Container Registry"));

    // Key Vault
    steps.push(step("keyvault", "create-keyvault", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `kv-${prefix}`,
      location: p.location,
      tenantId: p.tenantId,
    }, ["rg"], "Create Key Vault"));

    // App Insights
    steps.push(step("insights", "create-app-insights", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `ai-${prefix}`,
      location: p.location,
    }, ["rg"], "Create Application Insights"));

    // Container Apps Environment + App
    steps.push(step("container-env", "create-container-app-environment", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `cae-${prefix}`,
      location: p.location,
    }, ["rg"], "Create Container Apps Environment"));

    const appSettings: Record<string, string> = {
      APPLICATIONINSIGHTS_CONNECTION_STRING: "insights.outputs.connectionString",
      KEY_VAULT_URI: "keyvault.outputs.keyVaultUri",
    };

    steps.push(step("container-app", "create-container-app", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: `ca-${prefix}`,
      location: p.location,
      environmentId: "container-env.outputs.environmentId",
      registryServer: "acr.outputs.loginServer",
      image: `acr${prefix}.azurecr.io/${prefix}:latest`,
      targetPort: 8080,
      appSettings,
    }, ["container-env", "acr", "keyvault", "insights"], "Create Container App"));

    // Optional PostgreSQL
    if (p.includePostgres) {
      steps.push(step("postgres", "create-postgresql-server", {
        resourceGroup: "rg.outputs.resourceGroupName",
        serverName: `pg-${prefix}`,
        location: p.location,
        sku: "Burstable_B1ms",
      }, ["rg"], "Create PostgreSQL Server"));
    }

    // Optional Redis
    if (p.includeRedis) {
      steps.push(step("redis", "create-redis-cache", {
        resourceGroup: "rg.outputs.resourceGroupName",
        name: `redis-${prefix}`,
        location: p.location,
        sku: "Basic",
        capacity: 0,
      }, ["rg"], "Create Redis Cache"));
    }

    return {
      id: nextPlanId("containerized-api"),
      name: `Containerized API — ${p.projectName}`,
      description: `Deploy containerized API on Container Apps in ${p.location}`,
      steps,
      globalParams: { projectName: p.projectName, location: p.location },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Blueprint Registry
// =============================================================================

/** All built-in blueprints. */
export const BUILTIN_BLUEPRINTS: Blueprint[] = [
  webAppWithSqlBlueprint,
  staticWebWithCdnBlueprint,
  apiBackendBlueprint,
  microservicesBackboneBlueprint,
  dataPlatformBlueprint,
  serverlessFunctionsBlueprint,
  aiWorkloadBlueprint,
  eventDrivenPipelineBlueprint,
  containerizedApiBlueprint,
];

const blueprintMap = new Map<string, Blueprint>(
  BUILTIN_BLUEPRINTS.map((b) => [b.id, b]),
);

/** Get a blueprint by ID. */
export function getBlueprint(id: string): Blueprint | undefined {
  return blueprintMap.get(id);
}

/** List all available blueprint IDs and names. */
export function listBlueprints(): Array<{ id: string; name: string; description: string; category: string }> {
  return BUILTIN_BLUEPRINTS.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    category: b.category,
  }));
}

/** Register a custom blueprint at runtime. */
export function registerBlueprint(blueprint: Blueprint): void {
  blueprintMap.set(blueprint.id, blueprint);
}
