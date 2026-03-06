/**
 * Cross-Cloud Migration Engine — Compatibility Matrix
 *
 * Source × Target × ResourceType compatibility rules for all 12 migration directions.
 * Returns { compatible, warnings[], blockers[], workarounds[] } for each combination.
 */

import type {
  MigrationProvider,
  MigrationResourceType,
  CompatibilityResult,
  CompatibilityWarning,
  CompatibilityBlocker,
  CompatibilityWorkaround,
} from "../types.js";

// =============================================================================
// Compatibility Rule Definitions
// =============================================================================

type CompatibilityRuleDef = {
  compatible: boolean;
  warnings?: CompatibilityWarning[];
  blockers?: CompatibilityBlocker[];
  workarounds?: CompatibilityWorkaround[];
};

/**
 * Lookup key: `${source}:${target}:${resourceType}`
 * Rules for all 12 directions × 7 resource types = 84 entries.
 */
const RULES = new Map<string, CompatibilityRuleDef>();

function ruleKey(source: MigrationProvider, target: MigrationProvider, rt: MigrationResourceType): string {
  return `${source}:${target}:${rt}`;
}

function defineRule(
  source: MigrationProvider,
  target: MigrationProvider,
  rt: MigrationResourceType,
  rule: CompatibilityRuleDef,
): void {
  RULES.set(ruleKey(source, target, rt), rule);
}

// =============================================================================
// AWS ↔ Azure
// =============================================================================

defineRule("aws", "azure", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Hyper-V drivers (hv_vmbus, hv_storvsc, hv_netvsc) required for Azure", severity: "medium", affectedFeatures: ["boot", "networking"] },
    { code: "VM_SIZE_APPROX", message: "VM size mapping is approximate; review target VM size after conversion", severity: "low" },
  ],
});

defineRule("azure", "aws", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "AWS ENA/NVMe drivers required; Hyper-V agents will be removed", severity: "medium", affectedFeatures: ["boot", "networking"] },
    { code: "VM_SIZE_APPROX", message: "VM size mapping is approximate; review target instance type", severity: "low" },
  ],
});

defineRule("aws", "azure", "disk", {
  compatible: true,
  warnings: [
    { code: "DISK_FORMAT", message: "RAW → VHD conversion required", severity: "low" },
  ],
});

defineRule("azure", "aws", "disk", {
  compatible: true,
  warnings: [
    { code: "DISK_FORMAT", message: "VHD → RAW conversion required", severity: "low" },
  ],
});

defineRule("aws", "azure", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "S3 ACL/Bucket Policy → Azure RBAC: semantic mismatch possible", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "KMS keys do not transfer; target encryption must be configured separately", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("azure", "aws", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "Azure RBAC → S3 ACL: semantic mismatch possible", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "Azure CMK does not transfer; configure SSE-KMS on target", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("aws", "azure", "database", {
  compatible: true,
  warnings: [
    { code: "DB_PARAM_REVIEW", message: "Review PostgreSQL/MySQL parameters after migration (extensions, collation)", severity: "medium" },
  ],
});

defineRule("azure", "aws", "database", {
  compatible: true,
  warnings: [
    { code: "DB_PARAM_REVIEW", message: "Review database parameters after migration", severity: "medium" },
  ],
});

defineRule("aws", "azure", "dns", { compatible: true });
defineRule("azure", "aws", "dns", { compatible: true });

defineRule("aws", "azure", "security-rules", {
  compatible: true,
  warnings: [
    { code: "SG_STATEFUL", message: "Both AWS SG and Azure NSG are stateful; direct mapping supported", severity: "low" },
  ],
});

defineRule("azure", "aws", "security-rules", {
  compatible: true,
  warnings: [
    { code: "ASG_EXPAND", message: "Azure Application Security Groups have no AWS equivalent; expanded to CIDR ranges", severity: "high", affectedFeatures: ["security-groups"] },
  ],
});

defineRule("aws", "azure", "load-balancer", {
  compatible: true,
  warnings: [
    { code: "LB_FEATURE_DIFF", message: "AWS ALB features may not map 1:1 to Azure Application Gateway", severity: "medium" },
  ],
});

defineRule("azure", "aws", "load-balancer", {
  compatible: true,
  warnings: [
    { code: "LB_FEATURE_DIFF", message: "Azure LB/App Gateway features may not map 1:1 to AWS ALB/NLB", severity: "medium" },
  ],
});

// Enterprise resource types: AWS ↔ Azure
defineRule("aws", "azure", "iam-role", { compatible: true, warnings: [{ code: "IAM_MODEL_DIFF", message: "AWS IAM role → Azure RBAC: trust policy model differs significantly", severity: "high" }] });
defineRule("azure", "aws", "iam-role", { compatible: true, warnings: [{ code: "IAM_MODEL_DIFF", message: "Azure RBAC → AWS IAM: scope model differs", severity: "high" }] });
defineRule("aws", "azure", "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_DIFF", message: "AWS IAM policy → Azure role definition: action format differs", severity: "high" }] });
defineRule("azure", "aws", "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_DIFF", message: "Azure role definition → AWS IAM policy: resource format differs", severity: "high" }] });
defineRule("aws", "azure", "secret", { compatible: true, warnings: [{ code: "SECRET_BACKEND", message: "AWS Secrets Manager → Azure Key Vault: rotation config requires review", severity: "medium" }] });
defineRule("azure", "aws", "secret", { compatible: true, warnings: [{ code: "SECRET_BACKEND", message: "Azure Key Vault → AWS Secrets Manager: access policy model differs", severity: "medium" }] });
defineRule("aws", "azure", "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Key material cannot be transferred; new keys created on target", severity: "high" }] });
defineRule("azure", "aws", "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Key material cannot be transferred; new keys created on target", severity: "high" }] });
defineRule("aws", "azure", "lambda-function", { compatible: true, warnings: [{ code: "RUNTIME_TRANSLATE", message: "Lambda runtime → Azure Functions: handler and trigger model differ", severity: "high" }] });
defineRule("azure", "aws", "lambda-function", { compatible: true, warnings: [{ code: "RUNTIME_TRANSLATE", message: "Azure Functions → Lambda: bindings model differs from triggers", severity: "high" }] });
defineRule("aws", "azure", "api-gateway", { compatible: true, warnings: [{ code: "APIGW_TRANSLATE", message: "AWS API Gateway → Azure API Management: auth model differs", severity: "medium" }] });
defineRule("azure", "aws", "api-gateway", { compatible: true, warnings: [{ code: "APIGW_TRANSLATE", message: "Azure APIM → AWS API Gateway: policy model differs", severity: "medium" }] });
defineRule("aws", "azure", "container-service", { compatible: true, warnings: [{ code: "K8S_TRANSLATE", message: "ECS/EKS → AKS: task definitions require conversion to K8s manifests", severity: "high" }] });
defineRule("azure", "aws", "container-service", { compatible: true, warnings: [{ code: "K8S_TRANSLATE", message: "AKS → ECS/EKS: K8s manifests need ECS task definition conversion", severity: "high" }] });
defineRule("aws", "azure", "container-registry", { compatible: true });
defineRule("azure", "aws", "container-registry", { compatible: true });
defineRule("aws", "azure", "vpc", { compatible: true, warnings: [{ code: "VPC_TRANSLATE", message: "AWS VPC → Azure VNet: peering and NAT gateway config differ", severity: "medium" }] });
defineRule("azure", "aws", "vpc", { compatible: true, warnings: [{ code: "VPC_TRANSLATE", message: "Azure VNet → AWS VPC: NSG ↔ Security Group semantics differ", severity: "medium" }] });
defineRule("aws", "azure", "subnet", { compatible: true });
defineRule("azure", "aws", "subnet", { compatible: true });
defineRule("aws", "azure", "route-table", { compatible: true });
defineRule("azure", "aws", "route-table", { compatible: true });
defineRule("aws", "azure", "queue", { compatible: true, warnings: [{ code: "QUEUE_TRANSLATE", message: "SQS → Azure Queue Storage/Service Bus: FIFO semantics differ", severity: "medium" }] });
defineRule("azure", "aws", "queue", { compatible: true, warnings: [{ code: "QUEUE_TRANSLATE", message: "Azure Service Bus → SQS: session and topic model differ", severity: "medium" }] });
defineRule("aws", "azure", "notification-topic", { compatible: true, warnings: [{ code: "TOPIC_TRANSLATE", message: "SNS → Event Grid: subscription filter model differs", severity: "medium" }] });
defineRule("azure", "aws", "notification-topic", { compatible: true, warnings: [{ code: "TOPIC_TRANSLATE", message: "Event Grid → SNS: event schema model differs", severity: "medium" }] });
defineRule("aws", "azure", "cdn", { compatible: true, warnings: [{ code: "CDN_FEATURE_DIFF", message: "CloudFront → Azure CDN: behavior/caching rules differ", severity: "medium" }] });
defineRule("azure", "aws", "cdn", { compatible: true, warnings: [{ code: "CDN_FEATURE_DIFF", message: "Azure CDN → CloudFront: origin model differs", severity: "medium" }] });
defineRule("aws", "azure", "certificate", { compatible: true });
defineRule("azure", "aws", "certificate", { compatible: true });
defineRule("aws", "azure", "waf-rule", { compatible: true, warnings: [{ code: "WAF_TRANSLATE", message: "AWS WAF → Azure WAF Policy: managed rule sets differ", severity: "medium" }] });
defineRule("azure", "aws", "waf-rule", { compatible: true, warnings: [{ code: "WAF_TRANSLATE", message: "Azure WAF → AWS WAF: rule group format differs", severity: "medium" }] });
defineRule("aws", "azure", "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_TRANSLATE", message: "DynamoDB → CosmosDB: GSI ↔ secondary index model differs; partition key strategies differ", severity: "high" }] });
defineRule("azure", "aws", "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_TRANSLATE", message: "CosmosDB → DynamoDB: consistency model differs", severity: "high" }] });
defineRule("aws", "azure", "cache", { compatible: true, warnings: [{ code: "CACHE_EPHEMERAL", message: "Cache data is ephemeral; only configuration is migrated", severity: "low" }] });
defineRule("azure", "aws", "cache", { compatible: true, warnings: [{ code: "CACHE_EPHEMERAL", message: "Cache data is ephemeral; only configuration is migrated", severity: "low" }] });
defineRule("aws", "azure", "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_TRANSLATE", message: "AWS ASG → Azure VMSS: scaling policy format differs", severity: "medium" }] });
defineRule("azure", "aws", "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_TRANSLATE", message: "Azure VMSS → AWS ASG: scale set model differs", severity: "medium" }] });

// Full-estate enterprise resource types: AWS ↔ Azure
defineRule("aws", "azure", "step-function", { compatible: true, warnings: [{ code: "SF_TRANSLATE", message: "AWS Step Functions (ASL) → Azure Logic Apps: workflow definition requires manual translation", severity: "high" }] });
defineRule("azure", "aws", "step-function", { compatible: true, warnings: [{ code: "SF_TRANSLATE", message: "Azure Logic Apps → AWS Step Functions (ASL): workflow translation required", severity: "high" }] });
defineRule("aws", "azure", "event-bus", { compatible: true, warnings: [{ code: "EB_TRANSLATE", message: "EventBridge → Event Grid: event schema and rule format differ", severity: "medium" }] });
defineRule("azure", "aws", "event-bus", { compatible: true, warnings: [{ code: "EB_TRANSLATE", message: "Event Grid → EventBridge: event schema translation needed", severity: "medium" }] });
defineRule("aws", "azure", "file-system", { compatible: true, warnings: [{ code: "FS_TYPE_MAP", message: "EFS (NFS) → Azure Files (SMB/NFS): protocol and performance characteristics differ", severity: "medium" }] });
defineRule("azure", "aws", "file-system", { compatible: true, warnings: [{ code: "FS_TYPE_MAP", message: "Azure Files → EFS: SMB to NFS protocol translation", severity: "medium" }] });
defineRule("aws", "azure", "transit-gateway", { compatible: true, warnings: [{ code: "TGW_TRANSLATE", message: "AWS Transit Gateway → Azure Virtual WAN Hub: architecture differs significantly", severity: "high" }] });
defineRule("azure", "aws", "transit-gateway", { compatible: true, warnings: [{ code: "TGW_TRANSLATE", message: "Azure Virtual WAN → AWS Transit Gateway: hub model differs", severity: "high" }] });
defineRule("aws", "azure", "vpn-connection", { compatible: true, warnings: [{ code: "VPN_RECONFIG", message: "VPN tunnels require re-negotiation with customer gateway", severity: "high" }] });
defineRule("azure", "aws", "vpn-connection", { compatible: true, warnings: [{ code: "VPN_RECONFIG", message: "Azure VPN Gateway → AWS VPN: tunnel re-configuration needed", severity: "high" }] });
defineRule("aws", "azure", "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_SERVICE_MAP", message: "AWS VPC Endpoints → Azure Private Endpoints: service name mapping required", severity: "medium" }] });
defineRule("azure", "aws", "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_SERVICE_MAP", message: "Azure Private Endpoints → AWS VPC Endpoints: service mapping needed", severity: "medium" }] });
defineRule("aws", "azure", "parameter-store", { compatible: true, warnings: [{ code: "PARAM_TRANSLATE", message: "SSM Parameter Store → Azure App Configuration: path/hierarchy mapping differs", severity: "low" }] });
defineRule("azure", "aws", "parameter-store", { compatible: true, warnings: [{ code: "PARAM_TRANSLATE", message: "Azure App Configuration → SSM: key naming conventions differ", severity: "low" }] });
defineRule("aws", "azure", "iam-user", { compatible: true, warnings: [{ code: "USER_MODEL", message: "AWS IAM Users → Azure AD Users: identity model differs; passwords/keys not transferable", severity: "high" }] });
defineRule("azure", "aws", "iam-user", { compatible: true, warnings: [{ code: "USER_MODEL", message: "Azure AD Users → AWS IAM Users: identity model translation needed", severity: "high" }] });
defineRule("aws", "azure", "iam-group", { compatible: true, warnings: [{ code: "GROUP_MODEL", message: "AWS IAM Groups → Azure AD Groups: membership model differs", severity: "medium" }] });
defineRule("azure", "aws", "iam-group", { compatible: true, warnings: [{ code: "GROUP_MODEL", message: "Azure AD Groups → AWS IAM Groups: model translation needed", severity: "medium" }] });
defineRule("aws", "azure", "identity-provider", { compatible: true, warnings: [{ code: "IDP_REIMPL", message: "Cognito → Azure AD B2C: user pool migration requires password reset flow", severity: "high" }] });
defineRule("azure", "aws", "identity-provider", { compatible: true, warnings: [{ code: "IDP_REIMPL", message: "Azure AD B2C → Cognito: identity model translation needed", severity: "high" }] });
defineRule("aws", "azure", "log-group", { compatible: true, warnings: [{ code: "LOG_TRANSLATE", message: "CloudWatch Logs → Azure Monitor Logs: query syntax (Insights → KQL) differs", severity: "medium" }] });
defineRule("azure", "aws", "log-group", { compatible: true, warnings: [{ code: "LOG_TRANSLATE", message: "Azure Monitor → CloudWatch: KQL → Insights query translation", severity: "medium" }] });
defineRule("aws", "azure", "alarm", { compatible: true, warnings: [{ code: "ALARM_TRANSLATE", message: "CloudWatch Alarms → Azure Monitor Alerts: metric namespace mapping needed", severity: "medium" }] });
defineRule("azure", "aws", "alarm", { compatible: true, warnings: [{ code: "ALARM_TRANSLATE", message: "Azure Monitor Alerts → CloudWatch Alarms: metric mapping required", severity: "medium" }] });
defineRule("aws", "azure", "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_TRANSLATE", message: "AWS Glue → Azure Data Factory: ETL script rewrite required", severity: "high" }] });
defineRule("azure", "aws", "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_TRANSLATE", message: "Azure Data Factory → AWS Glue: pipeline translation needed", severity: "high" }] });
defineRule("aws", "azure", "stream", { compatible: true, warnings: [{ code: "STREAM_MAP", message: "Kinesis → Azure Event Hubs: shard-to-partition mapping differs", severity: "medium" }] });
defineRule("azure", "aws", "stream", { compatible: true, warnings: [{ code: "STREAM_MAP", message: "Event Hubs → Kinesis: partition-to-shard translation needed", severity: "medium" }] });
defineRule("aws", "azure", "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ENGINE", message: "Neptune → Cosmos DB Gremlin API: query compatibility varies", severity: "high" }] });
defineRule("azure", "aws", "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ENGINE", message: "Cosmos DB Gremlin → Neptune: API compatibility varies", severity: "high" }] });
defineRule("aws", "azure", "data-warehouse", { compatible: true, warnings: [{ code: "DW_TRANSLATE", message: "Redshift → Azure Synapse: SQL dialect and distribution keys differ", severity: "high" }] });
defineRule("azure", "aws", "data-warehouse", { compatible: true, warnings: [{ code: "DW_TRANSLATE", message: "Azure Synapse → Redshift: SQL dialect translation needed", severity: "high" }] });
defineRule("aws", "azure", "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_TRANSLATE", message: "S3 Bucket Policy → Azure RBAC: policy model translation required", severity: "medium" }] });
defineRule("azure", "aws", "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_TRANSLATE", message: "Azure RBAC → S3 Bucket Policy: different policy model", severity: "medium" }] });
defineRule("aws", "azure", "listener-rule", { compatible: true, warnings: [{ code: "LR_TRANSLATE", message: "ALB Listener Rules → Azure Front Door Rules: condition format differs", severity: "medium" }] });
defineRule("azure", "aws", "listener-rule", { compatible: true, warnings: [{ code: "LR_TRANSLATE", message: "Azure Front Door → ALB Listener Rules: rule format translation", severity: "medium" }] });
defineRule("aws", "azure", "network-acl", { compatible: true, warnings: [{ code: "NACL_NSG", message: "AWS NACLs → Azure NSGs: stateless-to-stateful rule model difference", severity: "medium" }] });
defineRule("azure", "aws", "network-acl", { compatible: true, warnings: [{ code: "NACL_NSG", message: "Azure NSGs → AWS NACLs: stateful-to-stateless conversion needed", severity: "medium" }] });

// =============================================================================
// AWS ↔ GCP
// =============================================================================

defineRule("aws", "gcp", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Google guest agent and virtio drivers required for GCP", severity: "medium", affectedFeatures: ["boot", "networking"] },
    { code: "VM_SIZE_APPROX", message: "Machine type mapping is approximate", severity: "low" },
  ],
});

defineRule("gcp", "aws", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "AWS ENA/NVMe drivers required; GCP agents will be removed", severity: "medium", affectedFeatures: ["boot", "networking"] },
  ],
});

defineRule("aws", "gcp", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "RAW format used for transfer", severity: "low" }] });
defineRule("gcp", "aws", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "RAW format used for transfer", severity: "low" }] });

defineRule("aws", "gcp", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "S3 ACL → GCS IAM: semantic differences", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "KMS keys do not transfer", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("gcp", "aws", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "GCS IAM → S3 ACL: semantic differences", severity: "medium", affectedFeatures: ["access-control"] },
    { code: "ENCRYPTION_REKEY", message: "CMEK does not transfer", severity: "medium", affectedFeatures: ["encryption"] },
  ],
});

defineRule("aws", "gcp", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review database parameters after migration", severity: "medium" }] });
defineRule("gcp", "aws", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review database parameters after migration", severity: "medium" }] });

defineRule("aws", "gcp", "dns", { compatible: true });
defineRule("gcp", "aws", "dns", { compatible: true });

defineRule("aws", "gcp", "security-rules", {
  compatible: true,
  warnings: [
    { code: "SG_TO_FIREWALL", message: "AWS Security Groups use SG references; GCP Firewall uses network tags — requires mapping", severity: "high", affectedFeatures: ["security-groups"] },
  ],
});

defineRule("gcp", "aws", "security-rules", {
  compatible: true,
  warnings: [
    { code: "TAGS_TO_SG", message: "GCP network tags have no direct AWS equivalent; mapped to SG membership", severity: "high", affectedFeatures: ["security-groups"] },
  ],
});

defineRule("aws", "gcp", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "AWS ALB → GCP HTTPS LB: feature parity varies", severity: "medium" }] });
defineRule("gcp", "aws", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "GCP HTTPS LB → AWS ALB: feature parity varies", severity: "medium" }] });

// Enterprise resource types: AWS ↔ GCP
defineRule("aws", "gcp", "iam-role", { compatible: true, warnings: [{ code: "IAM_MODEL_DIFF", message: "AWS IAM → GCP IAM: service account model differs from role assumption", severity: "high" }] });
defineRule("gcp", "aws", "iam-role", { compatible: true, warnings: [{ code: "IAM_MODEL_DIFF", message: "GCP service account → AWS IAM role: binding model differs", severity: "high" }] });
defineRule("aws", "gcp", "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_DIFF", message: "AWS IAM policy → GCP IAM binding: resource naming differs", severity: "high" }] });
defineRule("gcp", "aws", "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_DIFF", message: "GCP IAM binding → AWS IAM policy: condition model differs", severity: "high" }] });
defineRule("aws", "gcp", "secret", { compatible: true });
defineRule("gcp", "aws", "secret", { compatible: true });
defineRule("aws", "gcp", "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Key material cannot be transferred", severity: "high" }] });
defineRule("gcp", "aws", "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Key material cannot be transferred", severity: "high" }] });
defineRule("aws", "gcp", "lambda-function", { compatible: true, warnings: [{ code: "RUNTIME_TRANSLATE", message: "Lambda → Cloud Functions: event source mapping differs", severity: "high" }] });
defineRule("gcp", "aws", "lambda-function", { compatible: true, warnings: [{ code: "RUNTIME_TRANSLATE", message: "Cloud Functions → Lambda: trigger model differs", severity: "high" }] });
defineRule("aws", "gcp", "api-gateway", { compatible: true, warnings: [{ code: "APIGW_TRANSLATE", message: "AWS API Gateway → GCP API Gateway: OpenAPI spec translation needed", severity: "medium" }] });
defineRule("gcp", "aws", "api-gateway", { compatible: true, warnings: [{ code: "APIGW_TRANSLATE", message: "GCP API Gateway → AWS API Gateway: config translation needed", severity: "medium" }] });
defineRule("aws", "gcp", "container-service", { compatible: true, warnings: [{ code: "K8S_TRANSLATE", message: "ECS/EKS → GKE: ECS task defs need K8s manifest conversion", severity: "high" }] });
defineRule("gcp", "aws", "container-service", { compatible: true, warnings: [{ code: "K8S_TRANSLATE", message: "GKE → ECS/EKS: K8s manifests may need ECS conversion", severity: "high" }] });
defineRule("aws", "gcp", "container-registry", { compatible: true });
defineRule("gcp", "aws", "container-registry", { compatible: true });
defineRule("aws", "gcp", "vpc", { compatible: true, warnings: [{ code: "VPC_TRANSLATE", message: "AWS VPC → GCP VPC: subnets are regional in GCP", severity: "medium" }] });
defineRule("gcp", "aws", "vpc", { compatible: true, warnings: [{ code: "VPC_TRANSLATE", message: "GCP VPC → AWS VPC: regional subnets → AZ-based", severity: "medium" }] });
defineRule("aws", "gcp", "subnet", { compatible: true });
defineRule("gcp", "aws", "subnet", { compatible: true });
defineRule("aws", "gcp", "route-table", { compatible: true });
defineRule("gcp", "aws", "route-table", { compatible: true });
defineRule("aws", "gcp", "queue", { compatible: true, warnings: [{ code: "QUEUE_TRANSLATE", message: "SQS → Cloud Tasks/Pub/Sub: no native FIFO in Cloud Tasks", severity: "high" }] });
defineRule("gcp", "aws", "queue", { compatible: true, warnings: [{ code: "QUEUE_TRANSLATE", message: "Cloud Tasks → SQS: task queue model differs", severity: "medium" }] });
defineRule("aws", "gcp", "notification-topic", { compatible: true });
defineRule("gcp", "aws", "notification-topic", { compatible: true });
defineRule("aws", "gcp", "cdn", { compatible: true, warnings: [{ code: "CDN_FEATURE_DIFF", message: "CloudFront → Cloud CDN: behavior rule model differs", severity: "medium" }] });
defineRule("gcp", "aws", "cdn", { compatible: true, warnings: [{ code: "CDN_FEATURE_DIFF", message: "Cloud CDN → CloudFront: caching config model differs", severity: "medium" }] });
defineRule("aws", "gcp", "certificate", { compatible: true });
defineRule("gcp", "aws", "certificate", { compatible: true });
defineRule("aws", "gcp", "waf-rule", { compatible: true, warnings: [{ code: "WAF_TRANSLATE", message: "AWS WAF → Cloud Armor: rule expression language differs", severity: "medium" }] });
defineRule("gcp", "aws", "waf-rule", { compatible: true, warnings: [{ code: "WAF_TRANSLATE", message: "Cloud Armor → AWS WAF: rule format differs", severity: "medium" }] });
defineRule("aws", "gcp", "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_TRANSLATE", message: "DynamoDB → Firestore/Datastore: partition model fundamentally differs", severity: "high" }] });
defineRule("gcp", "aws", "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_TRANSLATE", message: "Firestore → DynamoDB: document model → table model conversion", severity: "high" }] });
defineRule("aws", "gcp", "cache", { compatible: true, warnings: [{ code: "CACHE_EPHEMERAL", message: "Cache data is ephemeral; only configuration migrated", severity: "low" }] });
defineRule("gcp", "aws", "cache", { compatible: true, warnings: [{ code: "CACHE_EPHEMERAL", message: "Cache data is ephemeral; only configuration migrated", severity: "low" }] });
defineRule("aws", "gcp", "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_TRANSLATE", message: "AWS ASG → GCP MIG: scaling policy format differs", severity: "medium" }] });
defineRule("gcp", "aws", "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_TRANSLATE", message: "GCP MIG → AWS ASG: instance template model differs", severity: "medium" }] });

// Full-estate enterprise resource types: AWS ↔ GCP
defineRule("aws", "gcp", "step-function", { compatible: true, warnings: [{ code: "SF_TRANSLATE", message: "AWS Step Functions (ASL) → GCP Workflows: workflow definition requires manual translation", severity: "high" }] });
defineRule("gcp", "aws", "step-function", { compatible: true, warnings: [{ code: "SF_TRANSLATE", message: "GCP Workflows → AWS Step Functions (ASL): workflow translation required", severity: "high" }] });
defineRule("aws", "gcp", "event-bus", { compatible: true, warnings: [{ code: "EB_TRANSLATE", message: "EventBridge → Eventarc: event schema and rule format differ", severity: "medium" }] });
defineRule("gcp", "aws", "event-bus", { compatible: true, warnings: [{ code: "EB_TRANSLATE", message: "Eventarc → EventBridge: event schema translation needed", severity: "medium" }] });
defineRule("aws", "gcp", "file-system", { compatible: true, warnings: [{ code: "FS_TYPE_MAP", message: "EFS (NFS) → GCP Filestore (NFS): performance tier mapping differs", severity: "medium" }] });
defineRule("gcp", "aws", "file-system", { compatible: true, warnings: [{ code: "FS_TYPE_MAP", message: "GCP Filestore → EFS: performance characteristics differ", severity: "medium" }] });
defineRule("aws", "gcp", "transit-gateway", { compatible: true, warnings: [{ code: "TGW_TRANSLATE", message: "AWS Transit Gateway → GCP Cloud Router: architecture differs significantly", severity: "high" }] });
defineRule("gcp", "aws", "transit-gateway", { compatible: true, warnings: [{ code: "TGW_TRANSLATE", message: "GCP Cloud Router → AWS Transit Gateway: routing model differs", severity: "high" }] });
defineRule("aws", "gcp", "vpn-connection", { compatible: true, warnings: [{ code: "VPN_RECONFIG", message: "VPN tunnels require re-negotiation with customer gateway", severity: "high" }] });
defineRule("gcp", "aws", "vpn-connection", { compatible: true, warnings: [{ code: "VPN_RECONFIG", message: "GCP Cloud VPN → AWS VPN: tunnel re-configuration needed", severity: "high" }] });
defineRule("aws", "gcp", "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_SERVICE_MAP", message: "AWS VPC Endpoints → GCP Private Service Connect: service name mapping required", severity: "medium" }] });
defineRule("gcp", "aws", "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_SERVICE_MAP", message: "GCP Private Service Connect → AWS VPC Endpoints: service mapping needed", severity: "medium" }] });
defineRule("aws", "gcp", "parameter-store", { compatible: true, warnings: [{ code: "PARAM_TRANSLATE", message: "SSM Parameter Store → GCP Runtime Configurator: path/hierarchy mapping differs", severity: "low" }] });
defineRule("gcp", "aws", "parameter-store", { compatible: true, warnings: [{ code: "PARAM_TRANSLATE", message: "GCP Runtime Configurator → SSM: key naming conventions differ", severity: "low" }] });
defineRule("aws", "gcp", "iam-user", { compatible: true, warnings: [{ code: "USER_MODEL", message: "AWS IAM Users → GCP IAM Members: identity model differs; passwords/keys not transferable", severity: "high" }] });
defineRule("gcp", "aws", "iam-user", { compatible: true, warnings: [{ code: "USER_MODEL", message: "GCP IAM Members → AWS IAM Users: identity model translation needed", severity: "high" }] });
defineRule("aws", "gcp", "iam-group", { compatible: true, warnings: [{ code: "GROUP_MODEL", message: "AWS IAM Groups → GCP IAM Groups: membership model differs", severity: "medium" }] });
defineRule("gcp", "aws", "iam-group", { compatible: true, warnings: [{ code: "GROUP_MODEL", message: "GCP IAM Groups → AWS IAM Groups: model translation needed", severity: "medium" }] });
defineRule("aws", "gcp", "identity-provider", { compatible: true, warnings: [{ code: "IDP_REIMPL", message: "Cognito → Firebase/GCP Identity Platform: user pool migration requires password reset flow", severity: "high" }] });
defineRule("gcp", "aws", "identity-provider", { compatible: true, warnings: [{ code: "IDP_REIMPL", message: "Firebase/GCP Identity Platform → Cognito: identity model translation needed", severity: "high" }] });
defineRule("aws", "gcp", "log-group", { compatible: true, warnings: [{ code: "LOG_TRANSLATE", message: "CloudWatch Logs → GCP Cloud Logging: query syntax differs", severity: "medium" }] });
defineRule("gcp", "aws", "log-group", { compatible: true, warnings: [{ code: "LOG_TRANSLATE", message: "GCP Cloud Logging → CloudWatch: query translation needed", severity: "medium" }] });
defineRule("aws", "gcp", "alarm", { compatible: true, warnings: [{ code: "ALARM_TRANSLATE", message: "CloudWatch Alarms → GCP Cloud Monitoring Alerts: metric namespace mapping needed", severity: "medium" }] });
defineRule("gcp", "aws", "alarm", { compatible: true, warnings: [{ code: "ALARM_TRANSLATE", message: "GCP Cloud Monitoring Alerts → CloudWatch Alarms: metric mapping required", severity: "medium" }] });
defineRule("aws", "gcp", "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_TRANSLATE", message: "AWS Glue → GCP Dataflow: ETL script rewrite required", severity: "high" }] });
defineRule("gcp", "aws", "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_TRANSLATE", message: "GCP Dataflow → AWS Glue: pipeline translation needed", severity: "high" }] });
defineRule("aws", "gcp", "stream", { compatible: true, warnings: [{ code: "STREAM_MAP", message: "Kinesis → GCP Pub/Sub: shard-to-subscription mapping differs", severity: "medium" }] });
defineRule("gcp", "aws", "stream", { compatible: true, warnings: [{ code: "STREAM_MAP", message: "GCP Pub/Sub → Kinesis: subscription-to-shard translation needed", severity: "medium" }] });
defineRule("aws", "gcp", "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ENGINE", message: "Neptune → GCP (JanusGraph on GCE): no native managed graph DB; self-managed required", severity: "high" }] });
defineRule("gcp", "aws", "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ENGINE", message: "GCP JanusGraph → Neptune: managed vs self-managed model differs", severity: "high" }] });
defineRule("aws", "gcp", "data-warehouse", { compatible: true, warnings: [{ code: "DW_TRANSLATE", message: "Redshift → BigQuery: SQL dialect and distribution model differ", severity: "high" }] });
defineRule("gcp", "aws", "data-warehouse", { compatible: true, warnings: [{ code: "DW_TRANSLATE", message: "BigQuery → Redshift: SQL dialect translation needed", severity: "high" }] });
defineRule("aws", "gcp", "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_TRANSLATE", message: "S3 Bucket Policy → GCP IAM: policy model translation required", severity: "medium" }] });
defineRule("gcp", "aws", "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_TRANSLATE", message: "GCP IAM → S3 Bucket Policy: different policy model", severity: "medium" }] });
defineRule("aws", "gcp", "listener-rule", { compatible: true, warnings: [{ code: "LR_TRANSLATE", message: "ALB Listener Rules → GCP URL Map Rules: condition format differs", severity: "medium" }] });
defineRule("gcp", "aws", "listener-rule", { compatible: true, warnings: [{ code: "LR_TRANSLATE", message: "GCP URL Map → ALB Listener Rules: rule format translation", severity: "medium" }] });
defineRule("aws", "gcp", "network-acl", { compatible: true, warnings: [{ code: "NACL_FIREWALL", message: "AWS NACLs → GCP Firewall Rules: stateless-to-stateful rule model difference", severity: "medium" }] });
defineRule("gcp", "aws", "network-acl", { compatible: true, warnings: [{ code: "NACL_FIREWALL", message: "GCP Firewall Rules → AWS NACLs: stateful-to-stateless conversion needed", severity: "medium" }] });

// =============================================================================
// Azure ↔ GCP
// =============================================================================

defineRule("azure", "gcp", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Google guest agent required; Hyper-V agents will be removed", severity: "medium" },
  ],
});

defineRule("gcp", "azure", "vm", {
  compatible: true,
  warnings: [
    { code: "VM_DRIVER_SWAP", message: "Hyper-V drivers required; GCP agents will be removed", severity: "medium" },
  ],
});

defineRule("azure", "gcp", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "VHD → RAW conversion", severity: "low" }] });
defineRule("gcp", "azure", "disk", { compatible: true, warnings: [{ code: "DISK_FORMAT", message: "RAW → VHD conversion", severity: "low" }] });

defineRule("azure", "gcp", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "Azure RBAC → GCS IAM", severity: "medium" },
    { code: "ENCRYPTION_REKEY", message: "CMK keys do not transfer", severity: "medium" },
  ],
});

defineRule("gcp", "azure", "object-storage", {
  compatible: true,
  warnings: [
    { code: "ACL_MISMATCH", message: "GCS IAM → Azure RBAC", severity: "medium" },
    { code: "ENCRYPTION_REKEY", message: "CMEK does not transfer", severity: "medium" },
  ],
});

defineRule("azure", "gcp", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review parameters after migration", severity: "medium" }] });
defineRule("gcp", "azure", "database", { compatible: true, warnings: [{ code: "DB_PARAM_REVIEW", message: "Review parameters after migration", severity: "medium" }] });

defineRule("azure", "gcp", "dns", { compatible: true });
defineRule("gcp", "azure", "dns", { compatible: true });

defineRule("azure", "gcp", "security-rules", {
  compatible: true,
  warnings: [
    { code: "ASG_NO_EQUIV", message: "Azure ASGs expanded to CIDR for GCP; GCP uses network tags", severity: "high" },
  ],
});

defineRule("gcp", "azure", "security-rules", {
  compatible: true,
  warnings: [
    { code: "TAGS_NO_EQUIV", message: "GCP network tags mapped to NSG rules; may lose tag semantics", severity: "high" },
  ],
});

defineRule("azure", "gcp", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "Feature parity varies between LB types", severity: "medium" }] });
defineRule("gcp", "azure", "load-balancer", { compatible: true, warnings: [{ code: "LB_FEATURE_DIFF", message: "Feature parity varies between LB types", severity: "medium" }] });

// Enterprise resource types: Azure ↔ GCP
defineRule("azure", "gcp", "iam-role", { compatible: true, warnings: [{ code: "IAM_MODEL_DIFF", message: "Azure RBAC → GCP IAM: scope and binding model differ", severity: "high" }] });
defineRule("gcp", "azure", "iam-role", { compatible: true, warnings: [{ code: "IAM_MODEL_DIFF", message: "GCP IAM → Azure RBAC: service account model differs", severity: "high" }] });
defineRule("azure", "gcp", "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_DIFF", message: "Azure role → GCP role: permission format differs", severity: "high" }] });
defineRule("gcp", "azure", "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_DIFF", message: "GCP role → Azure role: action format differs", severity: "high" }] });
defineRule("azure", "gcp", "secret", { compatible: true });
defineRule("gcp", "azure", "secret", { compatible: true });
defineRule("azure", "gcp", "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Key material cannot be transferred", severity: "high" }] });
defineRule("gcp", "azure", "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Key material cannot be transferred", severity: "high" }] });
defineRule("azure", "gcp", "lambda-function", { compatible: true, warnings: [{ code: "RUNTIME_TRANSLATE", message: "Azure Functions → Cloud Functions: binding model differs from triggers", severity: "high" }] });
defineRule("gcp", "azure", "lambda-function", { compatible: true, warnings: [{ code: "RUNTIME_TRANSLATE", message: "Cloud Functions → Azure Functions: trigger model differs", severity: "high" }] });
defineRule("azure", "gcp", "api-gateway", { compatible: true });
defineRule("gcp", "azure", "api-gateway", { compatible: true });
defineRule("azure", "gcp", "container-service", { compatible: true, warnings: [{ code: "K8S_COMPAT", message: "AKS → GKE: both K8s-native; networking plugins may differ", severity: "medium" }] });
defineRule("gcp", "azure", "container-service", { compatible: true, warnings: [{ code: "K8S_COMPAT", message: "GKE → AKS: both K8s-native; networking plugins may differ", severity: "medium" }] });
defineRule("azure", "gcp", "container-registry", { compatible: true });
defineRule("gcp", "azure", "container-registry", { compatible: true });
defineRule("azure", "gcp", "vpc", { compatible: true, warnings: [{ code: "VPC_TRANSLATE", message: "Azure VNet → GCP VPC: subnet scoping differs", severity: "medium" }] });
defineRule("gcp", "azure", "vpc", { compatible: true, warnings: [{ code: "VPC_TRANSLATE", message: "GCP VPC → Azure VNet: regional vs AZ subnets", severity: "medium" }] });
defineRule("azure", "gcp", "subnet", { compatible: true });
defineRule("gcp", "azure", "subnet", { compatible: true });
defineRule("azure", "gcp", "route-table", { compatible: true });
defineRule("gcp", "azure", "route-table", { compatible: true });
defineRule("azure", "gcp", "queue", { compatible: true });
defineRule("gcp", "azure", "queue", { compatible: true });
defineRule("azure", "gcp", "notification-topic", { compatible: true });
defineRule("gcp", "azure", "notification-topic", { compatible: true });
defineRule("azure", "gcp", "cdn", { compatible: true });
defineRule("gcp", "azure", "cdn", { compatible: true });
defineRule("azure", "gcp", "certificate", { compatible: true });
defineRule("gcp", "azure", "certificate", { compatible: true });
defineRule("azure", "gcp", "waf-rule", { compatible: true, warnings: [{ code: "WAF_TRANSLATE", message: "Azure WAF → Cloud Armor: rule set translation needed", severity: "medium" }] });
defineRule("gcp", "azure", "waf-rule", { compatible: true, warnings: [{ code: "WAF_TRANSLATE", message: "Cloud Armor → Azure WAF: expression format differs", severity: "medium" }] });
defineRule("azure", "gcp", "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_TRANSLATE", message: "CosmosDB → Firestore: consistency and partition model differ", severity: "high" }] });
defineRule("gcp", "azure", "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_TRANSLATE", message: "Firestore → CosmosDB: document model conversion needed", severity: "high" }] });
defineRule("azure", "gcp", "cache", { compatible: true, warnings: [{ code: "CACHE_EPHEMERAL", message: "Cache data is ephemeral; only config migrated", severity: "low" }] });
defineRule("gcp", "azure", "cache", { compatible: true, warnings: [{ code: "CACHE_EPHEMERAL", message: "Cache data is ephemeral; only config migrated", severity: "low" }] });
defineRule("azure", "gcp", "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_TRANSLATE", message: "Azure VMSS → GCP MIG: scaling policy format differs", severity: "medium" }] });
defineRule("gcp", "azure", "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_TRANSLATE", message: "GCP MIG → Azure VMSS: instance group model differs", severity: "medium" }] });

// Full-estate enterprise resource types: Azure ↔ GCP
defineRule("azure", "gcp", "step-function", { compatible: true, warnings: [{ code: "SF_TRANSLATE", message: "Azure Logic Apps → GCP Workflows: workflow definition requires manual translation", severity: "high" }] });
defineRule("gcp", "azure", "step-function", { compatible: true, warnings: [{ code: "SF_TRANSLATE", message: "GCP Workflows → Azure Logic Apps: workflow translation required", severity: "high" }] });
defineRule("azure", "gcp", "event-bus", { compatible: true, warnings: [{ code: "EB_TRANSLATE", message: "Event Grid → Eventarc: event schema and rule format differ", severity: "medium" }] });
defineRule("gcp", "azure", "event-bus", { compatible: true, warnings: [{ code: "EB_TRANSLATE", message: "Eventarc → Event Grid: event schema translation needed", severity: "medium" }] });
defineRule("azure", "gcp", "file-system", { compatible: true, warnings: [{ code: "FS_TYPE_MAP", message: "Azure Files (SMB/NFS) → GCP Filestore (NFS): protocol mapping differs", severity: "medium" }] });
defineRule("gcp", "azure", "file-system", { compatible: true, warnings: [{ code: "FS_TYPE_MAP", message: "GCP Filestore → Azure Files: NFS to SMB/NFS protocol translation", severity: "medium" }] });
defineRule("azure", "gcp", "transit-gateway", { compatible: true, warnings: [{ code: "TGW_TRANSLATE", message: "Azure Virtual WAN Hub → GCP Cloud Router: architecture differs significantly", severity: "high" }] });
defineRule("gcp", "azure", "transit-gateway", { compatible: true, warnings: [{ code: "TGW_TRANSLATE", message: "GCP Cloud Router → Azure Virtual WAN: routing model differs", severity: "high" }] });
defineRule("azure", "gcp", "vpn-connection", { compatible: true, warnings: [{ code: "VPN_RECONFIG", message: "VPN tunnels require re-negotiation with customer gateway", severity: "high" }] });
defineRule("gcp", "azure", "vpn-connection", { compatible: true, warnings: [{ code: "VPN_RECONFIG", message: "GCP Cloud VPN → Azure VPN Gateway: tunnel re-configuration needed", severity: "high" }] });
defineRule("azure", "gcp", "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_SERVICE_MAP", message: "Azure Private Endpoints → GCP Private Service Connect: service name mapping required", severity: "medium" }] });
defineRule("gcp", "azure", "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_SERVICE_MAP", message: "GCP Private Service Connect → Azure Private Endpoints: service mapping needed", severity: "medium" }] });
defineRule("azure", "gcp", "parameter-store", { compatible: true, warnings: [{ code: "PARAM_TRANSLATE", message: "Azure App Configuration → GCP Runtime Configurator: path/hierarchy mapping differs", severity: "low" }] });
defineRule("gcp", "azure", "parameter-store", { compatible: true, warnings: [{ code: "PARAM_TRANSLATE", message: "GCP Runtime Configurator → Azure App Configuration: key naming conventions differ", severity: "low" }] });
defineRule("azure", "gcp", "iam-user", { compatible: true, warnings: [{ code: "USER_MODEL", message: "Azure AD Users → GCP IAM Members: identity model differs; passwords/keys not transferable", severity: "high" }] });
defineRule("gcp", "azure", "iam-user", { compatible: true, warnings: [{ code: "USER_MODEL", message: "GCP IAM Members → Azure AD Users: identity model translation needed", severity: "high" }] });
defineRule("azure", "gcp", "iam-group", { compatible: true, warnings: [{ code: "GROUP_MODEL", message: "Azure AD Groups → GCP IAM Groups: membership model differs", severity: "medium" }] });
defineRule("gcp", "azure", "iam-group", { compatible: true, warnings: [{ code: "GROUP_MODEL", message: "GCP IAM Groups → Azure AD Groups: model translation needed", severity: "medium" }] });
defineRule("azure", "gcp", "identity-provider", { compatible: true, warnings: [{ code: "IDP_REIMPL", message: "Azure AD B2C → Firebase/GCP Identity Platform: user pool migration requires password reset flow", severity: "high" }] });
defineRule("gcp", "azure", "identity-provider", { compatible: true, warnings: [{ code: "IDP_REIMPL", message: "Firebase/GCP Identity Platform → Azure AD B2C: identity model translation needed", severity: "high" }] });
defineRule("azure", "gcp", "log-group", { compatible: true, warnings: [{ code: "LOG_TRANSLATE", message: "Azure Monitor Logs → GCP Cloud Logging: KQL → logging query translation", severity: "medium" }] });
defineRule("gcp", "azure", "log-group", { compatible: true, warnings: [{ code: "LOG_TRANSLATE", message: "GCP Cloud Logging → Azure Monitor: query syntax translation", severity: "medium" }] });
defineRule("azure", "gcp", "alarm", { compatible: true, warnings: [{ code: "ALARM_TRANSLATE", message: "Azure Monitor Alerts → GCP Cloud Monitoring Alerts: metric namespace mapping needed", severity: "medium" }] });
defineRule("gcp", "azure", "alarm", { compatible: true, warnings: [{ code: "ALARM_TRANSLATE", message: "GCP Cloud Monitoring Alerts → Azure Monitor Alerts: metric mapping required", severity: "medium" }] });
defineRule("azure", "gcp", "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_TRANSLATE", message: "Azure Data Factory → GCP Dataflow: ETL script rewrite required", severity: "high" }] });
defineRule("gcp", "azure", "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_TRANSLATE", message: "GCP Dataflow → Azure Data Factory: pipeline translation needed", severity: "high" }] });
defineRule("azure", "gcp", "stream", { compatible: true, warnings: [{ code: "STREAM_MAP", message: "Azure Event Hubs → GCP Pub/Sub: partition-to-subscription mapping differs", severity: "medium" }] });
defineRule("gcp", "azure", "stream", { compatible: true, warnings: [{ code: "STREAM_MAP", message: "GCP Pub/Sub → Azure Event Hubs: subscription-to-partition translation needed", severity: "medium" }] });
defineRule("azure", "gcp", "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ENGINE", message: "Cosmos DB Gremlin API → GCP (JanusGraph on GCE): no native managed graph DB; self-managed required", severity: "high" }] });
defineRule("gcp", "azure", "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ENGINE", message: "GCP JanusGraph → Cosmos DB Gremlin API: managed vs self-managed model differs", severity: "high" }] });
defineRule("azure", "gcp", "data-warehouse", { compatible: true, warnings: [{ code: "DW_TRANSLATE", message: "Azure Synapse → BigQuery: SQL dialect and distribution model differ", severity: "high" }] });
defineRule("gcp", "azure", "data-warehouse", { compatible: true, warnings: [{ code: "DW_TRANSLATE", message: "BigQuery → Azure Synapse: SQL dialect translation needed", severity: "high" }] });
defineRule("azure", "gcp", "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_TRANSLATE", message: "Azure RBAC → GCP IAM: policy model translation required", severity: "medium" }] });
defineRule("gcp", "azure", "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_TRANSLATE", message: "GCP IAM → Azure RBAC: different policy model", severity: "medium" }] });
defineRule("azure", "gcp", "listener-rule", { compatible: true, warnings: [{ code: "LR_TRANSLATE", message: "Azure Front Door Rules → GCP URL Map Rules: condition format differs", severity: "medium" }] });
defineRule("gcp", "azure", "listener-rule", { compatible: true, warnings: [{ code: "LR_TRANSLATE", message: "GCP URL Map → Azure Front Door Rules: rule format translation", severity: "medium" }] });
defineRule("azure", "gcp", "network-acl", { compatible: true, warnings: [{ code: "NACL_FIREWALL", message: "Azure NSGs → GCP Firewall Rules: rule model translation needed", severity: "medium" }] });
defineRule("gcp", "azure", "network-acl", { compatible: true, warnings: [{ code: "NACL_FIREWALL", message: "GCP Firewall Rules → Azure NSGs: rule model translation needed", severity: "medium" }] });

// =============================================================================
// Cloud ↔ On-Premises
// =============================================================================

const ON_PREM_PROVIDERS: MigrationProvider[] = ["on-premises", "vmware", "nutanix"];
const CLOUD_PROVIDERS: MigrationProvider[] = ["aws", "azure", "gcp"];

for (const onPrem of ON_PREM_PROVIDERS) {
  for (const cloud of CLOUD_PROVIDERS) {
    defineRule(onPrem, cloud, "vm", {
      compatible: true,
      warnings: [
        { code: "AGENT_REQUIRED", message: "On-prem migration agent required for VM export", severity: "high" },
        { code: "VM_DRIVER_SWAP", message: `Cloud-specific drivers required for ${cloud}`, severity: "medium" },
      ],
    });

    defineRule(cloud, onPrem, "vm", {
      compatible: true,
      warnings: [
        { code: "HYPERVISOR_TOOLS", message: "Hypervisor-specific tools required for on-prem target", severity: "high" },
      ],
    });

    defineRule(onPrem, cloud, "disk", { compatible: true, warnings: [{ code: "FORMAT_CONVERT", message: "Disk format conversion required", severity: "low" }] });
    defineRule(cloud, onPrem, "disk", { compatible: true, warnings: [{ code: "FORMAT_CONVERT", message: "Disk format conversion required", severity: "low" }] });

    defineRule(onPrem, cloud, "object-storage", {
      compatible: true,
      warnings: [
        { code: "TRANSFER_BANDWIDTH", message: "Transfer speed limited by on-prem network bandwidth", severity: "medium" },
      ],
    });

    defineRule(cloud, onPrem, "object-storage", {
      compatible: true,
      warnings: [
        { code: "TRANSFER_BANDWIDTH", message: "Transfer speed limited by on-prem network bandwidth", severity: "medium" },
        { code: "STORAGE_INFRA", message: "On-prem object storage (MinIO/Ceph) must be pre-provisioned", severity: "high" },
      ],
    });

    defineRule(onPrem, cloud, "database", { compatible: true });
    defineRule(cloud, onPrem, "database", { compatible: true });
    defineRule(onPrem, cloud, "dns", { compatible: true });
    defineRule(cloud, onPrem, "dns", { compatible: true });
    defineRule(onPrem, cloud, "security-rules", {
      compatible: true,
      warnings: [{ code: "RULE_FORMAT", message: "On-prem firewall rules require manual translation review", severity: "high" }],
    });
    defineRule(cloud, onPrem, "security-rules", {
      compatible: true,
      warnings: [{ code: "RULE_FORMAT", message: "Cloud rules need on-prem firewall format translation", severity: "high" }],
    });
    defineRule(onPrem, cloud, "load-balancer", {
      compatible: true,
      warnings: [{ code: "LB_REIMPL", message: "On-prem LB config must be re-implemented in cloud-native LB", severity: "high" }],
    });
    defineRule(cloud, onPrem, "load-balancer", {
      compatible: true,
      warnings: [{ code: "LB_REIMPL", message: "Cloud LB config must be re-implemented for on-prem (HAProxy/Nginx/F5)", severity: "high" }],
    });

    // Enterprise resource types: Cloud ↔ On-Premises
    defineRule(onPrem, cloud, "iam-role", { compatible: true, warnings: [{ code: "IAM_NO_EQUIV", message: "On-prem LDAP/AD groups → cloud IAM roles: manual mapping required", severity: "high" }] });
    defineRule(cloud, onPrem, "iam-role", { compatible: true, warnings: [{ code: "IAM_NO_EQUIV", message: "Cloud IAM → on-prem LDAP/AD: role model incompatible", severity: "high" }] });
    defineRule(onPrem, cloud, "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_MANUAL", message: "On-prem access policies require manual cloud translation", severity: "high" }] });
    defineRule(cloud, onPrem, "iam-policy", { compatible: true, warnings: [{ code: "IAM_POLICY_MANUAL", message: "Cloud IAM policies require manual on-prem translation", severity: "high" }] });
    defineRule(onPrem, cloud, "secret", { compatible: true, warnings: [{ code: "SECRET_STORE", message: "On-prem secrets (Vault/files) → cloud secret store migration", severity: "medium" }] });
    defineRule(cloud, onPrem, "secret", { compatible: true, warnings: [{ code: "SECRET_STORE", message: "Cloud secrets → on-prem Vault/file-based store", severity: "medium" }] });
    defineRule(onPrem, cloud, "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Encryption keys require re-creation", severity: "high" }] });
    defineRule(cloud, onPrem, "kms-key", { compatible: true, warnings: [{ code: "KMS_NO_TRANSFER", message: "Cloud KMS → on-prem HSM/software keys", severity: "high" }] });
    defineRule(onPrem, cloud, "container-service", { compatible: true, warnings: [{ code: "K8S_TRANSLATE", message: "On-prem K8s/Docker → managed K8s: networking and storage differ", severity: "high" }] });
    defineRule(cloud, onPrem, "container-service", { compatible: true, warnings: [{ code: "K8S_TRANSLATE", message: "Managed K8s → on-prem: CSI drivers and ingress need replacement", severity: "high" }] });
    defineRule(onPrem, cloud, "container-registry", { compatible: true });
    defineRule(cloud, onPrem, "container-registry", { compatible: true });
    defineRule(onPrem, cloud, "vpc", { compatible: true, warnings: [{ code: "VLAN_TO_VPC", message: "On-prem VLAN → cloud VPC: different networking model", severity: "high" }] });
    defineRule(cloud, onPrem, "vpc", { compatible: true, warnings: [{ code: "VPC_TO_VLAN", message: "Cloud VPC → on-prem VLAN: manual network config required", severity: "high" }] });
    defineRule(onPrem, cloud, "subnet", { compatible: true });
    defineRule(cloud, onPrem, "subnet", { compatible: true });
    defineRule(onPrem, cloud, "route-table", { compatible: true });
    defineRule(cloud, onPrem, "route-table", { compatible: true });
    defineRule(onPrem, cloud, "queue", { compatible: true, warnings: [{ code: "QUEUE_REIMPL", message: "On-prem message broker → cloud queue: protocol adaptation needed", severity: "medium" }] });
    defineRule(cloud, onPrem, "queue", { compatible: true, warnings: [{ code: "QUEUE_REIMPL", message: "Cloud queue → on-prem RabbitMQ/Kafka: protocol differs", severity: "medium" }] });
    defineRule(onPrem, cloud, "notification-topic", { compatible: true });
    defineRule(cloud, onPrem, "notification-topic", { compatible: true });
    defineRule(onPrem, cloud, "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_REIMPL", message: "On-prem MongoDB/Cassandra → cloud NoSQL: managed features differ", severity: "medium" }] });
    defineRule(cloud, onPrem, "nosql-database", { compatible: true, warnings: [{ code: "NOSQL_REIMPL", message: "Cloud NoSQL → on-prem: self-managed infrastructure required", severity: "medium" }] });
    defineRule(onPrem, cloud, "cache", { compatible: true });
    defineRule(cloud, onPrem, "cache", { compatible: true });
    defineRule(onPrem, cloud, "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_REIMPL", message: "On-prem scaling → cloud ASG: auto-scaling model differs", severity: "medium" }] });
    defineRule(cloud, onPrem, "auto-scaling-group", { compatible: true, warnings: [{ code: "ASG_REIMPL", message: "Cloud ASG → on-prem: manual scaling infrastructure needed", severity: "high" }] });

    // Serverless: limited on-prem support
    defineRule(onPrem, cloud, "lambda-function", { compatible: true, warnings: [{ code: "NO_SERVERLESS_ONPREM", message: "On-prem typically lacks serverless; treated as container migration", severity: "high" }] });
    defineRule(cloud, onPrem, "lambda-function", { compatible: true, warnings: [{ code: "SERVERLESS_TO_CONTAINER", message: "Cloud functions → on-prem: must be containerized (OpenFaaS/Knative)", severity: "high" }] });
    defineRule(onPrem, cloud, "api-gateway", { compatible: true, warnings: [{ code: "APIGW_REIMPL", message: "On-prem reverse proxy → cloud API gateway", severity: "medium" }] });
    defineRule(cloud, onPrem, "api-gateway", { compatible: true, warnings: [{ code: "APIGW_REIMPL", message: "Cloud API Gateway → on-prem reverse proxy (Kong/NGINX)", severity: "medium" }] });

    // CDN/WAF/Certs: limited on-prem
    defineRule(onPrem, cloud, "cdn", { compatible: true, warnings: [{ code: "CDN_CLOUD_ONLY", message: "CDN is cloud-native; on-prem has no equivalent", severity: "medium" }] });
    defineRule(cloud, onPrem, "cdn", { compatible: true, warnings: [{ code: "CDN_NO_ONPREM", message: "Cloud CDN → on-prem: use reverse proxy caching instead", severity: "high" }] });
    defineRule(onPrem, cloud, "certificate", { compatible: true });
    defineRule(cloud, onPrem, "certificate", { compatible: true });
    defineRule(onPrem, cloud, "waf-rule", { compatible: true, warnings: [{ code: "WAF_REIMPL", message: "On-prem WAF → cloud WAF: rule format translation needed", severity: "medium" }] });
    defineRule(cloud, onPrem, "waf-rule", { compatible: true, warnings: [{ code: "WAF_REIMPL", message: "Cloud WAF → on-prem ModSecurity/Nginx: rule format differs", severity: "high" }] });

    // Full-estate enterprise resource types: Cloud ↔ On-Premises
    defineRule(onPrem, cloud, "step-function", { compatible: true, warnings: [{ code: "SF_NO_ONPREM", message: "On-prem has no native step-function equivalent; workflow engines (Airflow/Camunda) differ significantly", severity: "high" }] });
    defineRule(cloud, onPrem, "step-function", { compatible: true, warnings: [{ code: "SF_ONPREM_REIMPL", message: "Cloud step functions → on-prem: re-implement with Airflow/Camunda/Temporal", severity: "high" }] });
    defineRule(onPrem, cloud, "event-bus", { compatible: true, warnings: [{ code: "EB_NO_ONPREM", message: "On-prem event systems (Kafka/RabbitMQ) → cloud event bus: protocol differs", severity: "high" }] });
    defineRule(cloud, onPrem, "event-bus", { compatible: true, warnings: [{ code: "EB_ONPREM_REIMPL", message: "Cloud event bus → on-prem: re-implement with Kafka/RabbitMQ", severity: "high" }] });
    defineRule(onPrem, cloud, "file-system", { compatible: true, warnings: [{ code: "FS_ONPREM", message: "On-prem NFS/CIFS → cloud file system: performance characteristics differ", severity: "high" }] });
    defineRule(cloud, onPrem, "file-system", { compatible: true, warnings: [{ code: "FS_ONPREM", message: "Cloud file system → on-prem NFS/CIFS: provisioning required", severity: "high" }] });
    defineRule(onPrem, cloud, "transit-gateway", { compatible: true, warnings: [{ code: "TGW_NO_ONPREM", message: "On-prem core routers → cloud transit gateway: architecture fundamentally differs", severity: "high" }] });
    defineRule(cloud, onPrem, "transit-gateway", { compatible: true, warnings: [{ code: "TGW_ONPREM_REIMPL", message: "Cloud transit gateway → on-prem: re-implement with physical/virtual routers", severity: "high" }] });
    defineRule(onPrem, cloud, "vpn-connection", { compatible: true, warnings: [{ code: "VPN_ONPREM", message: "On-prem VPN appliance → cloud VPN: tunnel re-configuration required", severity: "high" }] });
    defineRule(cloud, onPrem, "vpn-connection", { compatible: true, warnings: [{ code: "VPN_ONPREM", message: "Cloud VPN → on-prem: VPN appliance configuration needed", severity: "high" }] });
    defineRule(onPrem, cloud, "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_NO_ONPREM", message: "On-prem has no private endpoint equivalent; network reconfiguration needed", severity: "high" }] });
    defineRule(cloud, onPrem, "vpc-endpoint", { compatible: true, warnings: [{ code: "VPCE_ONPREM_REIMPL", message: "Cloud private endpoints → on-prem: use direct network connectivity", severity: "high" }] });
    defineRule(onPrem, cloud, "parameter-store", { compatible: true, warnings: [{ code: "PARAM_NO_ONPREM", message: "On-prem config files/Consul → cloud parameter store: format differs", severity: "high" }] });
    defineRule(cloud, onPrem, "parameter-store", { compatible: true, warnings: [{ code: "PARAM_ONPREM_REIMPL", message: "Cloud parameter store → on-prem: re-implement with Consul/config files", severity: "high" }] });
    defineRule(onPrem, cloud, "iam-user", { compatible: true, warnings: [{ code: "USER_NO_ONPREM", message: "On-prem LDAP/AD users → cloud IAM users: identity model incompatible", severity: "high" }] });
    defineRule(cloud, onPrem, "iam-user", { compatible: true, warnings: [{ code: "USER_ONPREM_REIMPL", message: "Cloud IAM users → on-prem LDAP/AD: manual migration required", severity: "high" }] });
    defineRule(onPrem, cloud, "iam-group", { compatible: true, warnings: [{ code: "GROUP_NO_ONPREM", message: "On-prem LDAP/AD groups → cloud IAM groups: group model differs", severity: "high" }] });
    defineRule(cloud, onPrem, "iam-group", { compatible: true, warnings: [{ code: "GROUP_ONPREM_REIMPL", message: "Cloud IAM groups → on-prem LDAP/AD groups: manual migration required", severity: "high" }] });
    defineRule(onPrem, cloud, "identity-provider", { compatible: true, warnings: [{ code: "IDP_NO_ONPREM", message: "On-prem identity (LDAP/SAML) → cloud IdP: user migration requires password reset", severity: "high" }] });
    defineRule(cloud, onPrem, "identity-provider", { compatible: true, warnings: [{ code: "IDP_ONPREM_REIMPL", message: "Cloud IdP → on-prem: re-implement with LDAP/Keycloak", severity: "high" }] });
    defineRule(onPrem, cloud, "log-group", { compatible: true, warnings: [{ code: "LOG_NO_ONPREM", message: "On-prem logging (ELK/Splunk) → cloud logging: query language differs", severity: "high" }] });
    defineRule(cloud, onPrem, "log-group", { compatible: true, warnings: [{ code: "LOG_ONPREM_REIMPL", message: "Cloud logging → on-prem: re-implement with ELK/Splunk/Graylog", severity: "high" }] });
    defineRule(onPrem, cloud, "alarm", { compatible: true, warnings: [{ code: "ALARM_NO_ONPREM", message: "On-prem monitoring (Nagios/Zabbix) → cloud alarms: metric model differs", severity: "high" }] });
    defineRule(cloud, onPrem, "alarm", { compatible: true, warnings: [{ code: "ALARM_ONPREM_REIMPL", message: "Cloud alarms → on-prem: re-implement with Nagios/Zabbix/Prometheus", severity: "high" }] });
    defineRule(onPrem, cloud, "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_NO_ONPREM", message: "On-prem ETL (Informatica/Talend) → cloud pipeline: script rewrite required", severity: "high" }] });
    defineRule(cloud, onPrem, "data-pipeline", { compatible: true, warnings: [{ code: "PIPE_ONPREM_REIMPL", message: "Cloud pipeline → on-prem: re-implement with Airflow/NiFi/Informatica", severity: "high" }] });
    defineRule(onPrem, cloud, "stream", { compatible: true, warnings: [{ code: "STREAM_NO_ONPREM", message: "On-prem Kafka → cloud streaming: partition model differs", severity: "high" }] });
    defineRule(cloud, onPrem, "stream", { compatible: true, warnings: [{ code: "STREAM_ONPREM_REIMPL", message: "Cloud streaming → on-prem: re-implement with Kafka/Pulsar", severity: "high" }] });
    defineRule(onPrem, cloud, "graph-database", { compatible: true, warnings: [{ code: "GRAPH_NO_ONPREM", message: "On-prem graph DB (Neo4j/JanusGraph) → cloud: managed features differ", severity: "high" }] });
    defineRule(cloud, onPrem, "graph-database", { compatible: true, warnings: [{ code: "GRAPH_ONPREM_REIMPL", message: "Cloud graph DB → on-prem: self-managed Neo4j/JanusGraph required", severity: "high" }] });
    defineRule(onPrem, cloud, "data-warehouse", { compatible: true, warnings: [{ code: "DW_NO_ONPREM", message: "On-prem data warehouse (Teradata/Vertica) → cloud: SQL dialect differs", severity: "high" }] });
    defineRule(cloud, onPrem, "data-warehouse", { compatible: true, warnings: [{ code: "DW_ONPREM_REIMPL", message: "Cloud data warehouse → on-prem: re-implement with Teradata/Vertica/ClickHouse", severity: "high" }] });
    defineRule(onPrem, cloud, "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_NO_ONPREM", message: "On-prem storage ACLs → cloud bucket policies: model incompatible", severity: "high" }] });
    defineRule(cloud, onPrem, "bucket-policy", { compatible: true, warnings: [{ code: "POLICY_ONPREM_REIMPL", message: "Cloud bucket policies → on-prem: re-implement with filesystem ACLs", severity: "high" }] });
    defineRule(onPrem, cloud, "listener-rule", { compatible: true, warnings: [{ code: "LR_NO_ONPREM", message: "On-prem LB rules (HAProxy/Nginx) → cloud listener rules: config format differs", severity: "high" }] });
    defineRule(cloud, onPrem, "listener-rule", { compatible: true, warnings: [{ code: "LR_ONPREM_REIMPL", message: "Cloud listener rules → on-prem: re-implement in HAProxy/Nginx config", severity: "high" }] });
    defineRule(onPrem, cloud, "network-acl", { compatible: true, warnings: [{ code: "NACL_NO_ONPREM", message: "On-prem firewall ACLs → cloud NACLs: rule model differs", severity: "high" }] });
    defineRule(cloud, onPrem, "network-acl", { compatible: true, warnings: [{ code: "NACL_ONPREM_REIMPL", message: "Cloud NACLs → on-prem: re-implement with firewall appliance rules", severity: "high" }] });
  }
}

// On-prem ↔ On-prem (same provider = not a real migration, block it)
for (const a of ON_PREM_PROVIDERS) {
  for (const b of ON_PREM_PROVIDERS) {
    if (a === b) continue;
    const RESOURCE_TYPES: MigrationResourceType[] = [
      "vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer",
      "iam-role", "iam-policy", "secret", "kms-key", "container-service", "container-registry",
      "vpc", "subnet", "route-table", "queue", "notification-topic", "nosql-database", "cache",
      "auto-scaling-group", "lambda-function", "api-gateway", "cdn", "certificate", "waf-rule",
      "step-function", "event-bus", "file-system", "transit-gateway", "vpn-connection",
      "vpc-endpoint", "parameter-store", "iam-user", "iam-group", "identity-provider",
      "log-group", "alarm", "data-pipeline", "stream", "graph-database",
      "data-warehouse", "bucket-policy", "listener-rule", "network-acl",
    ];
    for (const rt of RESOURCE_TYPES) {
      defineRule(a, b, rt, {
        compatible: true,
        warnings: [{ code: "ONPREM_TO_ONPREM", message: `${a} → ${b} migration: verify hypervisor compatibility`, severity: "medium" }],
      });
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check migration compatibility for a specific resource type between two providers.
 */
export function checkCompatibility(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
  resourceType: MigrationResourceType,
): CompatibilityResult {
  if (sourceProvider === targetProvider) {
    return {
      sourceProvider,
      targetProvider,
      resourceType,
      compatible: false,
      warnings: [],
      blockers: [{ code: "SAME_PROVIDER", message: "Source and target are the same provider", reason: "Migration between identical providers is a no-op" }],
      workarounds: [],
    };
  }

  const key = ruleKey(sourceProvider, targetProvider, resourceType);
  const rule = RULES.get(key);

  if (!rule) {
    return {
      sourceProvider,
      targetProvider,
      resourceType,
      compatible: false,
      warnings: [],
      blockers: [{ code: "UNSUPPORTED_PATH", message: `No migration rule defined for ${sourceProvider} → ${targetProvider} (${resourceType})`, reason: "Migration path not yet implemented" }],
      workarounds: [],
    };
  }

  return {
    sourceProvider,
    targetProvider,
    resourceType,
    compatible: rule.compatible,
    warnings: rule.warnings ?? [],
    blockers: rule.blockers ?? [],
    workarounds: rule.workarounds ?? [],
  };
}

/**
 * Check compatibility for all resource types between two providers.
 */
export function checkAllCompatibility(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
): CompatibilityResult[] {
  const resourceTypes: MigrationResourceType[] = [
    "vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer",
    "iam-role", "iam-policy", "secret", "kms-key", "lambda-function", "api-gateway",
    "container-service", "container-registry", "vpc", "subnet", "route-table",
    "queue", "notification-topic", "cdn", "certificate", "waf-rule",
    "nosql-database", "cache", "auto-scaling-group",
    "step-function", "event-bus", "file-system", "transit-gateway", "vpn-connection",
    "vpc-endpoint", "parameter-store", "iam-user", "iam-group", "identity-provider",
    "log-group", "alarm", "data-pipeline", "stream", "graph-database",
    "data-warehouse", "bucket-policy", "listener-rule", "network-acl",
  ];
  return resourceTypes.map((rt) => checkCompatibility(sourceProvider, targetProvider, rt));
}

/**
 * Get the full compatibility matrix for all provider pairs.
 */
export function getFullCompatibilityMatrix(): CompatibilityResult[] {
  const providers: MigrationProvider[] = ["aws", "azure", "gcp", "on-premises", "vmware", "nutanix"];
  const results: CompatibilityResult[] = [];

  for (const source of providers) {
    for (const target of providers) {
      if (source === target) continue;
      results.push(...checkAllCompatibility(source, target));
    }
  }

  return results;
}

/**
 * Get summary of compatibility for a migration direction.
 */
export function getCompatibilitySummary(
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
): {
  direction: string;
  allCompatible: boolean;
  totalWarnings: number;
  totalBlockers: number;
  results: CompatibilityResult[];
} {
  const results = checkAllCompatibility(sourceProvider, targetProvider);
  return {
    direction: `${sourceProvider} → ${targetProvider}`,
    allCompatible: results.every((r) => r.compatible),
    totalWarnings: results.reduce((sum, r) => sum + r.warnings.length, 0),
    totalBlockers: results.reduce((sum, r) => sum + r.blockers.length, 0),
    results,
  };
}
