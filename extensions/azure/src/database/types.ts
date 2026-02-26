/**
 * Azure Database for MySQL / PostgreSQL Flexible Server types.
 */

/** A MySQL Flexible Server instance. */
export interface AzureMySqlFlexibleServer {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state?: string;
  version?: string;
  skuName?: string;
  skuTier?: string;
  administratorLogin?: string;
  fullyQualifiedDomainName?: string;
  storageGB?: number;
  backupRetentionDays?: number;
  haEnabled?: boolean;
  haState?: string;
  availabilityZone?: string;
  replicaCapacity?: number;
  replicationRole?: string;
  tags: Record<string, string>;
}

/** A PostgreSQL Flexible Server instance. */
export interface AzurePostgreSqlFlexibleServer {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state?: string;
  version?: string;
  skuName?: string;
  skuTier?: string;
  administratorLogin?: string;
  fullyQualifiedDomainName?: string;
  storageGB?: number;
  backupRetentionDays?: number;
  haEnabled?: boolean;
  haState?: string;
  availabilityZone?: string;
  replicaCapacity?: number;
  replicationRole?: string;
  tags: Record<string, string>;
}

/** A database within a MySQL or PostgreSQL server. */
export interface AzureFlexibleDatabase {
  id: string;
  name: string;
  charset?: string;
  collation?: string;
}

/** A firewall rule for a MySQL or PostgreSQL server. */
export interface AzureFlexibleFirewallRule {
  id: string;
  name: string;
  startIpAddress: string;
  endIpAddress: string;
}
