/**
 * Azure SQL Database — Type Definitions
 */

// =============================================================================
// SQL Server
// =============================================================================

export type SqlServer = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  fullyQualifiedDomainName?: string;
  administratorLogin?: string;
  version?: string;
  state?: string;
  publicNetworkAccess?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// SQL Database
// =============================================================================

export type SqlDatabase = {
  id: string;
  name: string;
  serverName: string;
  resourceGroup: string;
  location: string;
  status?: string;
  edition?: string;
  serviceLevelObjective?: string;
  maxSizeBytes?: number;
  collation?: string;
  creationDate?: string;
  elasticPoolId?: string;
  zoneRedundant?: boolean;
  tags?: Record<string, string>;
};

// =============================================================================
// Elastic Pool
// =============================================================================

export type SqlElasticPool = {
  id: string;
  name: string;
  serverName: string;
  resourceGroup: string;
  location: string;
  state?: string;
  maxSizeBytes?: number;
  perDatabaseSettings?: {
    minCapacity?: number;
    maxCapacity?: number;
  };
  sku?: { name: string; tier: string; capacity: number };
  tags?: Record<string, string>;
};

// =============================================================================
// Firewall Rule
// =============================================================================

export type SqlFirewallRule = {
  id: string;
  name: string;
  startIpAddress: string;
  endIpAddress: string;
};

// =============================================================================
// Failover Group
// =============================================================================

export type SqlFailoverGroup = {
  id: string;
  name: string;
  replicationRole?: string;
  replicationState?: string;
  partnerServers: string[];
  readWriteEndpoint?: string;
  readOnlyEndpoint?: string;
  databases: string[];
};

// =============================================================================
// Create Options
// =============================================================================

export type SqlServerCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  administratorLogin: string;
  administratorLoginPassword: string;
  version?: string;
  publicNetworkAccess?: string;
  tags?: Record<string, string>;
};

export type SqlDatabaseCreateOptions = {
  name: string;
  serverName: string;
  resourceGroup: string;
  location?: string;
  sku?: { name: string; tier?: string; capacity?: number };
  maxSizeBytes?: number;
  collation?: string;
  zoneRedundant?: boolean;
  elasticPoolId?: string;
  tags?: Record<string, string>;
};
