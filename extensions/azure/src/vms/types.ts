/**
 * Azure VMs — Type Definitions
 */

// =============================================================================
// VM Instance Types
// =============================================================================

export type VMPowerState =
  | "running"
  | "deallocated"
  | "stopped"
  | "starting"
  | "deallocating"
  | "unknown";

export type VMInstance = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  vmSize: string;
  powerState: VMPowerState;
  provisioningState: string;
  osType: "Windows" | "Linux";
  osDiskSizeGB?: number;
  privateIpAddress?: string;
  publicIpAddress?: string;
  adminUsername?: string;
  computerName?: string;
  availabilityZone?: string;
  tags?: Record<string, string>;
  networkInterfaces: string[];
  imageReference?: {
    publisher: string;
    offer: string;
    sku: string;
    version: string;
  };
  createdAt?: string;
};

// =============================================================================
// VM Operations
// =============================================================================

export type VMCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  vmSize: string;
  imageReference: {
    publisher: string;
    offer: string;
    sku: string;
    version: string;
  };
  adminUsername: string;
  adminPassword?: string;
  sshPublicKey?: string;
  osType: "Windows" | "Linux";
  osDiskSizeGB?: number;
  subnetId?: string;
  publicIpEnabled?: boolean;
  tags?: Record<string, string>;
  availabilityZone?: string;
  userData?: string;
};

export type VMListOptions = {
  resourceGroup?: string;
  location?: string;
  powerState?: VMPowerState;
  tags?: Record<string, string>;
  /** Maximum number of VMs to return. Omit for all. */
  limit?: number;
  /** Number of VMs to skip before collecting. Default: 0. */
  offset?: number;
};

export type VMOperationResult = {
  success: boolean;
  vmName: string;
  operation: string;
  message?: string;
  error?: string;
};

// =============================================================================
// VM Sizes and Images
// =============================================================================

export type VMSize = {
  name: string;
  numberOfCores: number;
  memoryInMB: number;
  maxDataDiskCount: number;
  osDiskSizeInMB: number;
  resourceDiskSizeInMB: number;
};

export type VMImage = {
  publisher: string;
  offer: string;
  sku: string;
  version: string;
  location: string;
};

// =============================================================================
// VM Metrics
// =============================================================================

export type VMMetrics = {
  vmName: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskReadBytesPerSec?: number;
  diskWriteBytesPerSec?: number;
  networkInBytesPerSec?: number;
  networkOutBytesPerSec?: number;
  timestamp: string;
};

// =============================================================================
// Managed Disks
// =============================================================================

export type ManagedDisk = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  diskSizeGB: number;
  diskState: string;
  sku: string;
  osType?: string;
  managedBy?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Availability Sets
// =============================================================================

export type AvailabilitySet = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  faultDomainCount: number;
  updateDomainCount: number;
  virtualMachines: string[];
  tags?: Record<string, string>;
};
