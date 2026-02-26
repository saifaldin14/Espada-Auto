/**
 * Azure Enterprise - Multi-tenancy, Billing, Auth, Collaboration, and GitOps types
 *
 * Extended enterprise types for feature parity with AWS extension.
 */

// =============================================================================
// Multi-tenancy
// =============================================================================

export interface TenantConfiguration {
  tenantId: string;
  displayName: string;
  isolationLevel: "full" | "shared" | "hybrid";
  subscriptions: string[];
  managementGroupId?: string;
  policies: TenantPolicy[];
  quotas: TenantQuota[];
  createdAt: string;
}

export interface TenantPolicy {
  id: string;
  name: string;
  scope: string;
  enforcementMode: "enabled" | "disabled" | "audit";
  policyDefinitionId: string;
  parameters?: Record<string, unknown>;
}

export interface TenantQuota {
  resourceType: string;
  limit: number;
  currentUsage: number;
  unit: string;
}

export interface TenantSwitchResult {
  previousTenantId: string;
  activeTenantId: string;
  subscriptions: Array<{ id: string; name: string; state: string }>;
  switchedAt: string;
}

// =============================================================================
// Billing & Metering
// =============================================================================

export interface BillingAccount {
  id: string;
  name: string;
  displayName: string;
  accountType: "Enterprise" | "Individual" | "Partner";
  billingProfiles: BillingProfile[];
  agreementType: string;
}

export interface BillingProfile {
  id: string;
  name: string;
  displayName: string;
  currency: string;
  invoiceSections: InvoiceSection[];
  spendingLimit: number | null;
}

export interface InvoiceSection {
  id: string;
  name: string;
  displayName: string;
}

export interface UsageRecord {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  subscriptionId: string;
  resourceGroup: string;
  meterCategory: string;
  meterSubCategory: string;
  quantity: number;
  unit: string;
  costUsd: number;
  date: string;
}

export interface BudgetConfig {
  name: string;
  amount: number;
  timeGrain: "Monthly" | "Quarterly" | "Annually";
  startDate: string;
  endDate?: string;
  notifications: BudgetNotification[];
}

export interface BudgetNotification {
  threshold: number;
  operator: "GreaterThan" | "GreaterThanOrEqualTo";
  contactEmails: string[];
  enabled: boolean;
}

export interface CostForecast {
  subscriptionId: string;
  currentMonthSpend: number;
  forecastedMonthEnd: number;
  currency: string;
  confidence: number;
  forecastedAt: string;
}

// =============================================================================
// Enterprise Auth (SAML / OIDC / SCIM)
// =============================================================================

export type AuthProtocol = "saml" | "oidc" | "scim";

export interface SamlConfiguration {
  entityId: string;
  signOnUrl: string;
  logoutUrl?: string;
  certificate: string;
  nameIdFormat: string;
  attributeMappings: Record<string, string>;
  enabled: boolean;
}

export interface OidcConfiguration {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  redirectUri: string;
  responseType: string;
  enabled: boolean;
}

export interface ScimConfiguration {
  endpoint: string;
  token: string;
  syncInterval: number;
  provisioningMode: "push" | "pull" | "bidirectional";
  userMappings: Record<string, string>;
  groupMappings: Record<string, string>;
  enabled: boolean;
}

export interface AuthConfiguration {
  saml?: SamlConfiguration;
  oidc?: OidcConfiguration;
  scim?: ScimConfiguration;
  mfa: { enabled: boolean; methods: string[] };
  conditionalAccess: ConditionalAccessPolicy[];
}

export interface ConditionalAccessPolicy {
  id: string;
  name: string;
  state: "enabled" | "disabled" | "report-only";
  conditions: {
    userGroups?: string[];
    applications?: string[];
    locations?: string[];
    platforms?: string[];
  };
  grantControls: string[];
}

// =============================================================================
// Collaboration
// =============================================================================

export interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: WorkspaceMember[];
  subscriptions: string[];
  resourceGroups: string[];
  tags: Record<string, string>;
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: "owner" | "admin" | "contributor" | "reader";
  addedAt: string;
}

export interface ApprovalFlow {
  id: string;
  name: string;
  resourceScope: string;
  stages: ApprovalStage[];
  enabled: boolean;
}

export interface ApprovalStage {
  order: number;
  approvers: string[];
  requiredApprovals: number;
  autoApproveAfterHours?: number;
}

export interface ApprovalRequest {
  id: string;
  flowId: string;
  requesterId: string;
  action: string;
  resourceId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  currentStage: number;
  approvals: Array<{ approverId: string; decision: "approved" | "rejected"; comment?: string; decidedAt: string; stage: number }>;
  createdAt: string;
}

export interface CollaborationComment {
  id: string;
  resourceId: string;
  authorId: string;
  content: string;
  parentId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Notification {
  id: string;
  recipientId: string;
  type: "approval" | "alert" | "comment" | "drift" | "cost" | "security";
  title: string;
  message: string;
  resourceId?: string;
  read: boolean;
  createdAt: string;
}

// =============================================================================
// GitOps
// =============================================================================

export interface GitOpsConfiguration {
  repositoryUrl: string;
  branch: string;
  path: string;
  syncInterval: number;
  autoSync: boolean;
  prune: boolean;
  selfHeal: boolean;
  sourceType: "git" | "helm";
  credentials?: {
    type: "ssh" | "https" | "token";
    secret: string;
  };
}

export interface GitOpsSync {
  id: string;
  status: "synced" | "out-of-sync" | "progressing" | "failed" | "unknown";
  revision: string;
  message: string;
  resources: GitOpsSyncResource[];
  startedAt: string;
  completedAt?: string;
}

export interface GitOpsSyncResource {
  kind: string;
  name: string;
  namespace?: string;
  status: "synced" | "out-of-sync" | "missing" | "orphaned";
  message?: string;
}

export interface GitOpsHistory {
  revision: string;
  author: string;
  message: string;
  deployedAt: string;
  resources: number;
  status: string;
}
