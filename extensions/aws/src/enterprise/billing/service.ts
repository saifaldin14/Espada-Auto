/**
 * Billing Service
 * 
 * Integrates with Stripe for subscription management and AWS Marketplace
 * for enterprise customers. Handles usage metering, invoicing, and payments.
 */

import { randomUUID } from 'node:crypto';
import type {
  BillingServiceConfig,
  UsageMetricType,
  MeteringRecord,
  AggregatedUsage,
  Subscription,
  SubscriptionStatus,
  Invoice,
  PaymentMethod,
  PricingPlan,
  BillingEvent,
  BillingEventType,
  AWSMarketplaceSubscription,
  MarketplaceMeteringRecord,
} from './types.js';
import { DEFAULT_USAGE_METRICS, DEFAULT_PRICING_PLANS } from './types.js';

// =============================================================================
// Stripe Integration (Mock for now - real implementation requires stripe package)
// =============================================================================

interface StripeClient {
  customers: {
    create: (params: Record<string, unknown>) => Promise<{ id: string }>;
    retrieve: (id: string) => Promise<Record<string, unknown>>;
    update: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  subscriptions: {
    create: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    retrieve: (id: string) => Promise<Record<string, unknown>>;
    update: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    cancel: (id: string) => Promise<Record<string, unknown>>;
  };
  invoices: {
    list: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown>[] }>;
    retrieve: (id: string) => Promise<Record<string, unknown>>;
  };
  paymentMethods: {
    list: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown>[] }>;
    attach: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    detach: (id: string) => Promise<Record<string, unknown>>;
  };
  prices: {
    list: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown>[] }>;
  };
  usageRecords: {
    create: (subscriptionItemId: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}

// =============================================================================
// Storage Interface
// =============================================================================

interface BillingStorage {
  // Metering
  saveMeteringRecord(record: MeteringRecord): Promise<void>;
  getMeteringRecords(tenantId: string, startTime: string, endTime: string): Promise<MeteringRecord[]>;
  getAggregatedUsage(tenantId: string, billingPeriod: string): Promise<AggregatedUsage | null>;
  saveAggregatedUsage(usage: AggregatedUsage): Promise<void>;
  
  // Subscriptions
  saveSubscription(subscription: Subscription): Promise<void>;
  getSubscription(tenantId: string): Promise<Subscription | null>;
  getSubscriptionByStripeId(stripeId: string): Promise<Subscription | null>;
  
  // Invoices
  saveInvoice(invoice: Invoice): Promise<void>;
  getInvoices(tenantId: string, limit?: number): Promise<Invoice[]>;
  
  // Payment Methods
  savePaymentMethod(tenantId: string, method: PaymentMethod): Promise<void>;
  getPaymentMethods(tenantId: string): Promise<PaymentMethod[]>;
  deletePaymentMethod(tenantId: string, methodId: string): Promise<void>;
  
  // Events
  saveBillingEvent(event: BillingEvent): Promise<void>;
  
  // AWS Marketplace
  saveMarketplaceSubscription(sub: AWSMarketplaceSubscription): Promise<void>;
  getMarketplaceSubscription(tenantId: string): Promise<AWSMarketplaceSubscription | null>;
}

// =============================================================================
// In-Memory Storage (for development/testing)
// =============================================================================

class InMemoryBillingStorage implements BillingStorage {
  private meteringRecords = new Map<string, MeteringRecord[]>();
  private aggregatedUsage = new Map<string, AggregatedUsage>();
  private subscriptions = new Map<string, Subscription>();
  private invoices = new Map<string, Invoice[]>();
  private paymentMethods = new Map<string, PaymentMethod[]>();
  private events: BillingEvent[] = [];
  private marketplaceSubs = new Map<string, AWSMarketplaceSubscription>();

  async saveMeteringRecord(record: MeteringRecord): Promise<void> {
    const records = this.meteringRecords.get(record.tenantId) ?? [];
    records.push(record);
    this.meteringRecords.set(record.tenantId, records);
  }

  async getMeteringRecords(tenantId: string, startTime: string, endTime: string): Promise<MeteringRecord[]> {
    const records = this.meteringRecords.get(tenantId) ?? [];
    return records.filter(r => r.timestamp >= startTime && r.timestamp <= endTime);
  }

  async getAggregatedUsage(tenantId: string, billingPeriod: string): Promise<AggregatedUsage | null> {
    return this.aggregatedUsage.get(`${tenantId}:${billingPeriod}`) ?? null;
  }

  async saveAggregatedUsage(usage: AggregatedUsage): Promise<void> {
    this.aggregatedUsage.set(`${usage.tenantId}:${usage.billingPeriod}`, usage);
  }

  async saveSubscription(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.tenantId, subscription);
  }

  async getSubscription(tenantId: string): Promise<Subscription | null> {
    return this.subscriptions.get(tenantId) ?? null;
  }

  async getSubscriptionByStripeId(stripeId: string): Promise<Subscription | null> {
    for (const sub of this.subscriptions.values()) {
      if (sub.stripeSubscriptionId === stripeId) return sub;
    }
    return null;
  }

  async saveInvoice(invoice: Invoice): Promise<void> {
    const invoices = this.invoices.get(invoice.tenantId) ?? [];
    invoices.unshift(invoice);
    this.invoices.set(invoice.tenantId, invoices);
  }

  async getInvoices(tenantId: string, limit = 10): Promise<Invoice[]> {
    const invoices = this.invoices.get(tenantId) ?? [];
    return invoices.slice(0, limit);
  }

  async savePaymentMethod(tenantId: string, method: PaymentMethod): Promise<void> {
    const methods = this.paymentMethods.get(tenantId) ?? [];
    methods.push(method);
    this.paymentMethods.set(tenantId, methods);
  }

  async getPaymentMethods(tenantId: string): Promise<PaymentMethod[]> {
    return this.paymentMethods.get(tenantId) ?? [];
  }

  async deletePaymentMethod(tenantId: string, methodId: string): Promise<void> {
    const methods = this.paymentMethods.get(tenantId) ?? [];
    this.paymentMethods.set(tenantId, methods.filter(m => m.id !== methodId));
  }

  async saveBillingEvent(event: BillingEvent): Promise<void> {
    this.events.push(event);
  }

  async saveMarketplaceSubscription(sub: AWSMarketplaceSubscription): Promise<void> {
    this.marketplaceSubs.set(sub.tenantId, sub);
  }

  async getMarketplaceSubscription(tenantId: string): Promise<AWSMarketplaceSubscription | null> {
    return this.marketplaceSubs.get(tenantId) ?? null;
  }
}

// =============================================================================
// Billing Service Result
// =============================================================================

interface BillingResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// =============================================================================
// Billing Service Implementation
// =============================================================================

export class BillingService {
  private config: BillingServiceConfig;
  private storage: BillingStorage;
  private stripe: StripeClient | null = null;
  private pricingPlans: PricingPlan[] = [];
  private initialized = false;

  constructor(config: BillingServiceConfig, storage?: BillingStorage) {
    this.config = config;
    this.storage = storage ?? new InMemoryBillingStorage();
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<BillingResult> {
    if (this.initialized) {
      return { success: true, message: 'Already initialized' };
    }

    try {
      // Initialize Stripe client (in real implementation)
      // this.stripe = new Stripe(this.config.stripeSecretKey);

      // Load pricing plans
      // In real implementation, fetch from Stripe
      this.pricingPlans = DEFAULT_PRICING_PLANS.map((plan, i) => ({
        ...plan,
        stripePriceId: `price_${plan.id}`,
        stripeProductId: `prod_${plan.tier}`,
      }));

      this.initialized = true;
      return { success: true, message: 'Billing service initialized' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to initialize billing service',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Customer Management
  // ===========================================================================

  /**
   * Create a Stripe customer for a tenant
   */
  async createCustomer(tenantId: string, email: string, name: string): Promise<BillingResult<{ customerId: string }>> {
    try {
      // In real implementation:
      // const customer = await this.stripe.customers.create({
      //   email,
      //   name,
      //   metadata: { tenantId },
      // });

      const customerId = `cus_${randomUUID().replace(/-/g, '').slice(0, 14)}`;

      return {
        success: true,
        data: { customerId },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create customer',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Subscription Management
  // ===========================================================================

  /**
   * Create a subscription for a tenant
   */
  async createSubscription(
    tenantId: string,
    customerId: string,
    priceId: string,
    quantity = 1,
    trialDays?: number,
  ): Promise<BillingResult<Subscription>> {
    try {
      const plan = this.pricingPlans.find(p => p.stripePriceId === priceId);
      if (!plan) {
        return { success: false, message: 'Invalid price ID' };
      }

      // In real implementation:
      // const stripeSubscription = await this.stripe.subscriptions.create({
      //   customer: customerId,
      //   items: [{ price: priceId, quantity }],
      //   trial_period_days: trialDays,
      //   metadata: { tenantId },
      // });

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const subscription: Subscription = {
        id: `sub_${randomUUID()}`,
        tenantId,
        stripeSubscriptionId: `sub_stripe_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        stripeCustomerId: customerId,
        status: trialDays ? 'trialing' : 'active',
        priceId,
        planName: plan.name,
        interval: plan.interval,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        trialEnd: trialDays 
          ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
        cancelAtPeriodEnd: false,
        quantity,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      await this.storage.saveSubscription(subscription);
      await this.emitEvent('subscription.created', tenantId, { subscription });

      return { success: true, data: subscription };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create subscription',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Get tenant subscription
   */
  async getSubscription(tenantId: string): Promise<BillingResult<Subscription>> {
    try {
      const subscription = await this.storage.getSubscription(tenantId);
      if (!subscription) {
        return { success: false, message: 'No subscription found' };
      }
      return { success: true, data: subscription };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get subscription',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Update subscription quantity (seats)
   */
  async updateSubscriptionQuantity(
    tenantId: string,
    quantity: number,
  ): Promise<BillingResult<Subscription>> {
    try {
      const subscription = await this.storage.getSubscription(tenantId);
      if (!subscription) {
        return { success: false, message: 'No subscription found' };
      }

      // In real implementation:
      // await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      //   items: [{ quantity }],
      // });

      subscription.quantity = quantity;
      subscription.updatedAt = new Date().toISOString();

      await this.storage.saveSubscription(subscription);
      await this.emitEvent('subscription.updated', tenantId, {
        subscription,
        change: 'quantity',
      });

      return { success: true, data: subscription };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update subscription',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    tenantId: string,
    cancelAtPeriodEnd = true,
  ): Promise<BillingResult<Subscription>> {
    try {
      const subscription = await this.storage.getSubscription(tenantId);
      if (!subscription) {
        return { success: false, message: 'No subscription found' };
      }

      // In real implementation:
      // if (cancelAtPeriodEnd) {
      //   await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      //     cancel_at_period_end: true,
      //   });
      // } else {
      //   await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      // }

      if (cancelAtPeriodEnd) {
        subscription.cancelAtPeriodEnd = true;
      } else {
        subscription.status = 'canceled';
        subscription.canceledAt = new Date().toISOString();
      }
      subscription.updatedAt = new Date().toISOString();

      await this.storage.saveSubscription(subscription);
      await this.emitEvent('subscription.canceled', tenantId, {
        subscription,
        immediate: !cancelAtPeriodEnd,
      });

      return { success: true, data: subscription };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to cancel subscription',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Change subscription plan
   */
  async changeSubscriptionPlan(
    tenantId: string,
    newPriceId: string,
  ): Promise<BillingResult<Subscription>> {
    try {
      const subscription = await this.storage.getSubscription(tenantId);
      if (!subscription) {
        return { success: false, message: 'No subscription found' };
      }

      const plan = this.pricingPlans.find(p => p.stripePriceId === newPriceId);
      if (!plan) {
        return { success: false, message: 'Invalid price ID' };
      }

      // In real implementation, update via Stripe API

      subscription.priceId = newPriceId;
      subscription.planName = plan.name;
      subscription.updatedAt = new Date().toISOString();

      await this.storage.saveSubscription(subscription);
      await this.emitEvent('subscription.updated', tenantId, {
        subscription,
        change: 'plan',
      });

      return { success: true, data: subscription };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to change subscription plan',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Usage Metering
  // ===========================================================================

  /**
   * Record usage for a tenant
   */
  async recordUsage(
    tenantId: string,
    metricType: UsageMetricType,
    quantity: number,
    metadata?: MeteringRecord['metadata'],
    idempotencyKey?: string,
  ): Promise<BillingResult<MeteringRecord>> {
    try {
      const record: MeteringRecord = {
        id: `meter_${randomUUID()}`,
        tenantId,
        metricType,
        quantity,
        timestamp: new Date().toISOString(),
        idempotencyKey,
        metadata,
      };

      await this.storage.saveMeteringRecord(record);

      // Check if usage threshold reached
      await this.checkUsageThresholds(tenantId, metricType);

      return { success: true, data: record };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to record usage',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Get aggregated usage for a billing period
   */
  async getUsage(
    tenantId: string,
    billingPeriod?: string,
  ): Promise<BillingResult<AggregatedUsage>> {
    try {
      const period = billingPeriod ?? this.getCurrentBillingPeriod();
      
      // Try to get cached aggregation
      let usage = await this.storage.getAggregatedUsage(tenantId, period);
      
      if (!usage) {
        // Calculate from records
        usage = await this.calculateUsage(tenantId, period);
        await this.storage.saveAggregatedUsage(usage);
      }

      return { success: true, data: usage };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get usage',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async calculateUsage(tenantId: string, billingPeriod: string): Promise<AggregatedUsage> {
    const [year, month] = billingPeriod.split('-').map(Number);
    const startTime = new Date(year, month - 1, 1).toISOString();
    const endTime = new Date(year, month, 0, 23, 59, 59, 999).toISOString();

    const records = await this.storage.getMeteringRecords(tenantId, startTime, endTime);
    
    const metrics: AggregatedUsage['metrics'] = {} as any;
    let totalCents = 0;

    for (const metricDef of DEFAULT_USAGE_METRICS) {
      const metricRecords = records.filter(r => r.metricType === metricDef.type);
      const quantity = metricRecords.reduce((sum, r) => sum + r.quantity, 0);
      const freeTierUsed = Math.min(quantity, metricDef.freeTierIncluded);
      const billableQuantity = Math.max(0, quantity - metricDef.freeTierIncluded);
      const metricTotalCents = billableQuantity * metricDef.unitPriceCents;

      metrics[metricDef.type] = {
        quantity,
        freeTierUsed,
        billableQuantity,
        unitPriceCents: metricDef.unitPriceCents,
        totalCents: metricTotalCents,
      };

      totalCents += metricTotalCents;
    }

    return {
      tenantId,
      billingPeriod,
      metrics,
      totalCents,
      calculatedAt: new Date().toISOString(),
    };
  }

  private async checkUsageThresholds(tenantId: string, _metricType: UsageMetricType): Promise<void> {
    // Get current usage
    const usageResult = await this.getUsage(tenantId);
    if (!usageResult.success || !usageResult.data) return;

    // Check against quota limits
    // Emit warnings if approaching limits
    const thresholds = this.config.usageAlertThresholds ?? [80, 90, 100];
    
    // Implementation would check each metric against limits
    // and emit events when thresholds are crossed
  }

  private getCurrentBillingPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // ===========================================================================
  // Invoices
  // ===========================================================================

  /**
   * Get invoices for a tenant
   */
  async getInvoices(tenantId: string, limit = 10): Promise<BillingResult<Invoice[]>> {
    try {
      const invoices = await this.storage.getInvoices(tenantId, limit);
      return { success: true, data: invoices };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get invoices',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Payment Methods
  // ===========================================================================

  /**
   * Add a payment method
   */
  async addPaymentMethod(
    tenantId: string,
    stripePaymentMethodId: string,
    setAsDefault = true,
  ): Promise<BillingResult<PaymentMethod>> {
    try {
      // In real implementation:
      // const subscription = await this.storage.getSubscription(tenantId);
      // await this.stripe.paymentMethods.attach(stripePaymentMethodId, {
      //   customer: subscription.stripeCustomerId,
      // });

      const method: PaymentMethod = {
        id: `pm_${randomUUID()}`,
        stripePaymentMethodId,
        type: 'card',
        isDefault: setAsDefault,
        card: {
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2025,
        },
        createdAt: new Date().toISOString(),
      };

      if (setAsDefault) {
        // Update other methods to not be default
        const existingMethods = await this.storage.getPaymentMethods(tenantId);
        for (const existing of existingMethods) {
          if (existing.isDefault) {
            existing.isDefault = false;
            await this.storage.savePaymentMethod(tenantId, existing);
          }
        }
      }

      await this.storage.savePaymentMethod(tenantId, method);
      await this.emitEvent('payment_method.attached', tenantId, { method });

      return { success: true, data: method };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to add payment method',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Get payment methods
   */
  async getPaymentMethods(tenantId: string): Promise<BillingResult<PaymentMethod[]>> {
    try {
      const methods = await this.storage.getPaymentMethods(tenantId);
      return { success: true, data: methods };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get payment methods',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Remove a payment method
   */
  async removePaymentMethod(tenantId: string, methodId: string): Promise<BillingResult> {
    try {
      await this.storage.deletePaymentMethod(tenantId, methodId);
      await this.emitEvent('payment_method.detached', tenantId, { methodId });
      return { success: true, message: 'Payment method removed' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to remove payment method',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Pricing
  // ===========================================================================

  /**
   * Get available pricing plans
   */
  getPricingPlans(): PricingPlan[] {
    return this.pricingPlans;
  }

  /**
   * Get plan by ID
   */
  getPlan(planId: string): PricingPlan | undefined {
    return this.pricingPlans.find(p => p.id === planId || p.stripePriceId === planId);
  }

  // ===========================================================================
  // Stripe Webhooks
  // ===========================================================================

  /**
   * Handle Stripe webhook event
   */
  async handleStripeWebhook(
    payload: string,
    signature: string,
  ): Promise<BillingResult> {
    try {
      // In real implementation:
      // const event = this.stripe.webhooks.constructEvent(
      //   payload,
      //   signature,
      //   this.config.stripeWebhookSecret,
      // );

      // Parse the event (simplified)
      const event = JSON.parse(payload);
      const eventType = event.type as string;

      switch (eventType) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdate(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionCanceled(event.data.object);
          break;
        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object);
          break;
        default:
          // Unhandled event type
          break;
      }

      return { success: true, message: 'Webhook processed' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to process webhook',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private async handleSubscriptionUpdate(_stripeSubscription: Record<string, unknown>): Promise<void> {
    // Update local subscription record
  }

  private async handleSubscriptionCanceled(_stripeSubscription: Record<string, unknown>): Promise<void> {
    // Update local subscription record and tenant status
  }

  private async handleInvoicePaid(stripeInvoice: Record<string, unknown>): Promise<void> {
    // Create local invoice record
    const tenantId = (stripeInvoice.metadata as Record<string, unknown> | undefined)?.tenantId;
    if (tenantId) {
      await this.emitEvent('invoice.paid', tenantId, {
        invoiceId: stripeInvoice.id,
        amount: stripeInvoice.amount_paid,
      });
    }
  }

  private async handleInvoicePaymentFailed(stripeInvoice: Record<string, unknown>): Promise<void> {
    const tenantId = (stripeInvoice.metadata as Record<string, unknown> | undefined)?.tenantId;
    if (tenantId) {
      await this.emitEvent('invoice.payment_failed', tenantId, {
        invoiceId: stripeInvoice.id,
        amount: stripeInvoice.amount_due,
      });
    }
  }

  // ===========================================================================
  // AWS Marketplace Integration
  // ===========================================================================

  /**
   * Register an AWS Marketplace subscription
   */
  async registerMarketplaceSubscription(
    tenantId: string,
    customerIdentifier: string,
    productCode: string,
  ): Promise<BillingResult<AWSMarketplaceSubscription>> {
    try {
      const now = new Date().toISOString();
      
      const subscription: AWSMarketplaceSubscription = {
        id: `mkt_${randomUUID()}`,
        tenantId,
        customerIdentifier,
        productCode,
        dimension: 'basic',
        status: 'subscribe-success',
        entitlementStartDate: now,
        createdAt: now,
        updatedAt: now,
      };

      await this.storage.saveMarketplaceSubscription(subscription);

      return { success: true, data: subscription };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to register marketplace subscription',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Report usage to AWS Marketplace
   */
  async reportMarketplaceUsage(
    tenantId: string,
    dimension: string,
    quantity: number,
  ): Promise<BillingResult> {
    try {
      const subscription = await this.storage.getMarketplaceSubscription(tenantId);
      if (!subscription) {
        return { success: false, message: 'No marketplace subscription found' };
      }

      // In real implementation:
      // const { MarketplaceMeteringClient, MeterUsageCommand } = await import('@aws-sdk/client-marketplace-metering');
      // const client = new MarketplaceMeteringClient({ region: this.config.awsRegion });
      // await client.send(new MeterUsageCommand({
      //   ProductCode: subscription.productCode,
      //   Timestamp: new Date(),
      //   UsageDimension: dimension,
      //   UsageQuantity: quantity,
      // }));

      return { success: true, message: 'Usage reported to AWS Marketplace' };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to report marketplace usage',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async emitEvent(
    type: BillingEventType,
    tenantId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const event: BillingEvent = {
      id: `evt_${randomUUID()}`,
      type,
      tenantId,
      data,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    await this.storage.saveBillingEvent(event);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createBillingService(
  config: BillingServiceConfig,
  storage?: BillingStorage,
): BillingService {
  return new BillingService(config, storage);
}
