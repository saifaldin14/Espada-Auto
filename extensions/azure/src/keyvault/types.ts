/**
 * Azure Key Vault — Type Definitions
 */

// =============================================================================
// Key Vault
// =============================================================================

export type KeyVault = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  vaultUri: string;
  tenantId?: string;
  sku?: string;
  enableSoftDelete?: boolean;
  enablePurgeProtection?: boolean;
  softDeleteRetentionInDays?: number;
  provisioningState?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Secrets
// =============================================================================

export type KeyVaultSecret = {
  id: string;
  name: string;
  value?: string;
  contentType?: string;
  enabled?: boolean;
  notBefore?: string;
  expiresOn?: string;
  createdOn?: string;
  updatedOn?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Keys
// =============================================================================

export type KeyVaultKey = {
  id: string;
  name: string;
  keyType?: string;
  keyOps?: string[];
  enabled?: boolean;
  notBefore?: string;
  expiresOn?: string;
  createdOn?: string;
  updatedOn?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Certificates
// =============================================================================

export type KeyVaultCertificate = {
  id: string;
  name: string;
  thumbprint?: string;
  subject?: string;
  enabled?: boolean;
  notBefore?: string;
  expiresOn?: string;
  createdOn?: string;
  updatedOn?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Access Policies
// =============================================================================

export type KeyVaultAccessPolicy = {
  tenantId: string;
  objectId: string;
  permissions: {
    keys?: string[];
    secrets?: string[];
    certificates?: string[];
    storage?: string[];
  };
};
