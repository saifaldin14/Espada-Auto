/**
 * On-Prem — Nutanix Adapter
 *
 * Normalizes Nutanix Prism v3 API responses into the standard
 * NormalizedVM model, and provides instance type matching for
 * cloud migration targets.
 */

import type { NormalizedVM, NormalizedDisk, NormalizedNetworkInterface, MigrationProvider } from "../../types.js";

// =============================================================================
// Nutanix-Specific Types (Prism v3 API shapes)
// =============================================================================

export interface NutanixVMInfo {
  uuid: string;
  name: string;
  clusterUuid: string;
  clusterName: string;
  numVcpus: number;
  memoryMB: number;
  powerState: "ON" | "OFF" | "PAUSED" | "SUSPENDED";
  hostUuid?: string;
  hostName?: string;
  disks: NutanixDisk[];
  nics: NutanixNic[];
  guestOS?: string;
  description?: string;
  categories: Record<string, string>;
}

export interface NutanixDisk {
  uuid: string;
  deviceIndex: number;
  diskSizeMib: number;
  storageContainerUuid?: string;
  storageContainerName?: string;
  deviceBus: "scsi" | "ide" | "pci" | "sata" | "spapr";
  deviceType: "disk" | "cdrom";
  adapterType?: string;
}

export interface NutanixNic {
  uuid: string;
  macAddress: string;
  subnetUuid?: string;
  subnetName?: string;
  ipAddress?: string;
  isConnected: boolean;
  nicType: "NORMAL_NIC" | "DIRECT_NIC" | "NETWORK_FUNCTION_NIC";
}

// =============================================================================
// Normalization
// =============================================================================

/**
 * Normalize a Nutanix Prism v3 VM into the common model.
 */
export function normalizeNutanixVM(vm: NutanixVMInfo): NormalizedVM {
  const disks: NormalizedDisk[] = vm.disks
    .filter((d) => d.deviceType === "disk")
    .map((d, i) => ({
      id: d.uuid,
      name: `disk-${d.deviceIndex}`,
      sizeGB: Math.ceil(d.diskSizeMib / 1024),
      type: d.deviceBus === "pci" ? ("nvme" as const) : ("ssd" as const),
      iops: 0,
      encrypted: false,
      isBootDisk: i === 0,
    }));

  const networkInterfaces: NormalizedNetworkInterface[] = vm.nics.map((n) => ({
    id: n.uuid,
    privateIp: n.ipAddress ?? "",
    subnetId: n.subnetUuid,
    securityGroupIds: [],
    macAddress: n.macAddress,
  }));

  const tags: Record<string, string> = { ...vm.categories };

  return {
    id: vm.uuid,
    name: vm.name,
    provider: "nutanix",
    region: vm.clusterName,
    cpuCores: vm.numVcpus,
    memoryGB: Math.round(vm.memoryMB / 1024),
    architecture: "x86_64",
    osType: mapNutanixGuestOS(vm.guestOS),
    osDistro: vm.guestOS,
    disks,
    networkInterfaces,
    tags,
  };
}

// =============================================================================
// Instance Type Matching
// =============================================================================

/**
 * Best-effort matching of Nutanix VM specs to the closest cloud instance type.
 * Reuses the same sizing ladder logic as the VMware adapter.
 */
export function matchCloudInstanceType(
  vm: NormalizedVM,
  targetProvider: MigrationProvider,
): string {
  const cores = vm.cpuCores;
  const memGB = vm.memoryGB;

  if (targetProvider === "aws") {
    return matchAWSInstanceType(cores, memGB);
  }
  if (targetProvider === "azure") {
    return matchAzureInstanceType(cores, memGB);
  }
  if (targetProvider === "gcp") {
    return matchGCPInstanceType(cores, memGB);
  }
  return `custom-${cores}-${memGB * 1024}`;
}

function matchAWSInstanceType(vcpus: number, memGB: number): string {
  if (vcpus <= 1 && memGB <= 1) return "t3.micro";
  if (vcpus <= 1 && memGB <= 2) return "t3.small";
  if (vcpus <= 2 && memGB <= 4) return "t3.medium";
  if (vcpus <= 2 && memGB <= 8) return "t3.large";
  if (vcpus <= 4 && memGB <= 16) return "m5.xlarge";
  if (vcpus <= 8 && memGB <= 32) return "m5.2xlarge";
  if (vcpus <= 16 && memGB <= 64) return "m5.4xlarge";
  if (vcpus <= 32 && memGB <= 128) return "m5.8xlarge";
  if (vcpus <= 48 && memGB <= 192) return "m5.12xlarge";
  if (vcpus <= 64 && memGB <= 256) return "m5.16xlarge";
  return "m5.24xlarge";
}

function matchAzureInstanceType(vcpus: number, memGB: number): string {
  if (vcpus <= 1 && memGB <= 2) return "Standard_B1s";
  if (vcpus <= 2 && memGB <= 4) return "Standard_B2s";
  if (vcpus <= 2 && memGB <= 8) return "Standard_D2s_v5";
  if (vcpus <= 4 && memGB <= 16) return "Standard_D4s_v5";
  if (vcpus <= 8 && memGB <= 32) return "Standard_D8s_v5";
  if (vcpus <= 16 && memGB <= 64) return "Standard_D16s_v5";
  if (vcpus <= 32 && memGB <= 128) return "Standard_D32s_v5";
  if (vcpus <= 48 && memGB <= 192) return "Standard_D48s_v5";
  if (vcpus <= 64 && memGB <= 256) return "Standard_D64s_v5";
  return "Standard_D96s_v5";
}

function matchGCPInstanceType(vcpus: number, memGB: number): string {
  if (vcpus <= 1 && memGB <= 1) return "e2-micro";
  if (vcpus <= 1 && memGB <= 2) return "e2-small";
  if (vcpus <= 2 && memGB <= 4) return "e2-medium";
  if (vcpus <= 2 && memGB <= 8) return "n2-standard-2";
  if (vcpus <= 4 && memGB <= 16) return "n2-standard-4";
  if (vcpus <= 8 && memGB <= 32) return "n2-standard-8";
  if (vcpus <= 16 && memGB <= 64) return "n2-standard-16";
  if (vcpus <= 32 && memGB <= 128) return "n2-standard-32";
  if (vcpus <= 48 && memGB <= 192) return "n2-standard-48";
  if (vcpus <= 64 && memGB <= 256) return "n2-standard-64";
  return "n2-standard-96";
}

// =============================================================================
// Helpers
// =============================================================================

function mapNutanixGuestOS(guestOS?: string): "linux" | "windows" | "unknown" {
  if (!guestOS) return "unknown";
  const lower = guestOS.toLowerCase();
  if (lower.includes("windows")) return "windows";
  if (lower.includes("linux") || lower.includes("ubuntu") || lower.includes("centos") ||
      lower.includes("rhel") || lower.includes("debian") || lower.includes("suse")) return "linux";
  return "unknown";
}
