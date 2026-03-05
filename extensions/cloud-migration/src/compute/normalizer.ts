/**
 * Compute Pipeline — Normalizer
 *
 * Converts provider-specific VM representations into NormalizedVM.
 * Handles: EC2Instance | AzureVMInstance | GcpComputeInstance → NormalizedVM
 */

import type { MigrationProvider, NormalizedVM, NormalizedDisk, NormalizedNetworkInterface } from "../types.js";

// =============================================================================
// Provider-Specific Types (input shapes)
// =============================================================================

export type EC2Instance = {
  instanceId: string;
  instanceType: string;
  platform?: string;
  state?: { name: string };
  tags?: Array<{ Key: string; Value: string }>;
  placement?: { availabilityZone: string; region?: string };
  cpuOptions?: { coreCount: number; threadsPerCore: number };
  blockDeviceMappings?: Array<{
    deviceName: string;
    ebs?: { volumeId: string; volumeSize?: number; volumeType?: string; encrypted?: boolean };
  }>;
  networkInterfaces?: Array<{
    networkInterfaceId: string;
    privateIpAddress: string;
    publicIp?: string;
    subnetId?: string;
    groups?: Array<{ groupId: string }>;
    macAddress?: string;
  }>;
  architecture?: string;
};

export type AzureVMInstance = {
  id: string;
  name: string;
  location: string;
  vmSize: string;
  osType?: string;
  tags?: Record<string, string>;
  networkInterfaces?: Array<{
    id: string;
    privateIPAddress: string;
    publicIPAddress?: string;
    subnetId?: string;
    networkSecurityGroupId?: string;
    macAddress?: string;
  }>;
  storageProfile?: {
    osDisk?: { name: string; diskSizeGB?: number; managedDiskId?: string };
    dataDisks?: Array<{ name: string; diskSizeGB: number; lun: number; managedDiskId?: string }>;
  };
};

export type GcpComputeInstance = {
  name: string;
  zone: string;
  machineType: string;
  status?: string;
  labels?: Record<string, string>;
  disks?: Array<{
    source: string;
    boot: boolean;
    deviceName?: string;
    diskSizeGb?: number;
    type?: string;
  }>;
  networkInterfaces?: Array<{
    networkIP: string;
    accessConfigs?: Array<{ natIP?: string }>;
    subnetwork?: string;
    name: string;
  }>;
  metadata?: { items?: Array<{ key: string; value: string }> };
};

// =============================================================================
// EC2 Instance Type → CPU/Memory Lookup (common types)
// =============================================================================

const EC2_INSTANCE_SPECS: Record<string, { cpuCores: number; memoryGB: number }> = {
  "t2.micro": { cpuCores: 1, memoryGB: 1 },
  "t2.small": { cpuCores: 1, memoryGB: 2 },
  "t2.medium": { cpuCores: 2, memoryGB: 4 },
  "t2.large": { cpuCores: 2, memoryGB: 8 },
  "t2.xlarge": { cpuCores: 4, memoryGB: 16 },
  "t3.micro": { cpuCores: 2, memoryGB: 1 },
  "t3.small": { cpuCores: 2, memoryGB: 2 },
  "t3.medium": { cpuCores: 2, memoryGB: 4 },
  "t3.large": { cpuCores: 2, memoryGB: 8 },
  "t3.xlarge": { cpuCores: 4, memoryGB: 16 },
  "m5.large": { cpuCores: 2, memoryGB: 8 },
  "m5.xlarge": { cpuCores: 4, memoryGB: 16 },
  "m5.2xlarge": { cpuCores: 8, memoryGB: 32 },
  "m5.4xlarge": { cpuCores: 16, memoryGB: 64 },
  "c5.large": { cpuCores: 2, memoryGB: 4 },
  "c5.xlarge": { cpuCores: 4, memoryGB: 8 },
  "c5.2xlarge": { cpuCores: 8, memoryGB: 16 },
  "r5.large": { cpuCores: 2, memoryGB: 16 },
  "r5.xlarge": { cpuCores: 4, memoryGB: 32 },
  "r5.2xlarge": { cpuCores: 8, memoryGB: 64 },
};

// =============================================================================
// Azure VM Size → CPU/Memory Lookup
// =============================================================================

const AZURE_VM_SPECS: Record<string, { cpuCores: number; memoryGB: number }> = {
  Standard_B1s: { cpuCores: 1, memoryGB: 1 },
  Standard_B2s: { cpuCores: 2, memoryGB: 4 },
  Standard_D2s_v3: { cpuCores: 2, memoryGB: 8 },
  Standard_D4s_v3: { cpuCores: 4, memoryGB: 16 },
  Standard_D8s_v3: { cpuCores: 8, memoryGB: 32 },
  Standard_D16s_v3: { cpuCores: 16, memoryGB: 64 },
  Standard_E2s_v3: { cpuCores: 2, memoryGB: 16 },
  Standard_E4s_v3: { cpuCores: 4, memoryGB: 32 },
  Standard_F2s_v2: { cpuCores: 2, memoryGB: 4 },
  Standard_F4s_v2: { cpuCores: 4, memoryGB: 8 },
};

// =============================================================================
// GCP Machine Type Parser
// =============================================================================

function parseGcpMachineType(machineType: string): { cpuCores: number; memoryGB: number } {
  // e.g., "n1-standard-4" → 4 cores, 15GB
  // e.g., "e2-medium" → 2 cores, 4GB
  const GCP_SPECS: Record<string, { cpuCores: number; memoryGB: number }> = {
    "e2-micro": { cpuCores: 2, memoryGB: 1 },
    "e2-small": { cpuCores: 2, memoryGB: 2 },
    "e2-medium": { cpuCores: 2, memoryGB: 4 },
    "e2-standard-2": { cpuCores: 2, memoryGB: 8 },
    "e2-standard-4": { cpuCores: 4, memoryGB: 16 },
    "e2-standard-8": { cpuCores: 8, memoryGB: 32 },
    "n1-standard-1": { cpuCores: 1, memoryGB: 3.75 },
    "n1-standard-2": { cpuCores: 2, memoryGB: 7.5 },
    "n1-standard-4": { cpuCores: 4, memoryGB: 15 },
    "n1-standard-8": { cpuCores: 8, memoryGB: 30 },
    "n2-standard-2": { cpuCores: 2, memoryGB: 8 },
    "n2-standard-4": { cpuCores: 4, memoryGB: 16 },
    "n2-standard-8": { cpuCores: 8, memoryGB: 32 },
  };

  // Strip zone prefix if present (projects/.../machineTypes/...)
  const shortType = machineType.includes("/")
    ? machineType.split("/").pop()!
    : machineType;

  const spec = GCP_SPECS[shortType];
  if (spec) return spec;

  // Heuristic: parse "-N" suffix as core count
  const match = shortType.match(/-(\d+)$/);
  if (match) {
    const cores = parseInt(match[1], 10);
    return { cpuCores: cores, memoryGB: cores * 4 };
  }

  return { cpuCores: 2, memoryGB: 8 }; // Default fallback
}

function extractGcpRegion(zone: string): string {
  // "us-central1-a" → "us-central1"
  const parts = zone.split("-");
  return parts.length >= 3 ? parts.slice(0, -1).join("-") : zone;
}

// =============================================================================
// Normalizers
// =============================================================================

/**
 * Normalize an AWS EC2 instance to NormalizedVM.
 */
export function normalizeEC2Instance(instance: EC2Instance): NormalizedVM {
  const nameTag = instance.tags?.find((t) => t.Key === "Name")?.Value ?? instance.instanceId;
  const region = instance.placement?.region ?? instance.placement?.availabilityZone?.replace(/-[a-z]$/, "") ?? "unknown";
  const zone = instance.placement?.availabilityZone;

  const specs = EC2_INSTANCE_SPECS[instance.instanceType] ?? { cpuCores: 2, memoryGB: 8 };
  const cpuCores = instance.cpuOptions?.coreCount ?? specs.cpuCores;
  const memoryGB = specs.memoryGB;

  const disks: NormalizedDisk[] = (instance.blockDeviceMappings ?? []).map((bdm, i) => ({
    id: bdm.ebs?.volumeId ?? `vol-${i}`,
    name: bdm.deviceName,
    sizeGB: bdm.ebs?.volumeSize ?? 0,
    type: (bdm.ebs?.volumeType === "gp3" || bdm.ebs?.volumeType === "io1") ? "ssd" : "standard",
    encrypted: bdm.ebs?.encrypted ?? false,
    isBootDisk: i === 0,
    devicePath: bdm.deviceName,
  }));

  const networkInterfaces: NormalizedNetworkInterface[] = (instance.networkInterfaces ?? []).map((ni) => ({
    id: ni.networkInterfaceId,
    privateIp: ni.privateIpAddress,
    publicIp: ni.publicIp,
    subnetId: ni.subnetId,
    securityGroupIds: ni.groups?.map((g) => g.groupId) ?? [],
    macAddress: ni.macAddress,
  }));

  const tags: Record<string, string> = {};
  for (const tag of instance.tags ?? []) {
    tags[tag.Key] = tag.Value;
  }

  return {
    id: instance.instanceId,
    name: nameTag,
    provider: "aws",
    region,
    zone,
    cpuCores,
    memoryGB,
    osType: instance.platform === "windows" ? "windows" : "linux",
    architecture: (instance.architecture === "arm64" ? "arm64" : "x86_64") as "x86_64" | "arm64",
    disks,
    networkInterfaces,
    tags,
    raw: instance as unknown as Record<string, unknown>,
  };
}

/**
 * Normalize an Azure VM instance to NormalizedVM.
 */
export function normalizeAzureVM(instance: AzureVMInstance): NormalizedVM {
  const specs = AZURE_VM_SPECS[instance.vmSize] ?? { cpuCores: 2, memoryGB: 8 };

  const disks: NormalizedDisk[] = [];
  if (instance.storageProfile?.osDisk) {
    disks.push({
      id: instance.storageProfile.osDisk.managedDiskId ?? "os-disk",
      name: instance.storageProfile.osDisk.name,
      sizeGB: instance.storageProfile.osDisk.diskSizeGB ?? 30,
      type: "ssd",
      encrypted: false,
      isBootDisk: true,
    });
  }
  for (const dd of instance.storageProfile?.dataDisks ?? []) {
    disks.push({
      id: dd.managedDiskId ?? `data-disk-${dd.lun}`,
      name: dd.name,
      sizeGB: dd.diskSizeGB,
      type: "ssd",
      encrypted: false,
      isBootDisk: false,
    });
  }

  const networkInterfaces: NormalizedNetworkInterface[] = (instance.networkInterfaces ?? []).map((ni) => ({
    id: ni.id,
    privateIp: ni.privateIPAddress,
    publicIp: ni.publicIPAddress,
    subnetId: ni.subnetId,
    securityGroupIds: ni.networkSecurityGroupId ? [ni.networkSecurityGroupId] : [],
    macAddress: ni.macAddress,
  }));

  return {
    id: instance.id,
    name: instance.name,
    provider: "azure",
    region: instance.location,
    cpuCores: specs.cpuCores,
    memoryGB: specs.memoryGB,
    osType: instance.osType === "Windows" ? "windows" : "linux",
    architecture: "x86_64",
    disks,
    networkInterfaces,
    tags: instance.tags ?? {},
    raw: instance as unknown as Record<string, unknown>,
  };
}

/**
 * Normalize a GCP Compute instance to NormalizedVM.
 */
export function normalizeGcpInstance(instance: GcpComputeInstance): NormalizedVM {
  const specs = parseGcpMachineType(instance.machineType);
  const region = extractGcpRegion(instance.zone);

  const disks: NormalizedDisk[] = (instance.disks ?? []).map((d, i) => ({
    id: d.source,
    name: d.deviceName ?? `disk-${i}`,
    sizeGB: d.diskSizeGb ?? 0,
    type: d.type === "PERSISTENT" ? "ssd" : "standard",
    encrypted: false,
    isBootDisk: d.boot,
    devicePath: d.deviceName,
  }));

  const networkInterfaces: NormalizedNetworkInterface[] = (instance.networkInterfaces ?? []).map((ni, i) => ({
    id: ni.name ?? `nic-${i}`,
    privateIp: ni.networkIP,
    publicIp: ni.accessConfigs?.[0]?.natIP,
    subnetId: ni.subnetwork,
    securityGroupIds: [],
  }));

  // Detect OS from metadata
  let osType: "linux" | "windows" | "unknown" = "unknown";
  const osItem = instance.metadata?.items?.find((i) => i.key === "os-type" || i.key === "windows-startup-script-url");
  if (osItem?.key === "windows-startup-script-url") osType = "windows";
  else osType = "linux"; // Default to linux for GCP

  return {
    id: instance.name,
    name: instance.name,
    provider: "gcp",
    region,
    zone: instance.zone,
    cpuCores: specs.cpuCores,
    memoryGB: specs.memoryGB,
    osType,
    architecture: "x86_64",
    disks,
    networkInterfaces,
    tags: instance.labels ?? {},
    raw: instance as unknown as Record<string, unknown>,
  };
}

/**
 * Universal normalizer — detects provider and dispatches.
 */
export function normalizeVM(
  instance: EC2Instance | AzureVMInstance | GcpComputeInstance,
  provider: MigrationProvider,
): NormalizedVM {
  switch (provider) {
    case "aws":
      return normalizeEC2Instance(instance as EC2Instance);
    case "azure":
      return normalizeAzureVM(instance as AzureVMInstance);
    case "gcp":
      return normalizeGcpInstance(instance as GcpComputeInstance);
    default:
      throw new Error(`Unsupported compute provider: ${provider}`);
  }
}
