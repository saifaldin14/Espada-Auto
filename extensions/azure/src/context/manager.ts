/**
 * Azure Context Manager — Subscription/Tenant Context Switching
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";

// =============================================================================
// Types
// =============================================================================

export type AzureContext = {
  subscriptionId: string;
  tenantId?: string;
  region?: string;
  accountName?: string;
  accountId?: string;
};

export type AzureAccountInfo = {
  subscriptionId: string;
  subscriptionName: string;
  tenantId: string;
  userName?: string;
  state: string;
};

export type ContextSwitchOptions = {
  subscriptionId?: string;
  tenantId?: string;
  region?: string;
};

// =============================================================================
// Context Manager
// =============================================================================

export class AzureContextManager {
  private credentialsManager: AzureCredentialsManager;
  private currentContext: AzureContext | null = null;
  private defaultRegion: string;

  constructor(credentialsManager: AzureCredentialsManager, defaultRegion?: string) {
    this.credentialsManager = credentialsManager;
    this.defaultRegion = defaultRegion ?? "eastus";
  }

  /**
   * Initialize context by resolving the current identity.
   */
  async initialize(): Promise<AzureContext> {
    const cred = await this.credentialsManager.getCredential();

    this.currentContext = {
      subscriptionId: cred.subscriptionId ?? "",
      tenantId: cred.tenantId,
      region: this.defaultRegion,
    };

    return this.currentContext;
  }

  /**
   * Get the current Azure context.
   */
  getContext(): AzureContext | null {
    return this.currentContext;
  }

  /**
   * Switch to a different subscription/tenant/region.
   */
  async switchContext(options: ContextSwitchOptions): Promise<AzureContext> {
    this.currentContext = {
      subscriptionId: options.subscriptionId ?? this.currentContext?.subscriptionId ?? "",
      tenantId: options.tenantId ?? this.currentContext?.tenantId,
      region: options.region ?? this.currentContext?.region ?? this.defaultRegion,
    };

    return this.currentContext;
  }

  /**
   * Get the active subscription ID.
   */
  getSubscriptionId(): string {
    return this.currentContext?.subscriptionId ?? this.credentialsManager.getSubscriptionId() ?? "";
  }

  /**
   * Get the active region.
   */
  getRegion(): string {
    return this.currentContext?.region ?? this.defaultRegion;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createContextManager(
  credentialsManager: AzureCredentialsManager,
  defaultRegion?: string,
): AzureContextManager {
  return new AzureContextManager(credentialsManager, defaultRegion);
}
