/**
 * Azure Subscriptions — Type Definitions
 */

export type SubscriptionState = "Enabled" | "Warned" | "PastDue" | "Disabled" | "Deleted";

export type AzureSubscription = {
  subscriptionId: string;
  displayName: string;
  state: SubscriptionState;
  tenantId: string;
  subscriptionPolicies?: {
    locationPlacementId?: string;
    quotaId?: string;
    spendingLimit?: string;
  };
  authorizationSource?: string;
};

export type TenantInfo = {
  tenantId: string;
  displayName?: string;
  tenantCategory?: string;
  defaultDomain?: string;
  country?: string;
  countryCode?: string;
};

export type AzureLocation = {
  name: string;
  displayName: string;
  regionalDisplayName?: string;
  type?: string;
  latitude?: string;
  longitude?: string;
  physicalLocation?: string;
  pairedRegion?: string[];
};
