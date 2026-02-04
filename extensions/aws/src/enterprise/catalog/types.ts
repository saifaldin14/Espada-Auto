/**
 * Service Catalog Types
 *
 * Type definitions for pre-approved infrastructure modules, request/approval
 * workflows, quota management, and chargeback/showback functionality.
 */

// =============================================================================
// Catalog Module Types
// =============================================================================

export type ModuleCategory =
  | 'compute'
  | 'database'
  | 'storage'
  | 'networking'
  | 'security'
  | 'monitoring'
  | 'analytics'
  | 'ai_ml'
  | 'container'
  | 'serverless'
  | 'integration'
  | 'other';

export type ModuleCompliance =
  | 'hipaa'
  | 'pci_dss'
  | 'soc2'
  | 'gdpr'
  | 'fedramp'
  | 'iso27001';

export interface ModuleParameter {
  /** Parameter name */
  name: string;
  /** Display label */
  label: string;
  /** Description */
  description?: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multi-select' | 'secret';
  /** Required */
  required: boolean;
  /** Default value */
  default?: string | number | boolean;
  /** Allowed values (for select types) */
  options?: Array<{ value: string; label: string }>;
  /** Validation regex (for string types) */
  validation?: string;
  /** Min/max (for number types) */
  min?: number;
  max?: number;
  /** Sensitive (mask in UI) */
  sensitive?: boolean;
}

export interface ModuleOutput {
  /** Output name */
  name: string;
  /** Description */
  description?: string;
  /** Output type */
  type: 'string' | 'number' | 'list' | 'map';
  /** Sensitive */
  sensitive?: boolean;
}

export interface CatalogModule {
  /** Module ID */
  id: string;
  /** Tenant ID (null for global modules) */
  tenantId?: string;
  /** Module name */
  name: string;
  /** Description */
  description: string;
  /** Version */
  version: string;
  /** Category */
  category: ModuleCategory;
  /** Tags */
  tags: string[];
  /** Cloud provider */
  provider: 'aws' | 'azure' | 'gcp' | 'multi-cloud';
  /** Module source (Terraform registry, Git, etc.) */
  source: {
    type: 'registry' | 'git' | 'local' | 's3';
    url: string;
    ref?: string;
  };
  /** Input parameters */
  parameters: ModuleParameter[];
  /** Outputs */
  outputs: ModuleOutput[];
  /** Compliance certifications */
  compliance: ModuleCompliance[];
  /** Estimated monthly cost range */
  estimatedCost?: {
    minCents: number;
    maxCents: number;
    currency: string;
  };
  /** Deployment time estimate (minutes) */
  estimatedDeploymentMinutes?: number;
  /** Required approvals */
  requiredApprovals?: {
    roles: string[];
    minApprovers: number;
  };
  /** Restrictions */
  restrictions?: {
    /** Allowed environments */
    allowedEnvironments?: string[];
    /** Allowed regions */
    allowedRegions?: string[];
    /** Max instances per tenant */
    maxInstancesPerTenant?: number;
    /** Requires VPN */
    requiresVpn?: boolean;
  };
  /** Documentation URL */
  documentationUrl?: string;
  /** Support contact */
  supportContact?: string;
  /** Status */
  status: 'draft' | 'active' | 'deprecated' | 'archived';
  /** Owner user ID */
  ownerId: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

// =============================================================================
// Request/Approval Types
// =============================================================================

export type RequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'provisioning'
  | 'provisioned'
  | 'failed'
  | 'decommissioning'
  | 'decommissioned';

export type ApprovalDecision = 'approved' | 'rejected' | 'needs_info';

export interface ProvisioningRequest {
  /** Request ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Requester user ID */
  requesterId: string;
  /** Requester email */
  requesterEmail: string;
  /** Module ID */
  moduleId: string;
  /** Module name (denormalized) */
  moduleName: string;
  /** Module version */
  moduleVersion: string;
  /** Request name/title */
  name: string;
  /** Description */
  description?: string;
  /** Target environment */
  environment: string;
  /** Target region */
  region?: string;
  /** Parameter values */
  parameters: Record<string, unknown>;
  /** Cost center */
  costCenter: string;
  /** Project/team code */
  projectCode?: string;
  /** Status */
  status: RequestStatus;
  /** Priority */
  priority: 'low' | 'normal' | 'high' | 'urgent';
  /** Requested completion date */
  requestedBy?: string;
  /** Approvals */
  approvals: ApprovalRecord[];
  /** Required approval count */
  requiredApprovals: number;
  /** Provisioning details */
  provisioning?: {
    startedAt?: string;
    completedAt?: string;
    deploymentId?: string;
    outputs?: Record<string, unknown>;
    errorMessage?: string;
  };
  /** Tags */
  tags?: Record<string, string>;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface ApprovalRecord {
  /** Approver user ID */
  approverId: string;
  /** Approver email */
  approverEmail: string;
  /** Approver role */
  approverRole: string;
  /** Decision */
  decision: ApprovalDecision;
  /** Comments */
  comments?: string;
  /** Decision timestamp */
  decidedAt: string;
}

export interface ApprovalPolicy {
  /** Policy ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Policy name */
  name: string;
  /** Description */
  description?: string;
  /** Conditions that trigger this policy */
  conditions: {
    /** Module categories */
    categories?: ModuleCategory[];
    /** Module IDs */
    moduleIds?: string[];
    /** Environments */
    environments?: string[];
    /** Cost threshold (cents) */
    costThresholdCents?: number;
    /** Compliance requirements */
    compliance?: ModuleCompliance[];
  };
  /** Required approvers */
  approvers: {
    /** Roles that can approve */
    roles: string[];
    /** Specific user IDs */
    userIds?: string[];
    /** Minimum number of approvals */
    minApprovals: number;
    /** Require all listed approvers */
    requireAll?: boolean;
  };
  /** Auto-approval rules */
  autoApproval?: {
    /** Environments that allow auto-approval */
    environments?: string[];
    /** Max cost for auto-approval (cents) */
    maxCostCents?: number;
    /** Trusted requester roles */
    trustedRoles?: string[];
  };
  /** Escalation */
  escalation?: {
    /** Hours before escalation */
    afterHours: number;
    /** Escalation targets */
    escalateTo: string[];
  };
  /** Priority */
  priority: number;
  /** Active */
  active: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

// =============================================================================
// Quota Types
// =============================================================================

export type QuotaResource =
  | 'module_instances'
  | 'compute_vcpu'
  | 'compute_memory_gb'
  | 'storage_gb'
  | 'database_instances'
  | 'network_load_balancers'
  | 'api_requests'
  | 'deployments_per_month'
  | 'monthly_spend_cents'
  | 'custom';

export interface QuotaLimit {
  /** Quota ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Team/project ID (optional, for team-level quotas) */
  teamId?: string;
  /** Resource type */
  resource: QuotaResource;
  /** Custom resource name (if resource is 'custom') */
  customResourceName?: string;
  /** Limit value */
  limit: number;
  /** Current usage */
  currentUsage: number;
  /** Unit */
  unit: string;
  /** Period (for rate limits) */
  period?: 'hour' | 'day' | 'week' | 'month';
  /** Alert threshold (percentage) */
  alertThreshold?: number;
  /** Enforcement */
  enforcement: 'soft' | 'hard';
  /** Override allowed */
  overrideAllowed: boolean;
  /** Notes */
  notes?: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface QuotaUsageRecord {
  /** Record ID */
  id: string;
  /** Quota ID */
  quotaId: string;
  /** Change amount (positive or negative) */
  change: number;
  /** Previous value */
  previousValue: number;
  /** New value */
  newValue: number;
  /** Reason */
  reason: string;
  /** Related entity (request ID, deployment ID, etc.) */
  relatedEntityId?: string;
  /** User who caused the change */
  userId?: string;
  /** Timestamp */
  timestamp: string;
}

export interface QuotaAlert {
  /** Alert ID */
  id: string;
  /** Quota ID */
  quotaId: string;
  /** Tenant ID */
  tenantId: string;
  /** Team ID */
  teamId?: string;
  /** Resource */
  resource: QuotaResource;
  /** Threshold percentage reached */
  thresholdPercent: number;
  /** Current usage */
  currentUsage: number;
  /** Limit */
  limit: number;
  /** Acknowledged */
  acknowledged: boolean;
  /** Created timestamp */
  createdAt: string;
}

// =============================================================================
// Chargeback/Showback Types
// =============================================================================

export interface CostAllocation {
  /** Allocation ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Cost center */
  costCenter: string;
  /** Project code */
  projectCode?: string;
  /** Team ID */
  teamId?: string;
  /** Billing period (YYYY-MM) */
  billingPeriod: string;
  /** Resource costs */
  resourceCosts: Array<{
    resourceType: string;
    resourceId: string;
    resourceName: string;
    moduleId?: string;
    environment: string;
    region?: string;
    usageQuantity: number;
    usageUnit: string;
    costCents: number;
    tags?: Record<string, string>;
  }>;
  /** Total cost (cents) */
  totalCostCents: number;
  /** Currency */
  currency: string;
  /** Adjustments */
  adjustments?: Array<{
    type: 'discount' | 'credit' | 'surcharge' | 'support';
    description: string;
    amountCents: number;
  }>;
  /** Final amount (cents) */
  finalAmountCents: number;
  /** Status */
  status: 'draft' | 'pending_review' | 'approved' | 'invoiced' | 'paid';
  /** Approved by */
  approvedBy?: string;
  /** Approved at */
  approvedAt?: string;
  /** Notes */
  notes?: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface CostCenterConfig {
  /** Cost center code */
  code: string;
  /** Tenant ID */
  tenantId: string;
  /** Name */
  name: string;
  /** Description */
  description?: string;
  /** Parent cost center */
  parentCode?: string;
  /** Owner user ID */
  ownerId: string;
  /** Owner email */
  ownerEmail: string;
  /** Budget (cents per month) */
  monthlyBudgetCents?: number;
  /** Alert threshold (percentage) */
  budgetAlertThreshold?: number;
  /** Billing contact email */
  billingContactEmail?: string;
  /** GL account code */
  glAccountCode?: string;
  /** Active */
  active: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface ShowbackReport {
  /** Report ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Report name */
  name: string;
  /** Billing period start */
  periodStart: string;
  /** Billing period end */
  periodEnd: string;
  /** Generated at */
  generatedAt: string;
  /** Report type */
  type: 'summary' | 'detailed' | 'by_cost_center' | 'by_team' | 'by_environment' | 'by_module';
  /** Summary metrics */
  summary: {
    totalCostCents: number;
    costCentersCount: number;
    teamsCount: number;
    resourcesCount: number;
    topCostDriver: string;
    costChange: {
      absoluteCents: number;
      percentChange: number;
      comparedTo: string;
    };
  };
  /** Breakdown by dimension */
  breakdown: Array<{
    dimension: string;
    dimensionValue: string;
    costCents: number;
    percentOfTotal: number;
    resourceCount: number;
  }>;
  /** Top resources by cost */
  topResources: Array<{
    resourceId: string;
    resourceName: string;
    resourceType: string;
    costCents: number;
    costCenter: string;
  }>;
  /** Recommendations */
  recommendations?: Array<{
    type: 'optimization' | 'rightsizing' | 'unused' | 'reserved_instance';
    description: string;
    potentialSavingsCents: number;
    resourceIds: string[];
  }>;
}

// =============================================================================
// Result Types
// =============================================================================

export interface CatalogResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
