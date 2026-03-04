/**
 * GCP Catalog Manager
 *
 * Provides an infrastructure template catalog for common GCP
 * deployment patterns. Templates are stored in-memory and can be
 * extended with custom definitions.
 */

// =============================================================================
// Types
// =============================================================================

export type CatalogCategory =
  | "compute"
  | "storage"
  | "database"
  | "networking"
  | "serverless"
  | "containers"
  | "data-analytics"
  | "ai-ml"
  | "security"
  | "devops";

export type ParameterType = "string" | "number" | "boolean" | "enum" | "list";

export type TemplateParameter = {
  name: string;
  type: ParameterType;
  description: string;
  required: boolean;
  defaultValue?: string | number | boolean;
  allowedValues?: Array<string | number>;
  validation?: string;
};

export type CostEstimate = {
  monthly: number;
  currency: string;
  breakdown: Array<{ resource: string; cost: number }>;
  notes: string;
};

export type CatalogTemplate = {
  id: string;
  name: string;
  description: string;
  category: CatalogCategory;
  version: string;
  author: string;
  tags: string[];
  parameters: TemplateParameter[];
  resources: string[];
  estimatedCost?: CostEstimate;
  deploymentTime: string;
  prerequisites: string[];
  documentation?: string;
  template: Record<string, unknown>;
};

export type CatalogSearchOptions = {
  query?: string;
  category?: CatalogCategory;
  tags?: string[];
  maxResults?: number;
};

export type TemplateValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// =============================================================================
// Built-in templates
// =============================================================================

const BUILTIN_TEMPLATES: CatalogTemplate[] = [
  {
    id: "gcp-gce-web-server",
    name: "GCE Web Server",
    description: "Single Compute Engine instance with HTTP/HTTPS load balancer",
    category: "compute",
    version: "1.0.0",
    author: "espada",
    tags: ["compute", "web", "load-balancer"],
    parameters: [
      { name: "machineType", type: "string", description: "GCE machine type", required: false, defaultValue: "e2-medium" },
      { name: "zone", type: "string", description: "Compute zone", required: true },
      { name: "image", type: "string", description: "Boot disk image", required: false, defaultValue: "debian-cloud/debian-12" },
      { name: "diskSizeGb", type: "number", description: "Boot disk size in GB", required: false, defaultValue: 20 },
    ],
    resources: ["compute.googleapis.com/Instance", "compute.googleapis.com/HealthCheck", "compute.googleapis.com/BackendService"],
    estimatedCost: { monthly: 35, currency: "USD", breakdown: [{ resource: "e2-medium", cost: 25 }, { resource: "disk-20gb", cost: 10 }], notes: "Based on us-central1 pricing" },
    deploymentTime: "3-5 minutes",
    prerequisites: ["Compute Engine API enabled"],
    template: { type: "deployment-manager", config: { resources: [{ type: "compute.v1.instance" }] } },
  },
  {
    id: "gcp-gke-cluster",
    name: "GKE Autopilot Cluster",
    description: "Production-ready GKE Autopilot cluster with workload identity",
    category: "containers",
    version: "1.0.0",
    author: "espada",
    tags: ["kubernetes", "gke", "autopilot", "containers"],
    parameters: [
      { name: "clusterName", type: "string", description: "Cluster name", required: true },
      { name: "region", type: "string", description: "Region", required: true },
      { name: "networkName", type: "string", description: "VPC network", required: false, defaultValue: "default" },
      { name: "releaseChannel", type: "enum", description: "Release channel", required: false, defaultValue: "REGULAR", allowedValues: ["RAPID", "REGULAR", "STABLE"] },
    ],
    resources: ["container.googleapis.com/Cluster", "container.googleapis.com/NodePool"],
    estimatedCost: { monthly: 74, currency: "USD", breakdown: [{ resource: "autopilot-management", cost: 74 }], notes: "Management fee only; pod costs additional" },
    deploymentTime: "10-15 minutes",
    prerequisites: ["Kubernetes Engine API enabled", "VPC network exists"],
    template: { type: "deployment-manager", config: { resources: [{ type: "container.v1.cluster" }] } },
  },
  {
    id: "gcp-cloud-sql-postgres",
    name: "Cloud SQL PostgreSQL",
    description: "Managed PostgreSQL with high availability and automated backups",
    category: "database",
    version: "1.0.0",
    author: "espada",
    tags: ["database", "postgresql", "cloudsql", "managed"],
    parameters: [
      { name: "instanceName", type: "string", description: "Instance name", required: true },
      { name: "region", type: "string", description: "Region", required: true },
      { name: "tier", type: "string", description: "Machine tier", required: false, defaultValue: "db-custom-2-7680" },
      { name: "databaseVersion", type: "enum", description: "PostgreSQL version", required: false, defaultValue: "POSTGRES_15", allowedValues: ["POSTGRES_14", "POSTGRES_15", "POSTGRES_16"] },
      { name: "highAvailability", type: "boolean", description: "Enable HA", required: false, defaultValue: true },
      { name: "diskSizeGb", type: "number", description: "Disk size in GB", required: false, defaultValue: 100 },
    ],
    resources: ["sqladmin.googleapis.com/Instance", "sqladmin.googleapis.com/Database"],
    estimatedCost: { monthly: 185, currency: "USD", breakdown: [{ resource: "db-custom-2-7680", cost: 145 }, { resource: "disk-100gb-ssd", cost: 40 }], notes: "Based on us-central1 with HA" },
    deploymentTime: "5-10 minutes",
    prerequisites: ["Cloud SQL Admin API enabled"],
    template: { type: "deployment-manager", config: { resources: [{ type: "sqladmin.v1beta4.instance" }] } },
  },
  {
    id: "gcp-cloud-run-service",
    name: "Cloud Run Service",
    description: "Serverless container service with auto-scaling and custom domain",
    category: "serverless",
    version: "1.0.0",
    author: "espada",
    tags: ["serverless", "containers", "cloud-run", "auto-scaling"],
    parameters: [
      { name: "serviceName", type: "string", description: "Service name", required: true },
      { name: "region", type: "string", description: "Region", required: true },
      { name: "image", type: "string", description: "Container image URI", required: true },
      { name: "memory", type: "enum", description: "Memory limit", required: false, defaultValue: "512Mi", allowedValues: ["256Mi", "512Mi", "1Gi", "2Gi", "4Gi"] },
      { name: "maxInstances", type: "number", description: "Max instances", required: false, defaultValue: 100 },
      { name: "allowUnauthenticated", type: "boolean", description: "Allow public access", required: false, defaultValue: false },
    ],
    resources: ["run.googleapis.com/Service", "run.googleapis.com/Revision"],
    estimatedCost: { monthly: 0, currency: "USD", breakdown: [{ resource: "cloud-run", cost: 0 }], notes: "Pay per use; free tier: 2M requests/mo" },
    deploymentTime: "1-3 minutes",
    prerequisites: ["Cloud Run API enabled", "Container image in Artifact Registry"],
    template: { type: "cloud-run", config: { spec: { template: { spec: { containers: [{}] } } } } },
  },
  {
    id: "gcp-bigquery-dataset",
    name: "BigQuery Analytics Dataset",
    description: "BigQuery dataset with scheduled queries and data transfer",
    category: "data-analytics",
    version: "1.0.0",
    author: "espada",
    tags: ["bigquery", "analytics", "data-warehouse"],
    parameters: [
      { name: "datasetId", type: "string", description: "Dataset ID", required: true },
      { name: "location", type: "string", description: "Dataset location", required: false, defaultValue: "US" },
      { name: "defaultTableExpirationMs", type: "number", description: "Default table expiration (ms)", required: false },
    ],
    resources: ["bigquery.googleapis.com/Dataset", "bigquery.googleapis.com/Table"],
    estimatedCost: { monthly: 0, currency: "USD", breakdown: [{ resource: "bigquery-storage", cost: 0 }], notes: "Pay per query; 1TB/mo free analysis" },
    deploymentTime: "< 1 minute",
    prerequisites: ["BigQuery API enabled"],
    template: { type: "bigquery", config: { datasetReference: {} } },
  },
  {
    id: "gcp-vpc-network",
    name: "VPC Network with Subnets",
    description: "Custom VPC with regional subnets, Cloud NAT, and firewall rules",
    category: "networking",
    version: "1.0.0",
    author: "espada",
    tags: ["networking", "vpc", "firewall", "nat"],
    parameters: [
      { name: "networkName", type: "string", description: "VPC network name", required: true },
      { name: "region", type: "string", description: "Primary region", required: true },
      { name: "subnetCidr", type: "string", description: "Primary subnet CIDR", required: false, defaultValue: "10.0.0.0/20" },
      { name: "enableNat", type: "boolean", description: "Enable Cloud NAT", required: false, defaultValue: true },
    ],
    resources: ["compute.googleapis.com/Network", "compute.googleapis.com/Subnetwork", "compute.googleapis.com/Router", "compute.googleapis.com/Firewall"],
    estimatedCost: { monthly: 45, currency: "USD", breakdown: [{ resource: "cloud-nat", cost: 45 }], notes: "NAT gateway + data processing charges" },
    deploymentTime: "2-4 minutes",
    prerequisites: ["Compute Engine API enabled"],
    template: { type: "deployment-manager", config: { resources: [{ type: "compute.v1.network" }] } },
  },
  {
    id: "gcp-vertex-ai-endpoint",
    name: "Vertex AI Prediction Endpoint",
    description: "Vertex AI model deployment with online prediction endpoint",
    category: "ai-ml",
    version: "1.0.0",
    author: "espada",
    tags: ["ai", "ml", "vertex-ai", "prediction"],
    parameters: [
      { name: "endpointName", type: "string", description: "Endpoint display name", required: true },
      { name: "region", type: "string", description: "Region", required: true },
      { name: "modelId", type: "string", description: "Model resource ID", required: true },
      { name: "machineType", type: "string", description: "Machine type", required: false, defaultValue: "n1-standard-4" },
      { name: "minReplicas", type: "number", description: "Min replicas", required: false, defaultValue: 1 },
      { name: "maxReplicas", type: "number", description: "Max replicas", required: false, defaultValue: 3 },
    ],
    resources: ["aiplatform.googleapis.com/Endpoint", "aiplatform.googleapis.com/Model"],
    estimatedCost: { monthly: 210, currency: "USD", breakdown: [{ resource: "n1-standard-4", cost: 210 }], notes: "Based on 1 replica 24/7 in us-central1" },
    deploymentTime: "10-20 minutes",
    prerequisites: ["Vertex AI API enabled", "Trained model in Model Registry"],
    template: { type: "vertex-ai", config: { dedicatedResources: {} } },
  },
  {
    id: "gcp-gcs-static-site",
    name: "Cloud Storage Static Website",
    description: "Static website hosted on GCS with Cloud CDN and SSL",
    category: "storage",
    version: "1.0.0",
    author: "espada",
    tags: ["storage", "static-site", "cdn", "gcs"],
    parameters: [
      { name: "bucketName", type: "string", description: "Bucket name (globally unique)", required: true },
      { name: "location", type: "string", description: "Bucket location", required: false, defaultValue: "US" },
      { name: "enableCdn", type: "boolean", description: "Enable Cloud CDN", required: false, defaultValue: true },
    ],
    resources: ["storage.googleapis.com/Bucket", "compute.googleapis.com/BackendBucket", "compute.googleapis.com/GlobalForwardingRule"],
    estimatedCost: { monthly: 25, currency: "USD", breakdown: [{ resource: "gcs-storage", cost: 5 }, { resource: "cloud-cdn", cost: 20 }], notes: "Varies with traffic volume" },
    deploymentTime: "2-3 minutes",
    prerequisites: ["Cloud Storage API enabled"],
    template: { type: "deployment-manager", config: { resources: [{ type: "storage.v1.bucket" }] } },
  },
  {
    id: "gcp-secret-manager-setup",
    name: "Secret Manager Setup",
    description: "Secret Manager with rotation policy and IAM bindings",
    category: "security",
    version: "1.0.0",
    author: "espada",
    tags: ["security", "secrets", "secret-manager"],
    parameters: [
      { name: "secretId", type: "string", description: "Secret ID", required: true },
      { name: "replicationPolicy", type: "enum", description: "Replication policy", required: false, defaultValue: "automatic", allowedValues: ["automatic", "user-managed"] },
      { name: "rotationPeriod", type: "string", description: "Rotation period (e.g. 86400s)", required: false },
    ],
    resources: ["secretmanager.googleapis.com/Secret", "secretmanager.googleapis.com/SecretVersion"],
    estimatedCost: { monthly: 0.06, currency: "USD", breakdown: [{ resource: "secret-version", cost: 0.06 }], notes: "$0.06 per version per month + access charges" },
    deploymentTime: "< 1 minute",
    prerequisites: ["Secret Manager API enabled"],
    template: { type: "secret-manager", config: { replication: {} } },
  },
  {
    id: "gcp-cicd-cloud-build",
    name: "Cloud Build CI/CD Pipeline",
    description: "Cloud Build triggers with artifact registry and Cloud Deploy",
    category: "devops",
    version: "1.0.0",
    author: "espada",
    tags: ["cicd", "cloud-build", "devops", "deployment"],
    parameters: [
      { name: "triggerName", type: "string", description: "Build trigger name", required: true },
      { name: "repoOwner", type: "string", description: "Repository owner", required: true },
      { name: "repoName", type: "string", description: "Repository name", required: true },
      { name: "branchPattern", type: "string", description: "Branch pattern", required: false, defaultValue: "^main$" },
      { name: "dockerfilePath", type: "string", description: "Dockerfile path", required: false, defaultValue: "Dockerfile" },
    ],
    resources: ["cloudbuild.googleapis.com/BuildTrigger", "artifactregistry.googleapis.com/Repository"],
    estimatedCost: { monthly: 0, currency: "USD", breakdown: [{ resource: "cloud-build", cost: 0 }], notes: "120 free build-minutes/day; then $0.003/min" },
    deploymentTime: "1-2 minutes",
    prerequisites: ["Cloud Build API enabled", "Source repository connected"],
    template: { type: "cloud-build", config: { trigger: {} } },
  },
];

// =============================================================================
// Manager
// =============================================================================

export class GcpCatalogManager {
  private templates: Map<string, CatalogTemplate>;

  constructor(customTemplates?: CatalogTemplate[]) {
    this.templates = new Map();
    for (const t of BUILTIN_TEMPLATES) {
      this.templates.set(t.id, t);
    }
    if (customTemplates) {
      for (const t of customTemplates) {
        this.templates.set(t.id, t);
      }
    }
  }

  listTemplates(opts: CatalogSearchOptions = {}): CatalogTemplate[] {
    let results = Array.from(this.templates.values());

    if (opts.category) {
      results = results.filter((t) => t.category === opts.category);
    }

    if (opts.tags?.length) {
      const tagSet = new Set(opts.tags.map((t) => t.toLowerCase()));
      results = results.filter((t) =>
        t.tags.some((tag) => tagSet.has(tag.toLowerCase())),
      );
    }

    if (opts.query) {
      const q = opts.query.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    if (opts.maxResults && results.length > opts.maxResults) {
      results = results.slice(0, opts.maxResults);
    }

    return results;
  }

  getTemplate(templateId: string): CatalogTemplate | undefined {
    return this.templates.get(templateId);
  }

  getCategories(): Array<{ category: CatalogCategory; count: number }> {
    const counts = new Map<CatalogCategory, number>();
    for (const t of this.templates.values()) {
      counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  addTemplate(template: CatalogTemplate): void {
    this.templates.set(template.id, template);
  }

  removeTemplate(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  validateParameters(
    templateId: string,
    params: Record<string, unknown>,
  ): TemplateValidationResult {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, errors: [`Template "${templateId}" not found`], warnings: [] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const p of template.parameters) {
      const value = params[p.name];
      if (p.required && (value === undefined || value === null || value === "")) {
        errors.push(`Required parameter "${p.name}" is missing`);
        continue;
      }
      if (value === undefined) {
        if (p.defaultValue !== undefined) {
          warnings.push(`Parameter "${p.name}" not provided; will use default: ${p.defaultValue}`);
        }
        continue;
      }

      if (p.type === "number" && typeof value !== "number") {
        errors.push(`Parameter "${p.name}" must be a number`);
      }
      if (p.type === "boolean" && typeof value !== "boolean") {
        errors.push(`Parameter "${p.name}" must be a boolean`);
      }
      if (p.type === "enum" && p.allowedValues && !p.allowedValues.includes(value as string | number)) {
        errors.push(`Parameter "${p.name}" must be one of: ${p.allowedValues.join(", ")}`);
      }
    }

    const templateParamNames = new Set(template.parameters.map((p) => p.name));
    for (const key of Object.keys(params)) {
      if (!templateParamNames.has(key)) {
        warnings.push(`Unknown parameter "${key}" will be ignored`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  renderTemplate(
    templateId: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const template = this.templates.get(templateId);
    if (!template) return undefined;

    const resolved: Record<string, unknown> = {};
    for (const p of template.parameters) {
      resolved[p.name] = params[p.name] ?? p.defaultValue;
    }

    return {
      templateId: template.id,
      templateName: template.name,
      version: template.version,
      parameters: resolved,
      resources: template.resources,
      config: template.template,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCatalogManager(
  customTemplates?: CatalogTemplate[],
): GcpCatalogManager {
  return new GcpCatalogManager(customTemplates);
}
