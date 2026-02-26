/**
 * Azure Conversational Manager
 *
 * Natural-language infrastructure queries, proactive insights,
 * wizard-mode resource creation, and infrastructure context tracking.
 */

import { randomUUID } from "node:crypto";
import type {
  InfrastructureContext,
  TrackedResource,
  ParsedQuery,
  QueryResult,
  QueryCategory,
  QueryFilter,
  ProactiveInsight,
  WizardTemplate,
  WizardState,
  InfrastructureSummary,
} from "./types.js";

// =============================================================================
// Query Parsing (regex/keyword-based NL)
// =============================================================================

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: QueryCategory }> = [
  { pattern: /how many|count|total|number of/i, category: "count" },
  { pattern: /list|show|display|get all|find all/i, category: "list" },
  { pattern: /status|health|state|running|stopped|available/i, category: "status" },
  { pattern: /cost|spend|billing|expense|price|budget/i, category: "cost" },
  { pattern: /secur|vulnerab|threat|exposure|firewall|nsg/i, category: "security" },
  { pattern: /complian|audit|regulat|policy|governance/i, category: "compliance" },
  { pattern: /network|vnet|subnet|ip|dns|load.?balanc/i, category: "networking" },
  { pattern: /perf|slow|latency|throughput|cpu|memory|metric/i, category: "performance" },
  { pattern: /recommend|suggest|improv|optimiz|best.?practice/i, category: "recommendation" },
];

const RESOURCE_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /vm|virtual.?machine/i, type: "Microsoft.Compute/virtualMachines" },
  { pattern: /web.?app|app.?service/i, type: "Microsoft.Web/sites" },
  { pattern: /function.?app/i, type: "Microsoft.Web/sites" },
  { pattern: /container.?app/i, type: "Microsoft.App/containerApps" },
  { pattern: /aks|kubernetes/i, type: "Microsoft.ContainerService/managedClusters" },
  { pattern: /sql|database/i, type: "Microsoft.Sql/servers" },
  { pattern: /postgres/i, type: "Microsoft.DBforPostgreSQL/flexibleServers" },
  { pattern: /cosmos/i, type: "Microsoft.DocumentDB/databaseAccounts" },
  { pattern: /redis|cache/i, type: "Microsoft.Cache/Redis" },
  { pattern: /storage.?account|blob/i, type: "Microsoft.Storage/storageAccounts" },
  { pattern: /key.?vault/i, type: "Microsoft.KeyVault/vaults" },
  { pattern: /vnet|virtual.?network/i, type: "Microsoft.Network/virtualNetworks" },
  { pattern: /nsg|security.?group/i, type: "Microsoft.Network/networkSecurityGroups" },
  { pattern: /container.?registr|acr/i, type: "Microsoft.ContainerRegistry/registries" },
  { pattern: /service.?bus/i, type: "Microsoft.ServiceBus/namespaces" },
  { pattern: /event.?hub/i, type: "Microsoft.EventHub/namespaces" },
  { pattern: /api.?management/i, type: "Microsoft.ApiManagement/service" },
  { pattern: /cdn/i, type: "Microsoft.Cdn/profiles" },
  { pattern: /load.?balanc/i, type: "Microsoft.Network/loadBalancers" },
  { pattern: /app.?gateway/i, type: "Microsoft.Network/applicationGateways" },
];

const FILTER_PATTERNS: Array<{ pattern: RegExp; field: string; extractValue: (m: RegExpMatchArray) => string }> = [
  { pattern: /in\s+([\w-]+)\s+region/i, field: "region", extractValue: (m) => m[1]! },
  { pattern: /region\s+([\w-]+)/i, field: "region", extractValue: (m) => m[1]! },
  { pattern: /resource.?group\s+([\w-]+)/i, field: "resourceGroup", extractValue: (m) => m[1]! },
  { pattern: /in\s+([\w-]+)\s+resource.?group/i, field: "resourceGroup", extractValue: (m) => m[1]! },
  { pattern: /tagged\s+(\w+)/i, field: "tags", extractValue: (m) => m[1]! },
  { pattern: /with.?tag\s+(\w+)/i, field: "tags", extractValue: (m) => m[1]! },
];

// =============================================================================
// Wizard Templates
// =============================================================================

const WIZARD_TEMPLATES: WizardTemplate[] = [
  {
    id: "web-app",
    name: "Web Application",
    description: "Create a web application with App Service",
    category: "compute",
    steps: [
      {
        id: "basics", title: "Basics", description: "Basic configuration",
        fields: [
          { name: "name", label: "App Name", type: "text", required: true, placeholder: "my-web-app" },
          { name: "region", label: "Region", type: "select", required: true, options: [{ label: "East US", value: "eastus" }, { label: "West US 2", value: "westus2" }, { label: "West Europe", value: "westeurope" }] },
          { name: "resourceGroup", label: "Resource Group", type: "text", required: true },
        ],
      },
      {
        id: "runtime", title: "Runtime", description: "Runtime configuration",
        fields: [
          { name: "runtime", label: "Runtime stack", type: "select", required: true, options: [{ label: "Node.js 20", value: "node20" }, { label: "Python 3.12", value: "python3.12" }, { label: ".NET 8", value: "dotnet8" }, { label: "Java 21", value: "java21" }] },
          { name: "sku", label: "Pricing Tier", type: "select", required: true, default: "S1", options: [{ label: "Free (F1)", value: "F1" }, { label: "Basic (B1)", value: "B1" }, { label: "Standard (S1)", value: "S1" }, { label: "Premium (P1v3)", value: "P1v3" }] },
        ],
      },
    ],
  },
  {
    id: "database",
    name: "Database",
    description: "Create a managed database",
    category: "data",
    steps: [
      {
        id: "engine", title: "Database Engine", description: "Choose engine",
        fields: [
          { name: "engine", label: "Engine", type: "select", required: true, options: [{ label: "Azure SQL", value: "sql" }, { label: "PostgreSQL", value: "postgresql" }, { label: "MySQL", value: "mysql" }, { label: "Cosmos DB", value: "cosmosdb" }] },
          { name: "name", label: "Server Name", type: "text", required: true },
          { name: "region", label: "Region", type: "select", required: true, options: [{ label: "East US", value: "eastus" }, { label: "West Europe", value: "westeurope" }] },
        ],
      },
      {
        id: "sizing", title: "Sizing", description: "Size and performance",
        fields: [
          { name: "tier", label: "Tier", type: "select", required: true, default: "standard", options: [{ label: "Basic", value: "basic" }, { label: "Standard", value: "standard" }, { label: "Premium", value: "premium" }] },
          { name: "sizeGb", label: "Storage (GB)", type: "number", required: false, default: 32 },
        ],
      },
    ],
  },
  {
    id: "container-app",
    name: "Container App",
    description: "Deploy a containerized application",
    category: "compute",
    steps: [
      {
        id: "basics", title: "Basics", description: "Basic configuration",
        fields: [
          { name: "name", label: "App Name", type: "text", required: true },
          { name: "region", label: "Region", type: "select", required: true, options: [{ label: "East US", value: "eastus" }, { label: "West Europe", value: "westeurope" }] },
          { name: "image", label: "Container Image", type: "text", required: true, placeholder: "myregistry.azurecr.io/myapp:latest" },
        ],
      },
      {
        id: "scaling", title: "Scaling", description: "Scaling configuration",
        fields: [
          { name: "minReplicas", label: "Min Replicas", type: "number", required: false, default: 0 },
          { name: "maxReplicas", label: "Max Replicas", type: "number", required: false, default: 10 },
          { name: "external", label: "External Ingress", type: "boolean", required: false, default: true },
        ],
      },
    ],
  },
  {
    id: "kubernetes",
    name: "Kubernetes Cluster",
    description: "Create an AKS cluster",
    category: "compute",
    steps: [
      {
        id: "cluster", title: "Cluster", description: "Cluster configuration",
        fields: [
          { name: "name", label: "Cluster Name", type: "text", required: true },
          { name: "region", label: "Region", type: "select", required: true, options: [{ label: "East US", value: "eastus" }, { label: "West US 2", value: "westus2" }] },
          { name: "k8sVersion", label: "Kubernetes Version", type: "select", required: true, default: "1.29", options: [{ label: "1.29", value: "1.29" }, { label: "1.28", value: "1.28" }] },
        ],
      },
      {
        id: "nodepool", title: "Node Pool", description: "Default node pool",
        fields: [
          { name: "nodeCount", label: "Node Count", type: "number", required: true, default: 3 },
          { name: "vmSize", label: "VM Size", type: "select", required: true, default: "Standard_D2s_v5", options: [{ label: "Standard_D2s_v5 (2 vCPU, 8 GiB)", value: "Standard_D2s_v5" }, { label: "Standard_D4s_v5 (4 vCPU, 16 GiB)", value: "Standard_D4s_v5" }] },
          { name: "autoScaling", label: "Enable Auto-Scaling", type: "boolean", required: false, default: true },
        ],
      },
    ],
  },
];

// =============================================================================
// Conversational Manager
// =============================================================================

export class AzureConversationalManager {
  private static readonly MAX_WIZARD_STATES = 1000;
  private context: InfrastructureContext;
  private wizardStates: Map<string, WizardState> = new Map();

  constructor(subscriptionId: string) {
    this.context = {
      subscriptionId,
      resources: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Natural Language Query
  // ---------------------------------------------------------------------------

  query(naturalLanguage: string): QueryResult {
    const parsed = this.parseQuery(naturalLanguage);
    const filtered = this.filterResources(parsed);

    switch (parsed.category) {
      case "count":
        return this.buildCountResult(parsed, filtered);
      case "list":
        return this.buildListResult(parsed, filtered);
      case "status":
        return this.buildStatusResult(parsed, filtered);
      case "cost":
        return this.buildCostResult(parsed, filtered);
      case "security":
        return this.buildSecurityResult(parsed, filtered);
      case "recommendation":
        return this.buildRecommendationResult(parsed, filtered);
      default:
        return this.buildGeneralResult(parsed, filtered);
    }
  }

  // ---------------------------------------------------------------------------
  // Context Tracking
  // ---------------------------------------------------------------------------

  getContext(): InfrastructureContext {
    return this.context;
  }

  trackResource(resource: TrackedResource): void {
    const idx = this.context.resources.findIndex((r) => r.id === resource.id);
    if (idx >= 0) {
      this.context.resources[idx] = resource;
    } else {
      this.context.resources.push(resource);
    }
    this.context.lastUpdated = new Date().toISOString();
  }

  untrackResource(resourceId: string): boolean {
    const before = this.context.resources.length;
    this.context.resources = this.context.resources.filter((r) => r.id !== resourceId);
    this.context.lastUpdated = new Date().toISOString();
    return this.context.resources.length < before;
  }

  // ---------------------------------------------------------------------------
  // Proactive Insights
  // ---------------------------------------------------------------------------

  getInsights(): ProactiveInsight[] {
    const insights: ProactiveInsight[] = [];

    // Check for untagged resources
    const untagged = this.context.resources.filter((r) => Object.keys(r.tags).length === 0);
    if (untagged.length > 0) {
      insights.push({
        id: randomUUID(),
        title: "Untagged Resources",
        description: `${untagged.length} resource(s) have no tags, making cost allocation and governance difficult.`,
        severity: "warning",
        category: "best-practice",
        affectedResources: untagged.map((r) => r.id),
        recommendation: "Apply organization-standard tags (environment, owner, cost-center) to all resources.",
        autoFixAvailable: false,
        createdAt: new Date().toISOString(),
      });
    }

    // Check for unhealthy resources
    const unhealthy = this.context.resources.filter((r) => r.status === "unhealthy" || r.status === "failed");
    if (unhealthy.length > 0) {
      insights.push({
        id: randomUUID(),
        title: "Unhealthy Resources Detected",
        description: `${unhealthy.length} resource(s) are in an unhealthy or failed state.`,
        severity: "critical",
        category: "reliability",
        affectedResources: unhealthy.map((r) => r.id),
        recommendation: "Investigate and remediate unhealthy resources immediately.",
        autoFixAvailable: false,
        createdAt: new Date().toISOString(),
      });
    }

    // Check for resources without backups (data types)
    const dataResources = this.context.resources.filter((r) =>
      r.type.includes("Sql") || r.type.includes("PostgreSQL") || r.type.includes("MySQL") || r.type.includes("DocumentDB"),
    );
    for (const dr of dataResources) {
      const props = dr.properties as Record<string, unknown>;
      if (!props.backup && !props.backupRetentionDays) {
        insights.push({
          id: randomUUID(),
          title: "Database Without Backup Config",
          description: `Database "${dr.name}" may not have backup retention configured.`,
          severity: "warning",
          category: "reliability",
          affectedResources: [dr.id],
          recommendation: "Configure backup retention and geo-redundant backup for production databases.",
          autoFixAvailable: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Check for public-facing resources without NSG
    const publicResources = this.context.resources.filter((r) =>
      r.type.includes("Web/sites") || r.type.includes("containerApps"),
    );
    if (publicResources.length > 0) {
      const hasNsg = this.context.resources.some((r) => r.type.includes("networkSecurityGroups"));
      if (!hasNsg) {
        insights.push({
          id: randomUUID(),
          title: "No Network Security Groups",
          description: "Public-facing resources exist but no NSGs are tracked. Network traffic may be unfiltered.",
          severity: "warning",
          category: "security",
          affectedResources: publicResources.map((r) => r.id),
          recommendation: "Create and associate NSGs with subnets hosting public-facing resources.",
          autoFixAvailable: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Check for single-instance production resources
    const singleInstance = this.context.resources.filter((r) => {
      const props = r.properties as Record<string, unknown>;
      return r.tags.environment === "production" && (props.instanceCount === 1 || props.count === 1);
    });
    if (singleInstance.length > 0) {
      insights.push({
        id: randomUUID(),
        title: "Single-Instance Production Resources",
        description: `${singleInstance.length} production resource(s) running a single instance — no redundancy.`,
        severity: "warning",
        category: "reliability",
        affectedResources: singleInstance.map((r) => r.id),
        recommendation: "Scale to at least 2 instances for production workloads to ensure availability.",
        estimatedImpact: "Improved availability and fault tolerance",
        autoFixAvailable: false,
        createdAt: new Date().toISOString(),
      });
    }

    return insights;
  }

  // ---------------------------------------------------------------------------
  // Wizard Mode
  // ---------------------------------------------------------------------------

  listWizards(): WizardTemplate[] {
    return WIZARD_TEMPLATES;
  }

  startWizard(templateId: string): WizardState | null {
    const template = WIZARD_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return null;

    const sessionId = randomUUID();
    const state: WizardState = {
      sessionId,
      templateId,
      currentStep: 0,
      totalSteps: template.steps.length,
      values: {},
      completed: false,
      createdAt: new Date().toISOString(),
    };

    this.wizardStates.set(sessionId, state);

    // Evict oldest entries when exceeding max capacity
    if (this.wizardStates.size > AzureConversationalManager.MAX_WIZARD_STATES) {
      const firstKey = this.wizardStates.keys().next().value;
      if (firstKey) this.wizardStates.delete(firstKey);
    }

    return state;
  }

  wizardNext(sessionId: string, values: Record<string, unknown>): WizardState | null {
    const state = this.wizardStates.get(sessionId);
    if (!state || state.completed) return null;

    // Merge values from current step
    Object.assign(state.values, values);
    state.currentStep++;

    if (state.currentStep >= state.totalSteps) {
      state.completed = true;
    }

    return state;
  }

  getWizardState(sessionId: string): WizardState | null {
    return this.wizardStates.get(sessionId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Infrastructure Summary
  // ---------------------------------------------------------------------------

  getSummary(): InfrastructureSummary {
    const resources = this.context.resources;

    const byType: Record<string, number> = {};
    const byRegion: Record<string, number> = {};
    const byResourceGroup: Record<string, number> = {};
    let healthy = 0, degraded = 0, unhealthy = 0, unknown = 0;

    for (const r of resources) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
      byRegion[r.region] = (byRegion[r.region] ?? 0) + 1;
      byResourceGroup[r.resourceGroup] = (byResourceGroup[r.resourceGroup] ?? 0) + 1;

      switch (r.status) {
        case "healthy":
        case "running":
        case "succeeded": healthy++; break;
        case "degraded":
        case "warning": degraded++; break;
        case "unhealthy":
        case "failed":
        case "stopped": unhealthy++; break;
        default: unknown++;
      }
    }

    return {
      totalResources: resources.length,
      byType,
      byRegion,
      byResourceGroup,
      estimatedMonthlyCostUsd: 0, // Would need Azure Cost Management API for real data
      healthStatus: { healthy, degraded, unhealthy, unknown },
      insights: this.getInsights(),
    };
  }

  // ---------------------------------------------------------------------------
  // Query Parsing Internals
  // ---------------------------------------------------------------------------

  private parseQuery(text: string): ParsedQuery {
    let category: QueryCategory = "general";
    for (const cp of CATEGORY_PATTERNS) {
      if (cp.pattern.test(text)) {
        category = cp.category;
        break;
      }
    }

    const resourceTypes: string[] = [];
    for (const rp of RESOURCE_TYPE_PATTERNS) {
      if (rp.pattern.test(text)) {
        resourceTypes.push(rp.type);
      }
    }

    const filters: QueryFilter[] = [];
    for (const fp of FILTER_PATTERNS) {
      const match = text.match(fp.pattern);
      if (match) {
        filters.push({ field: fp.field, operator: "eq", value: fp.extractValue(match) });
      }
    }

    return { original: text, category, resourceTypes, filters, intent: text };
  }

  private filterResources(query: ParsedQuery): TrackedResource[] {
    let results = [...this.context.resources];

    if (query.resourceTypes.length > 0) {
      results = results.filter((r) => query.resourceTypes.includes(r.type));
    }

    for (const filter of query.filters) {
      results = results.filter((r) => {
        const value = (r as unknown as Record<string, unknown>)[filter.field];
        if (filter.operator === "eq") return String(value) === String(filter.value);
        if (filter.operator === "contains") return String(value).includes(String(filter.value));
        return true;
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Result Builders
  // ---------------------------------------------------------------------------

  private buildCountResult(query: ParsedQuery, resources: TrackedResource[]): QueryResult {
    const typeLabel = query.resourceTypes.length > 0
      ? query.resourceTypes.map((t) => t.split("/").pop()).join(", ")
      : "resources";
    return {
      query,
      answer: `Found ${resources.length} ${typeLabel}.`,
      data: [{ count: resources.length }],
      suggestions: ["List these resources", "Show their status", "Check costs"],
      confidence: 0.9,
    };
  }

  private buildListResult(query: ParsedQuery, resources: TrackedResource[]): QueryResult {
    return {
      query,
      answer: resources.length > 0
        ? `Found ${resources.length} resource(s):\n${resources.map((r) => `• ${r.name} (${r.type.split("/").pop()}) — ${r.region}`).join("\n")}`
        : "No matching resources found.",
      data: resources.map((r) => ({ name: r.name, type: r.type, region: r.region, status: r.status })),
      suggestions: resources.length > 0 ? ["Show status details", "Check costs", "Get recommendations"] : ["Track resources first"],
      confidence: 0.85,
    };
  }

  private buildStatusResult(query: ParsedQuery, resources: TrackedResource[]): QueryResult {
    const healthy = resources.filter((r) => r.status === "healthy" || r.status === "running").length;
    const unhealthy = resources.filter((r) => r.status === "unhealthy" || r.status === "failed").length;
    return {
      query,
      answer: `${resources.length} resources: ${healthy} healthy, ${unhealthy} unhealthy, ${resources.length - healthy - unhealthy} other.`,
      data: resources.map((r) => ({ name: r.name, type: r.type, status: r.status })),
      suggestions: unhealthy > 0 ? ["Show unhealthy resources", "Get remediation steps"] : ["Show all resources"],
      confidence: 0.9,
    };
  }

  private buildCostResult(query: ParsedQuery, _resources: TrackedResource[]): QueryResult {
    return {
      query,
      answer: "Cost analysis requires Azure Cost Management API integration. Use `azure_cost_management` tools for detailed billing data.",
      data: [],
      suggestions: ["Use azure_cost_query to get spending data", "Check budget alerts"],
      confidence: 0.7,
    };
  }

  private buildSecurityResult(query: ParsedQuery, resources: TrackedResource[]): QueryResult {
    const nsgs = resources.filter((r) => r.type.includes("networkSecurityGroups")).length;
    const kvs = resources.filter((r) => r.type.includes("KeyVault")).length;
    return {
      query,
      answer: `Security overview: ${nsgs} NSGs, ${kvs} Key Vaults tracked. Use Security Center tools for comprehensive assessment.`,
      data: [{ nsgs, keyVaults: kvs, totalTracked: resources.length }],
      suggestions: ["Check NSG rules", "Audit Key Vault access", "Run compliance scan"],
      confidence: 0.75,
    };
  }

  private buildRecommendationResult(query: ParsedQuery, _resources: TrackedResource[]): QueryResult {
    const insights = this.getInsights();
    if (insights.length === 0) {
      return {
        query,
        answer: "No recommendations at this time. Track more resources for proactive insights.",
        data: [],
        suggestions: ["Track resources", "Run infrastructure summary"],
        confidence: 0.8,
      };
    }
    return {
      query,
      answer: `${insights.length} recommendation(s):\n${insights.map((i) => `• [${i.severity}] ${i.title}: ${i.recommendation}`).join("\n")}`,
      data: insights,
      suggestions: ["Show affected resources", "Apply recommendations"],
      confidence: 0.85,
    };
  }

  private buildGeneralResult(query: ParsedQuery, resources: TrackedResource[]): QueryResult {
    return {
      query,
      answer: resources.length > 0
        ? `Found ${resources.length} resource(s) matching your query.`
        : "I couldn't find specific resources matching your query. Try asking about resource types, status, costs, or security.",
      data: resources.map((r) => ({ name: r.name, type: r.type, region: r.region })),
      suggestions: ["List all resources", "Show infrastructure summary", "Get recommendations"],
      confidence: 0.6,
    };
  }
}

/** Create a conversational manager for the given subscription. */
export function createConversationalManager(subscriptionId: string): AzureConversationalManager {
  return new AzureConversationalManager(subscriptionId);
}
