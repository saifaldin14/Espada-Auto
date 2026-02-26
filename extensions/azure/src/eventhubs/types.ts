/**
 * Azure Event Hubs — Type Definitions
 */

// =============================================================================
// Event Hubs Namespace
// =============================================================================

export type EventHubsNamespace = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: string;
  tier: string;
  capacity: number;
  isAutoInflateEnabled: boolean;
  maximumThroughputUnits: number;
  provisioningState?: string;
  kafkaEnabled: boolean;
  status?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Event Hub
// =============================================================================

export type EventHub = {
  id: string;
  name: string;
  partitionCount: number;
  messageRetentionInDays: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  partitionIds: string[];
};

// =============================================================================
// Consumer Group
// =============================================================================

export type ConsumerGroup = {
  id: string;
  name: string;
  userMetadata?: string;
  createdAt?: string;
  updatedAt?: string;
};

// =============================================================================
// Authorization Rule
// =============================================================================

export type AuthorizationRule = {
  id: string;
  name: string;
  rights: string[];
};
