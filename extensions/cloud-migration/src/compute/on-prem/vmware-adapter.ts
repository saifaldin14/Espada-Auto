/**
 * On-Prem — VMware Adapter
 *
 * Adapter for VMware vSphere environments. Translates vSphere API
 * concepts (datacenter, cluster, datastore, ESXi host) into the
 * normalized VM model for migration.
 */

import type { NormalizedVM, NormalizedDisk, NormalizedNetworkInterface, MigrationProvider } from "../../types.js";
import type { AgentVMInfo } from "./agent-protocol.js";

// =============================================================================
// VMware-Specific Types
// =============================================================================

export interface VSphereConnection {
  vcenterHost: string;
  username: string;
  password: string;
  datacenter?: string;
  cluster?: string;
  insecure?: boolean;
}

export interface VSphereVM {
  moRef: string; // Managed Object Reference (e.g. "vm-123")
  name: string;
  guestId: string;
  guestFullName: string;
  numCPU: number;
  memoryMB: number;
  powerState: "poweredOn" | "poweredOff" | "suspended";
  host: string;
  cluster: string;
  datacenter: string;
  resourcePool: string;
  folder: string;
  disks: VSphereVMDisk[];
  nics: VSphereVMNic[];
  annotation?: string;
  tags: Array<{ category: string; name: string }>;
}

export interface VSphereVMDisk {
  key: number;
  label: string;
  capacityGB: number;
  thinProvisioned: boolean;
  datastore: string;
  fileName: string; // [datastore] path/to/file.vmdk
  diskMode: "persistent" | "independent_persistent" | "independent_nonpersistent";
  controllerType: "scsi" | "nvme" | "sata" | "ide";
}

export interface VSphereVMNic {
  key: number;
  label: string;
  macAddress: string;
  network: string;
  type: "vmxnet3" | "e1000e" | "e1000" | "sriov";
  connected: boolean;
  ipAddress?: string;
}

// =============================================================================
// Normalization
// =============================================================================

/**
 * Normalize a vSphere VM into the common model.
 */
export function normalizeVSphereVM(vm: VSphereVM): NormalizedVM {
  const disks: NormalizedDisk[] = vm.disks.map((d, i) => ({
    id: `${vm.moRef}-disk-${d.key}`,
    name: d.label,
    sizeGB: d.capacityGB,
    type: d.thinProvisioned ? "ssd" as const : "hdd" as const,
    iops: 0,
    encrypted: false,
    isBootDisk: i === 0,
  }));

  const tags: Record<string, string> = {};
  for (const tag of vm.tags) {
    tags[tag.category] = tag.name;
  }

  const networkInterfaces: NormalizedNetworkInterface[] = vm.nics.map((n) => ({
    id: `${vm.moRef}-nic-${n.key}`,
    privateIp: n.ipAddress ?? "",
    subnetId: n.network,
    securityGroupIds: [],
    macAddress: n.macAddress,
  }));

  return {
    id: vm.moRef,
    name: vm.name,
    provider: "vmware",
    region: vm.datacenter,
    cpuCores: vm.numCPU,
    memoryGB: Math.round(vm.memoryMB / 1024),
    architecture: "x86_64",
    osType: mapGuestIdToOSType(vm.guestId),
    osDistro: mapGuestIdToOS(vm.guestId),
    disks,
    networkInterfaces,
    tags,
  };
}

/**
 * Normalize an agent-reported VM into the common model.
 */
export function normalizeAgentVM(vm: AgentVMInfo): NormalizedVM {
  const disks: NormalizedDisk[] = vm.disks.map((d, i) => ({
    id: d.id,
    name: `disk-${i}`,
    sizeGB: d.sizeGB,
    type: "hdd" as const,
    iops: 0,
    encrypted: false,
    isBootDisk: i === 0,
  }));

  const networkInterfaces: NormalizedNetworkInterface[] = vm.nics.map((n) => ({
    id: n.id,
    privateIp: n.ipAddress ?? "",
    subnetId: n.network,
    securityGroupIds: [],
    macAddress: n.macAddress,
  }));

  const osInfo = vm.guestOS ?? "linux";
  return {
    id: vm.id,
    name: vm.name,
    provider: vm.hypervisor,
    region: vm.datacenter ?? "unknown",
    cpuCores: vm.vcpus,
    memoryGB: Math.round(vm.memoryMB / 1024),
    architecture: "x86_64",
    osType: osInfo.includes("windows") ? "windows" : "linux",
    osDistro: osInfo,
    disks,
    networkInterfaces,
    tags: vm.tags ?? {},
  };
}

// =============================================================================
// Instance Type Matching
// =============================================================================

/**
 * Best-effort matching of VMware VM specs to the closest cloud instance type.
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
  // General purpose sizing ladder
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

function mapGuestIdToOSType(guestId: string): "linux" | "windows" | "unknown" {
  const lower = guestId.toLowerCase();
  if (lower.includes("windows")) return "windows";
  if (lower.includes("linux") || lower.includes("ubuntu") || lower.includes("centos") ||
      lower.includes("rhel") || lower.includes("debian") || lower.includes("suse")) return "linux";
  return "unknown";
}

function mapGuestIdToOS(guestId: string): string {
  const lower = guestId.toLowerCase();
  if (lower.includes("ubuntu")) return "ubuntu";
  if (lower.includes("centos")) return "centos";
  if (lower.includes("rhel") || lower.includes("redhat")) return "rhel";
  if (lower.includes("debian")) return "debian";
  if (lower.includes("suse") || lower.includes("sles")) return "sles";
  if (lower.includes("windows")) return "windows";
  if (lower.includes("linux")) return "linux";
  return "unknown";
}
