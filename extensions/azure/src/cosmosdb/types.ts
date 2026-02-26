/**
 * Azure Cosmos DB — Type Definitions
 */

// =============================================================================
// Cosmos DB Account
// =============================================================================

export type CosmosDBConsistencyLevel = "Eventual" | "ConsistentPrefix" | "Session" | "BoundedStaleness" | "Strong";

export type CosmosDBAccount = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  kind?: string;
  documentEndpoint?: string;
  provisioningState?: string;
  consistencyPolicy?: {
    defaultConsistencyLevel: CosmosDBConsistencyLevel;
    maxStalenessPrefix?: number;
    maxIntervalInSeconds?: number;
  };
  enableAutomaticFailover?: boolean;
  enableMultipleWriteLocations?: boolean;
  readLocations?: string[];
  writeLocations?: string[];
  tags?: Record<string, string>;
};

// =============================================================================
// Cosmos DB Database
// =============================================================================

export type CosmosDBDatabase = {
  id: string;
  name: string;
  accountName: string;
  resourceGroup: string;
};

// =============================================================================
// Cosmos DB Container
// =============================================================================

export type CosmosDBContainer = {
  id: string;
  name: string;
  databaseName: string;
  partitionKeyPath?: string;
  defaultTtl?: number;
  indexingPolicy?: Record<string, unknown>;
  uniqueKeyPolicy?: Record<string, unknown>;
};

// =============================================================================
// Throughput
// =============================================================================

export type CosmosDBThroughput = {
  throughput?: number;
  autoscaleMaxThroughput?: number;
  minimumThroughput?: number;
  isAutoscale: boolean;
};

// =============================================================================
// Write Operation Types
// =============================================================================

export type CosmosDBAccountCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  kind?: "GlobalDocumentDB" | "MongoDB" | "Parse";
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
