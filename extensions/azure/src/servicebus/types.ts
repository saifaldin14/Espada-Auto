/**
 * Azure Service Bus — Type Definitions
 */

export type ServiceBusNamespace = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: string;
  tier: string;
  endpoint?: string;
  provisioningState?: string;
  createdAt?: string;
};

export type ServiceBusQueue = {
  id: string;
  name: string;
  namespaceName: string;
  maxSizeInMegabytes?: number;
  messageCount?: number;
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  status?: string;
  lockDuration?: string;
  maxDeliveryCount?: number;
  requiresDuplicateDetection?: boolean;
  requiresSession?: boolean;
};

export type ServiceBusTopic = {
  id: string;
  name: string;
  namespaceName: string;
  maxSizeInMegabytes?: number;
  subscriptionCount?: number;
  status?: string;
  enablePartitioning?: boolean;
  enableBatchedOperations?: boolean;
};

export type ServiceBusSubscription = {
  id: string;
  name: string;
  topicName: string;
  messageCount?: number;
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  status?: string;
  lockDuration?: string;
  maxDeliveryCount?: number;
  requiresSession?: boolean;
};
