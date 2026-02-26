/**
 * Azure Maps types.
 */

/** An Azure Maps account. */
export interface AzureMapsAccount {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  skuName?: string;
  kind?: string;
  provisioningState?: string;
  uniqueId?: string;
  disableLocalAuth?: boolean;
  linkedResources?: Array<{ uniqueName?: string; id?: string }>;
  cors?: { allowedOrigins?: string[] };
  tags: Record<string, string>;
}

/** An Azure Maps creator resource. */
export interface AzureMapsCreator {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  storageUnits?: number;
  consumedStorageUnitPercentage?: number;
  tags: Record<string, string>;
}
