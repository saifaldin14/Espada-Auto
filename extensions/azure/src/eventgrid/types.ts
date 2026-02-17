/**
 * Azure Event Grid — Type Definitions
 */

export type EventGridTopic = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  endpoint?: string;
  provisioningState?: string;
  publicNetworkAccess?: string;
  inputSchema?: string;
};

export type EventGridSubscription = {
  id: string;
  name: string;
  topicName?: string;
  destination?: string;
  provisioningState?: string;
  eventDeliverySchema?: string;
  filter?: {
    subjectBeginsWith?: string;
    subjectEndsWith?: string;
    includedEventTypes?: string[];
  };
  retryPolicy?: { maxDeliveryAttempts?: number; eventTimeToLiveInMinutes?: number };
};

export type EventGridDomain = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  endpoint?: string;
  provisioningState?: string;
  publicNetworkAccess?: string;
};

export type SystemTopic = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  source?: string;
  topicType?: string;
  provisioningState?: string;
  metricResourceId?: string;
};
