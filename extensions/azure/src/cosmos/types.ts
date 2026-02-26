/**
 * Azure Cosmos DB — Type Definitions
 */

export type CosmosDBAccountKind = "GlobalDocumentDB" | "MongoDB" | "Parse";

export type CosmosDBConsistencyLevel = "Eventual" | "ConsistentPrefix" | "Session" | "BoundedStaleness" | "Strong";

export type CosmosDBAccount = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  kind?: CosmosDBAccountKind;
  documentEndpoint?: string;
  provisioningState?: string;
  consistencyPolicy?: { defaultConsistencyLevel: string };
  locations?: Array<{ locationName: string; failoverPriority: number; isZoneRedundant?: boolean }>;
  capabilities?: string[];
  enableAutomaticFailover?: boolean;
  enableMultipleWriteLocations?: boolean;
  tags?: Record<string, string>;
};

export type CosmosDBDatabase = {
  id: string;
  name: string;
  accountName: string;
  throughput?: number;
};

export type CosmosDBContainer = {
  id: string;
  name: string;
  databaseName: string;
  partitionKey?: { paths: string[]; kind: string };
  indexingPolicy?: Record<string, unknown>;
  defaultTtl?: number;
  throughput?: number;
};

export type CosmosDBAccountCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  kind?: CosmosDBAccountKind;
  consistencyLevel?: CosmosDBConsistencyLevel;
  enableAutomaticFailover?: boolean;
  enableMultipleWriteLocations?: boolean;
  capabilities?: string[];
  tags?: Record<string, string>;
};

export type CosmosDBAccountKeys = {
  primaryMasterKey?: string;
  secondaryMasterKey?: string;
  primaryReadonlyMasterKey?: string;
  secondaryReadonlyMasterKey?: string;
};
