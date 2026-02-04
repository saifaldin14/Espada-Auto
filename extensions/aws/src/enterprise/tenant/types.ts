/**
 * Multi-Tenancy Types
 * 
 * Core type definitions for the multi-tenant SaaS architecture.
 * Supports tenant isolation, subscription management, and resource quotas.
 */

// =============================================================================
// Tenant Core Types
// =============================================================================

export type TenantStatus = 
  | 'active'
  | 'trial'
  | 'suspended'
  | 'pending'
  | 'cancelled'
  | 'deleted';

export type TenantTier = 
  | 'free'
  | 'starter'
  | 'team'
  | 'business'
  | 'enterprise';

export type IsolationLevel = 
  | 'shared'      // Shared infrastructure, logical isolation
  | 'dedicated'   // Dedicated DynamoDB tables
  | 'isolated'    // Separate AWS account
  | 'airgapped';  // Completely isolated environment

export interface Tenant {
  /** Unique tenant identifier */
  id: string;
  /** Human-readable tenant name */
  name: string;
  /** URL-safe slug for tenant */
  slug: string;
  /** Tenant status */
  status: TenantStatus;
  /** Subscription tier */
  tier: TenantTier;
  /** Isolation level */
  isolationLevel: IsolationLevel;
  /** Primary contact email */
  email: string;
  /** Company/organization name */
  organization?: string;
  /** Domain for email verification */
  domain?: string;
  /** Allowed email domains for auto-join */
  allowedDomains?: string[];
  /** AWS account ID (for isolated tenants) */
  awsAccountId?: string;
  /** Primary AWS region */
  primaryRegion: string;
  /** Additional regions enabled */
  enabledRegions: string[];
  /** Resource quotas */
  quotas: TenantQuotas;
  /** Feature flags */
  features: TenantFeatures;
  /** Custom configuration */
  config: TenantConfig;
  /** Billing information */
  billing: TenantBilling;
  /** Metadata */
  metadata: TenantMetadata;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Deletion timestamp (soft delete) */
  deletedAt?: string;
}

export interface TenantQuotas {
  /** Maximum users */
  maxUsers: number;
  /** Maximum concurrent deployments */
  maxConcurrentDeployments: number;
  /** Maximum deployments per month */
  maxDeploymentsPerMonth: number;
  /** Maximum resources per deployment */
  maxResourcesPerDeployment: number;
  /** Maximum templates */
  maxTemplates: number;
  /** Maximum projects/workspaces */
  maxProjects: number;
  /** Storage quota in GB */
  storageGb: number;
  /** API requests per minute */
  apiRateLimit: number;
  /** Retention period in days */
  auditLogRetentionDays: number;
  /** Custom quotas */
  custom?: Record<string, number>;
}

export interface TenantFeatures {
  /** SSO enabled */
  sso: boolean;
  /** SCIM provisioning enabled */
  scim: boolean;
  /** Custom branding */
  customBranding: boolean;
  /** Advanced analytics */
  advancedAnalytics: boolean;
  /** Multi-region deployments */
  multiRegion: boolean;
  /** Disaster recovery */
  disasterRecovery: boolean;
  /** Compliance reporting */
  complianceReporting: boolean;
  /** API access */
  apiAccess: boolean;
  /** Webhooks */
  webhooks: boolean;
  /** Audit log export */
  auditLogExport: boolean;
  /** Priority support */
  prioritySupport: boolean;
  /** Dedicated support */
  dedicatedSupport: boolean;
  /** Custom integrations */
  customIntegrations: boolean;
  /** GitOps integration */
  gitOps: boolean;
  /** Terraform import */
  terraformImport: boolean;
  /** Custom policies */
  customPolicies: boolean;
}

export interface TenantConfig {
  /** Default deployment region */
  defaultRegion: string;
  /** Default environment */
  defaultEnvironment: 'development' | 'staging' | 'production';
  /** Required tags for all resources */
  requiredTags: string[];
  /** Default tags applied to all resources */
  defaultTags: Record<string, string>;
  /** Allowed compliance frameworks */
  allowedComplianceFrameworks: string[];
  /** Cost alert threshold (percentage) */
  costAlertThreshold: number;
  /** Auto-remediation enabled */
  autoRemediationEnabled: boolean;
  /** Approval requirements */
  approvalRequirements: {
    production: boolean;
    costAbove: number;
    highRisk: boolean;
  };
  /** Session timeout in minutes */
  sessionTimeoutMinutes: number;
  /** MFA requirement */
  mfaRequired: boolean;
  /** IP allowlist */
  ipAllowlist?: string[];
  /** Custom domain for tenant */
  customDomain?: string;
  /** Webhook endpoints */
  webhookEndpoints?: WebhookEndpoint[];
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  createdAt: string;
}

export interface TenantBilling {
  /** Stripe customer ID */
  stripeCustomerId?: string;
  /** Stripe subscription ID */
  stripeSubscriptionId?: string;
  /** AWS Marketplace customer ID */
  awsMarketplaceCustomerId?: string;
  /** Billing email */
  billingEmail: string;
  /** Billing address */
  billingAddress?: BillingAddress;
  /** Payment method on file */
  hasPaymentMethod: boolean;
  /** Current billing period start */
  currentPeriodStart?: string;
  /** Current billing period end */
  currentPeriodEnd?: string;
  /** Trial end date */
  trialEndDate?: string;
  /** Monthly spend limit */
  monthlySpendLimit?: number;
  /** Currency */
  currency: string;
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface TenantMetadata {
  /** Source of tenant creation */
  source: 'signup' | 'invitation' | 'api' | 'marketplace' | 'migration';
  /** Referral code used */
  referralCode?: string;
  /** Marketing campaign */
  campaign?: string;
  /** Industry vertical */
  industry?: string;
  /** Company size */
  companySize?: 'startup' | 'small' | 'medium' | 'large' | 'enterprise';
  /** Use case */
  useCase?: string;
  /** Custom attributes */
  customAttributes?: Record<string, string>;
}

// =============================================================================
// Tenant Member Types
// =============================================================================

export type MemberRole = 
  | 'owner'
  | 'admin'
  | 'member'
  | 'viewer'
  | 'billing';

export interface TenantMember {
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Email */
  email: string;
  /** Display name */
  name: string;
  /** Role in tenant */
  role: MemberRole;
  /** Custom permissions */
  permissions?: string[];
  /** Teams/groups membership */
  teams?: string[];
  /** Invitation status */
  status: 'pending' | 'active' | 'suspended' | 'removed';
  /** Invited by user ID */
  invitedBy?: string;
  /** Invitation timestamp */
  invitedAt?: string;
  /** Join timestamp */
  joinedAt?: string;
  /** Last active timestamp */
  lastActiveAt?: string;
  /** MFA enabled */
  mfaEnabled: boolean;
  /** SSO linked */
  ssoLinked: boolean;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface TenantInvitation {
  /** Invitation ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Email to invite */
  email: string;
  /** Role to assign */
  role: MemberRole;
  /** Teams to add to */
  teams?: string[];
  /** Invitation token (hashed) */
  tokenHash: string;
  /** Invited by user ID */
  invitedBy: string;
  /** Expiration timestamp */
  expiresAt: string;
  /** Creation timestamp */
  createdAt: string;
  /** Accepted timestamp */
  acceptedAt?: string;
  /** Status */
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

// =============================================================================
// Team/Project Types
// =============================================================================

export interface TenantTeam {
  /** Team ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Team name */
  name: string;
  /** Description */
  description?: string;
  /** Team members (user IDs) */
  members: string[];
  /** Team leads (user IDs) */
  leads: string[];
  /** Allowed environments */
  allowedEnvironments: string[];
  /** Resource quota overrides */
  quotaOverrides?: Partial<TenantQuotas>;
  /** Cost center for billing */
  costCenter?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

export interface TenantProject {
  /** Project ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Project name */
  name: string;
  /** Description */
  description?: string;
  /** Owning team ID */
  teamId?: string;
  /** Project environment */
  environment: 'development' | 'staging' | 'production';
  /** AWS region */
  region: string;
  /** Project tags */
  tags: Record<string, string>;
  /** Active deployment count */
  activeDeployments: number;
  /** Total resource count */
  resourceCount: number;
  /** Monthly cost estimate */
  monthlyCostEstimate: number;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

// =============================================================================
// Usage & Metering Types
// =============================================================================

export interface UsageRecord {
  /** Record ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** User ID (if applicable) */
  userId?: string;
  /** Project ID (if applicable) */
  projectId?: string;
  /** Usage type */
  type: UsageType;
  /** Quantity */
  quantity: number;
  /** Unit */
  unit: string;
  /** Timestamp */
  timestamp: string;
  /** Billing period */
  billingPeriod: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export type UsageType = 
  | 'deployment'
  | 'api_request'
  | 'resource_hour'
  | 'storage_gb'
  | 'data_transfer_gb'
  | 'user_seat'
  | 'sso_authentication'
  | 'webhook_delivery'
  | 'audit_log_storage'
  | 'support_ticket';

export interface UsageSummary {
  /** Tenant ID */
  tenantId: string;
  /** Billing period (YYYY-MM) */
  billingPeriod: string;
  /** Usage by type */
  usage: Record<UsageType, number>;
  /** Cost by type */
  costs: Record<UsageType, number>;
  /** Total cost */
  totalCost: number;
  /** Quota usage percentages */
  quotaUsage: Record<string, number>;
  /** Generated timestamp */
  generatedAt: string;
}

// =============================================================================
// Audit Types
// =============================================================================

export interface TenantAuditLog {
  /** Log ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** User ID */
  userId: string;
  /** User email */
  userEmail: string;
  /** Action */
  action: string;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId?: string;
  /** Request details */
  request?: {
    method: string;
    path: string;
    ip: string;
    userAgent: string;
  };
  /** Changes made */
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  /** Result */
  result: 'success' | 'failure' | 'denied';
  /** Error message (if failed) */
  errorMessage?: string;
  /** Timestamp */
  timestamp: string;
  /** Expiration (TTL) */
  expiresAt?: string;
}

// =============================================================================
// Event Types
// =============================================================================

export type TenantEventType = 
  | 'tenant.created'
  | 'tenant.updated'
  | 'tenant.suspended'
  | 'tenant.reactivated'
  | 'tenant.deleted'
  | 'member.invited'
  | 'member.joined'
  | 'member.removed'
  | 'member.role_changed'
  | 'team.created'
  | 'team.updated'
  | 'team.deleted'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'quota.exceeded'
  | 'quota.warning'
  | 'billing.payment_succeeded'
  | 'billing.payment_failed'
  | 'security.login'
  | 'security.logout'
  | 'security.mfa_enabled'
  | 'security.password_changed'
  | 'security.suspicious_activity';

export interface TenantEvent {
  /** Event ID */
  id: string;
  /** Event type */
  type: TenantEventType;
  /** Tenant ID */
  tenantId: string;
  /** User ID (if applicable) */
  userId?: string;
  /** Event data */
  data: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
  /** Processing status */
  processed: boolean;
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface TenantServiceConfig {
  /** DynamoDB table prefix */
  tablePrefix: string;
  /** AWS region */
  region: string;
  /** Enable caching */
  enableCaching: boolean;
  /** Cache TTL in seconds */
  cacheTtlSeconds: number;
  /** Event bus name */
  eventBusName?: string;
  /** SNS topic for notifications */
  notificationTopicArn?: string;
  /** Encryption key ARN */
  encryptionKeyArn?: string;
  /** Stripe API key */
  stripeApiKey?: string;
  /** Stripe webhook secret */
  stripeWebhookSecret?: string;
  /** AWS Marketplace product code */
  awsMarketplaceProductCode?: string;
}

// =============================================================================
// Tier Definitions
// =============================================================================

export const TIER_QUOTAS: Record<TenantTier, TenantQuotas> = {
  free: {
    maxUsers: 1,
    maxConcurrentDeployments: 1,
    maxDeploymentsPerMonth: 5,
    maxResourcesPerDeployment: 10,
    maxTemplates: 3,
    maxProjects: 1,
    storageGb: 1,
    apiRateLimit: 10,
    auditLogRetentionDays: 7,
  },
  starter: {
    maxUsers: 5,
    maxConcurrentDeployments: 2,
    maxDeploymentsPerMonth: 50,
    maxResourcesPerDeployment: 25,
    maxTemplates: 10,
    maxProjects: 3,
    storageGb: 10,
    apiRateLimit: 60,
    auditLogRetentionDays: 30,
  },
  team: {
    maxUsers: 25,
    maxConcurrentDeployments: 5,
    maxDeploymentsPerMonth: 200,
    maxResourcesPerDeployment: 50,
    maxTemplates: 50,
    maxProjects: 10,
    storageGb: 50,
    apiRateLimit: 120,
    auditLogRetentionDays: 90,
  },
  business: {
    maxUsers: 100,
    maxConcurrentDeployments: 10,
    maxDeploymentsPerMonth: 1000,
    maxResourcesPerDeployment: 100,
    maxTemplates: 200,
    maxProjects: 50,
    storageGb: 200,
    apiRateLimit: 300,
    auditLogRetentionDays: 365,
  },
  enterprise: {
    maxUsers: -1, // Unlimited
    maxConcurrentDeployments: -1,
    maxDeploymentsPerMonth: -1,
    maxResourcesPerDeployment: -1,
    maxTemplates: -1,
    maxProjects: -1,
    storageGb: -1,
    apiRateLimit: 1000,
    auditLogRetentionDays: 730,
  },
};

export const TIER_FEATURES: Record<TenantTier, TenantFeatures> = {
  free: {
    sso: false,
    scim: false,
    customBranding: false,
    advancedAnalytics: false,
    multiRegion: false,
    disasterRecovery: false,
    complianceReporting: false,
    apiAccess: false,
    webhooks: false,
    auditLogExport: false,
    prioritySupport: false,
    dedicatedSupport: false,
    customIntegrations: false,
    gitOps: false,
    terraformImport: false,
    customPolicies: false,
  },
  starter: {
    sso: false,
    scim: false,
    customBranding: false,
    advancedAnalytics: false,
    multiRegion: false,
    disasterRecovery: false,
    complianceReporting: false,
    apiAccess: true,
    webhooks: true,
    auditLogExport: false,
    prioritySupport: false,
    dedicatedSupport: false,
    customIntegrations: false,
    gitOps: false,
    terraformImport: true,
    customPolicies: false,
  },
  team: {
    sso: false,
    scim: false,
    customBranding: false,
    advancedAnalytics: true,
    multiRegion: true,
    disasterRecovery: false,
    complianceReporting: false,
    apiAccess: true,
    webhooks: true,
    auditLogExport: true,
    prioritySupport: true,
    dedicatedSupport: false,
    customIntegrations: false,
    gitOps: true,
    terraformImport: true,
    customPolicies: false,
  },
  business: {
    sso: true,
    scim: true,
    customBranding: true,
    advancedAnalytics: true,
    multiRegion: true,
    disasterRecovery: true,
    complianceReporting: true,
    apiAccess: true,
    webhooks: true,
    auditLogExport: true,
    prioritySupport: true,
    dedicatedSupport: false,
    customIntegrations: true,
    gitOps: true,
    terraformImport: true,
    customPolicies: true,
  },
  enterprise: {
    sso: true,
    scim: true,
    customBranding: true,
    advancedAnalytics: true,
    multiRegion: true,
    disasterRecovery: true,
    complianceReporting: true,
    apiAccess: true,
    webhooks: true,
    auditLogExport: true,
    prioritySupport: true,
    dedicatedSupport: true,
    customIntegrations: true,
    gitOps: true,
    terraformImport: true,
    customPolicies: true,
  },
};
