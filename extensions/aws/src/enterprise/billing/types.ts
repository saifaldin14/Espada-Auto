/**
 * Billing & Metering Types
 * 
 * Type definitions for usage metering, billing integration,
 * and subscription management.
 */

// =============================================================================
// Usage Metering Types
// =============================================================================

export type UsageMetricType =
  | 'deployment'
  | 'deployment_minute'
  | 'api_request'
  | 'resource_provisioned'
  | 'resource_hour'
  | 'storage_gb_hour'
  | 'data_transfer_gb'
  | 'user_seat'
  | 'active_user'
  | 'sso_authentication'
  | 'scim_sync'
  | 'webhook_delivery'
  | 'audit_log_storage_gb'
  | 'support_ticket'
  | 'custom';

export interface UsageMetric {
  /** Metric type */
  type: UsageMetricType;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Unit of measurement */
  unit: string;
  /** Unit price (cents) */
  unitPriceCents: number;
  /** Free tier included */
  freeTierIncluded: number;
  /** Aggregation method */
  aggregation: 'sum' | 'max' | 'avg' | 'last';
  /** Billing interval */
  billingInterval: 'hourly' | 'daily' | 'monthly';
}

export interface MeteringRecord {
  /** Record ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Metric type */
  metricType: UsageMetricType;
  /** Quantity */
  quantity: number;
  /** Timestamp */
  timestamp: string;
  /** Idempotency key */
  idempotencyKey?: string;
  /** Metadata */
  metadata?: {
    userId?: string;
    projectId?: string;
    resourceId?: string;
    region?: string;
    [key: string]: unknown;
  };
}

export interface AggregatedUsage {
  /** Tenant ID */
  tenantId: string;
  /** Billing period (YYYY-MM) */
  billingPeriod: string;
  /** Usage by metric type */
  metrics: Record<UsageMetricType, {
    quantity: number;
    freeTierUsed: number;
    billableQuantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  /** Total billable amount (cents) */
  totalCents: number;
  /** Calculation timestamp */
  calculatedAt: string;
}

// =============================================================================
// Subscription Types
// =============================================================================

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface Subscription {
  /** Internal subscription ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Stripe subscription ID */
  stripeSubscriptionId: string;
  /** Stripe customer ID */
  stripeCustomerId: string;
  /** Status */
  status: SubscriptionStatus;
  /** Price/plan ID */
  priceId: string;
  /** Plan name */
  planName: string;
  /** Billing interval */
  interval: 'month' | 'year';
  /** Current period start */
  currentPeriodStart: string;
  /** Current period end */
  currentPeriodEnd: string;
  /** Trial end (if applicable) */
  trialEnd?: string;
  /** Cancel at period end */
  cancelAtPeriodEnd: boolean;
  /** Canceled at */
  canceledAt?: string;
  /** Quantity (seats) */
  quantity: number;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface SubscriptionItem {
  /** Item ID */
  id: string;
  /** Subscription ID */
  subscriptionId: string;
  /** Stripe subscription item ID */
  stripeItemId: string;
  /** Price ID */
  priceId: string;
  /** Product name */
  productName: string;
  /** Quantity */
  quantity: number;
  /** Unit amount (cents) */
  unitAmount: number;
}

// =============================================================================
// Invoice Types
// =============================================================================

export type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'void'
  | 'uncollectible';

export interface Invoice {
  /** Internal invoice ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Stripe invoice ID */
  stripeInvoiceId: string;
  /** Invoice number */
  number: string;
  /** Status */
  status: InvoiceStatus;
  /** Currency */
  currency: string;
  /** Subtotal (cents) */
  subtotal: number;
  /** Tax (cents) */
  tax: number;
  /** Total (cents) */
  total: number;
  /** Amount paid (cents) */
  amountPaid: number;
  /** Amount due (cents) */
  amountDue: number;
  /** Line items */
  lineItems: InvoiceLineItem[];
  /** Period start */
  periodStart: string;
  /** Period end */
  periodEnd: string;
  /** Due date */
  dueDate?: string;
  /** Paid at */
  paidAt?: string;
  /** Invoice PDF URL */
  invoicePdf?: string;
  /** Hosted invoice URL */
  hostedInvoiceUrl?: string;
  /** Created timestamp */
  createdAt: string;
}

export interface InvoiceLineItem {
  /** Line item ID */
  id: string;
  /** Description */
  description: string;
  /** Quantity */
  quantity: number;
  /** Unit amount (cents) */
  unitAmount: number;
  /** Total amount (cents) */
  amount: number;
  /** Period start */
  periodStart?: string;
  /** Period end */
  periodEnd?: string;
}

// =============================================================================
// Payment Types
// =============================================================================

export interface PaymentMethod {
  /** Payment method ID */
  id: string;
  /** Stripe payment method ID */
  stripePaymentMethodId: string;
  /** Type */
  type: 'card' | 'bank_account' | 'sepa_debit';
  /** Is default */
  isDefault: boolean;
  /** Card details (if card) */
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  /** Bank account details (if bank_account) */
  bankAccount?: {
    bankName: string;
    last4: string;
  };
  /** Created timestamp */
  createdAt: string;
}

export interface PaymentIntent {
  /** Stripe payment intent ID */
  id: string;
  /** Amount (cents) */
  amount: number;
  /** Currency */
  currency: string;
  /** Status */
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'canceled';
  /** Client secret */
  clientSecret?: string;
}

// =============================================================================
// Pricing Types
// =============================================================================

export interface PricingPlan {
  /** Plan ID */
  id: string;
  /** Stripe price ID */
  stripePriceId: string;
  /** Stripe product ID */
  stripeProductId: string;
  /** Plan name */
  name: string;
  /** Description */
  description: string;
  /** Tier */
  tier: 'starter' | 'team' | 'business' | 'enterprise';
  /** Billing interval */
  interval: 'month' | 'year';
  /** Base price (cents) */
  basePriceCents: number;
  /** Price per additional user (cents) */
  perUserPriceCents: number;
  /** Included users */
  includedUsers: number;
  /** Features */
  features: string[];
  /** Active */
  active: boolean;
  /** Metadata */
  metadata?: Record<string, string>;
}

export interface PricingTable {
  /** Plans by tier */
  plans: PricingPlan[];
  /** Usage-based pricing */
  usagePricing: UsageMetric[];
  /** Add-ons */
  addOns: AddOn[];
}

export interface AddOn {
  /** Add-on ID */
  id: string;
  /** Stripe price ID */
  stripePriceId: string;
  /** Name */
  name: string;
  /** Description */
  description: string;
  /** Price (cents) */
  priceCents: number;
  /** Billing type */
  billingType: 'one_time' | 'recurring';
  /** Available for tiers */
  availableForTiers: string[];
}

// =============================================================================
// Billing Events
// =============================================================================

export type BillingEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.trial_ending'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'payment_method.attached'
  | 'payment_method.detached'
  | 'customer.subscription.trial_will_end'
  | 'usage.threshold_reached'
  | 'usage.quota_exceeded';

export interface BillingEvent {
  /** Event ID */
  id: string;
  /** Event type */
  type: BillingEventType;
  /** Tenant ID */
  tenantId: string;
  /** Event data */
  data: Record<string, unknown>;
  /** Stripe event ID (if from webhook) */
  stripeEventId?: string;
  /** Timestamp */
  timestamp: string;
  /** Processed */
  processed: boolean;
}

// =============================================================================
// AWS Marketplace Types
// =============================================================================

export interface AWSMarketplaceSubscription {
  /** Internal ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** AWS customer ID */
  customerIdentifier: string;
  /** Product code */
  productCode: string;
  /** Dimension */
  dimension: string;
  /** Status */
  status: 'subscribe-success' | 'subscribe-fail' | 'unsubscribe-pending' | 'unsubscribe-success';
  /** Entitlement start */
  entitlementStartDate?: string;
  /** Entitlement end */
  entitlementEndDate?: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface MarketplaceMeteringRecord {
  /** Record ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Customer identifier */
  customerIdentifier: string;
  /** Product code */
  productCode: string;
  /** Dimension */
  dimension: string;
  /** Quantity */
  quantity: number;
  /** Timestamp */
  timestamp: string;
  /** Usage allocations */
  usageAllocations?: {
    allocatedUsageQuantity: number;
    tags?: { key: string; value: string }[];
  }[];
  /** Metering record ID (from AWS) */
  meteringRecordId?: string;
  /** Status */
  status: 'pending' | 'submitted' | 'accepted' | 'rejected';
  /** Error message */
  errorMessage?: string;
}

// =============================================================================
// Configuration
// =============================================================================

export interface BillingServiceConfig {
  /** Stripe API key */
  stripeSecretKey: string;
  /** Stripe webhook secret */
  stripeWebhookSecret: string;
  /** AWS Marketplace product code */
  awsMarketplaceProductCode?: string;
  /** AWS region for marketplace */
  awsRegion?: string;
  /** DynamoDB table prefix */
  tablePrefix?: string;
  /** Free tier limits */
  freeTierLimits?: Partial<Record<UsageMetricType, number>>;
  /** Usage alert thresholds (percentage) */
  usageAlertThresholds?: number[];
  /** Billing contact email */
  billingContactEmail?: string;
}

// =============================================================================
// Default Pricing
// =============================================================================

export const DEFAULT_USAGE_METRICS: UsageMetric[] = [
  {
    type: 'deployment',
    name: 'Deployments',
    description: 'Number of infrastructure deployments',
    unit: 'deployment',
    unitPriceCents: 100, // $1.00 per deployment
    freeTierIncluded: 5,
    aggregation: 'sum',
    billingInterval: 'monthly',
  },
  {
    type: 'resource_hour',
    name: 'Resource Hours',
    description: 'Hours of managed resources',
    unit: 'resource-hour',
    unitPriceCents: 1, // $0.01 per resource-hour
    freeTierIncluded: 100,
    aggregation: 'sum',
    billingInterval: 'hourly',
  },
  {
    type: 'api_request',
    name: 'API Requests',
    description: 'API requests to the platform',
    unit: 'request',
    unitPriceCents: 0, // Free
    freeTierIncluded: 10000,
    aggregation: 'sum',
    billingInterval: 'monthly',
  },
  {
    type: 'user_seat',
    name: 'User Seats',
    description: 'Active user seats',
    unit: 'user',
    unitPriceCents: 0, // Included in base price
    freeTierIncluded: 1,
    aggregation: 'max',
    billingInterval: 'monthly',
  },
  {
    type: 'storage_gb_hour',
    name: 'State Storage',
    description: 'State storage in GB-hours',
    unit: 'GB-hour',
    unitPriceCents: 0.1, // $0.001 per GB-hour
    freeTierIncluded: 1000,
    aggregation: 'sum',
    billingInterval: 'hourly',
  },
];

export const DEFAULT_PRICING_PLANS: Omit<PricingPlan, 'stripePriceId' | 'stripeProductId'>[] = [
  {
    id: 'starter_monthly',
    name: 'Starter',
    description: 'For individuals and small projects',
    tier: 'starter',
    interval: 'month',
    basePriceCents: 2900, // $29/month
    perUserPriceCents: 0,
    includedUsers: 5,
    features: [
      '5 users included',
      '50 deployments/month',
      'API access',
      'Webhooks',
      'Terraform import',
      'Email support',
    ],
    active: true,
  },
  {
    id: 'team_monthly',
    name: 'Team',
    description: 'For growing teams',
    tier: 'team',
    interval: 'month',
    basePriceCents: 9900, // $99/month
    perUserPriceCents: 1500, // $15/additional user
    includedUsers: 10,
    features: [
      '10 users included',
      '200 deployments/month',
      'Advanced analytics',
      'Multi-region',
      'GitOps integration',
      'Audit log export',
      'Priority support',
    ],
    active: true,
  },
  {
    id: 'business_monthly',
    name: 'Business',
    description: 'For organizations',
    tier: 'business',
    interval: 'month',
    basePriceCents: 29900, // $299/month
    perUserPriceCents: 2500, // $25/additional user
    includedUsers: 25,
    features: [
      '25 users included',
      '1,000 deployments/month',
      'SSO (SAML/OIDC)',
      'SCIM provisioning',
      'Custom branding',
      'Compliance reporting',
      'Disaster recovery',
      'Custom policies',
      '99.9% SLA',
    ],
    active: true,
  },
  {
    id: 'enterprise_monthly',
    name: 'Enterprise',
    description: 'For large organizations',
    tier: 'enterprise',
    interval: 'month',
    basePriceCents: 0, // Custom pricing
    perUserPriceCents: 0,
    includedUsers: -1, // Unlimited
    features: [
      'Unlimited users',
      'Unlimited deployments',
      'Dedicated infrastructure',
      'Custom integrations',
      'Dedicated support',
      '99.99% SLA',
      'Security review',
      'On-premise option',
    ],
    active: true,
  },
];
