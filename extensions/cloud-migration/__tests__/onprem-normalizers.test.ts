/**
 * Cross-Cloud Migration Engine — On-Prem Compute Normalizer Tests
 *
 * Tests for Nutanix VM normalization, cloud instance type matching,
 * and on-prem data normalizers.
 */
import { describe, it, expect } from "vitest";

import {
  normalizeNutanixVM,
  matchCloudInstanceType,
  type NutanixVMInfo,
  type NutanixDisk,
  type NutanixNic,
} from "../src/compute/on-prem/nutanix-adapter.js";

import {
  normalizeOnPremBucket,
  normalizeBucket,
  type OnPremBucketInfo,
} from "../src/data/normalizer.js";

// =============================================================================
// Helpers
// =============================================================================

function makeNutanixVM(overrides?: Partial<NutanixVMInfo>): NutanixVMInfo {
  return {
    uuid: "ntx-vm-001",
    name: "prod-db-1",
    clusterUuid: "cluster-001",
    clusterName: "US-EAST-DC1",
    numVcpus: 8,
    memoryMB: 32768,
    powerState: "ON",
    hostUuid: "host-001",
    hostName: "ahv-host-1",
    disks: [
      { uuid: "d-1", deviceIndex: 0, diskSizeMib: 102400, storageContainerUuid: "sc-1", storageContainerName: "default-sc", deviceBus: "scsi", deviceType: "disk" },
      { uuid: "d-2", deviceIndex: 1, diskSizeMib: 512000, storageContainerUuid: "sc-1", storageContainerName: "default-sc", deviceBus: "scsi", deviceType: "disk" },
    ],
    nics: [
      { uuid: "n-1", macAddress: "00:11:22:33:44:55", subnetUuid: "sub-1", subnetName: "vlan100", ipAddress: "10.0.1.50", isConnected: true, nicType: "NORMAL_NIC" },
    ],
    guestOS: "CentOS 7.9",
    categories: { environment: "production", team: "database" },
    ...overrides,
  };
}

// =============================================================================
// normalizeNutanixVM
// =============================================================================

describe("compute/on-prem/nutanix-adapter", () => {
  describe("normalizeNutanixVM", () => {
    it("normalizes a basic Nutanix VM", () => {
      const vm = normalizeNutanixVM(makeNutanixVM());
      expect(vm.id).toBe("ntx-vm-001");
      expect(vm.name).toBe("prod-db-1");
      expect(vm.provider).toBe("nutanix");
      expect(vm.region).toBe("US-EAST-DC1");
      expect(vm.cpuCores).toBe(8);
      expect(vm.memoryGB).toBe(32);
      expect(vm.architecture).toBe("x86_64");
      expect(vm.osType).toBe("linux");
      expect(vm.osDistro).toBe("CentOS 7.9");
    });

    it("converts disk sizes from MiB to GB (ceiling)", () => {
      const vm = normalizeNutanixVM(makeNutanixVM());
      expect(vm.disks.length).toBe(2);
      expect(vm.disks[0].sizeGB).toBe(100); // 102400 MiB / 1024 = 100
      expect(vm.disks[1].sizeGB).toBe(500); // 512000 MiB / 1024 = 500
    });

    it("marks first disk as boot disk", () => {
      const vm = normalizeNutanixVM(makeNutanixVM());
      expect(vm.disks[0].isBootDisk).toBe(true);
      expect(vm.disks[1].isBootDisk).toBe(false);
    });

    it("filters out CDROM devices", () => {
      const nutanixDisk: NutanixDisk = {
        uuid: "d-cdrom", deviceIndex: 2, diskSizeMib: 0,
        deviceBus: "ide", deviceType: "cdrom",
      };
      const vm = normalizeNutanixVM(makeNutanixVM({
        disks: [...makeNutanixVM().disks, nutanixDisk],
      }));
      expect(vm.disks.length).toBe(2); // CDROM filtered out
    });

    it("maps PCI bus devices as NVMe type", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({
        disks: [{
          uuid: "d-pci", deviceIndex: 0, diskSizeMib: 51200,
          deviceBus: "pci", deviceType: "disk",
        }],
      }));
      expect(vm.disks[0].type).toBe("nvme");
    });

    it("maps SCSI bus devices as SSD type", () => {
      const vm = normalizeNutanixVM(makeNutanixVM());
      expect(vm.disks[0].type).toBe("ssd");
    });

    it("normalizes network interfaces", () => {
      const vm = normalizeNutanixVM(makeNutanixVM());
      expect(vm.networkInterfaces.length).toBe(1);
      expect(vm.networkInterfaces[0].privateIp).toBe("10.0.1.50");
      expect(vm.networkInterfaces[0].macAddress).toBe("00:11:22:33:44:55");
      expect(vm.networkInterfaces[0].subnetId).toBe("sub-1");
    });

    it("handles NIC without IP address", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({
        nics: [{
          uuid: "n-2", macAddress: "AA:BB:CC:DD:EE:FF",
          isConnected: true, nicType: "NORMAL_NIC",
        }],
      }));
      expect(vm.networkInterfaces[0].privateIp).toBe("");
    });

    it("preserves Nutanix categories as tags", () => {
      const vm = normalizeNutanixVM(makeNutanixVM());
      expect(vm.tags.environment).toBe("production");
      expect(vm.tags.team).toBe("database");
    });

    it("detects Windows guest OS", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ guestOS: "Windows Server 2019" }));
      expect(vm.osType).toBe("windows");
    });

    it("detects various Linux distributions", () => {
      const distros = ["Ubuntu 22.04", "RHEL 8", "Debian 11", "SUSE 15", "CentOS Stream 9"];
      for (const distro of distros) {
        const vm = normalizeNutanixVM(makeNutanixVM({ guestOS: distro }));
        expect(vm.osType).toBe("linux");
      }
    });

    it("returns unknown for unrecognized OS", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ guestOS: "FreeBSD 13.2" }));
      expect(vm.osType).toBe("unknown");
    });

    it("returns unknown when guestOS is undefined", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ guestOS: undefined }));
      expect(vm.osType).toBe("unknown");
    });

    it("handles VM with no disks", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ disks: [] }));
      expect(vm.disks).toEqual([]);
    });

    it("handles VM with no NICs", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ nics: [] }));
      expect(vm.networkInterfaces).toEqual([]);
    });

    it("rounds memory correctly", () => {
      // 16000 MB → 16 GB (rounded)
      const vm = normalizeNutanixVM(makeNutanixVM({ memoryMB: 16000 }));
      expect(vm.memoryGB).toBe(16);
    });
  });

  // =============================================================================
  // matchCloudInstanceType
  // =============================================================================

  describe("matchCloudInstanceType", () => {
    it("matches a small VM to t3.micro on AWS", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 1, memoryMB: 1024 }));
      expect(matchCloudInstanceType(vm, "aws")).toBe("t3.micro");
    });

    it("matches a medium VM to m5.xlarge on AWS", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 4, memoryMB: 16384 }));
      expect(matchCloudInstanceType(vm, "aws")).toBe("m5.xlarge");
    });

    it("matches a large VM to m5.8xlarge on AWS", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 32, memoryMB: 131072 }));
      expect(matchCloudInstanceType(vm, "aws")).toBe("m5.8xlarge");
    });

    it("returns the largest AWS type for very large VMs", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 96, memoryMB: 393216 }));
      expect(matchCloudInstanceType(vm, "aws")).toBe("m5.24xlarge");
    });

    it("matches to Azure Standard_B1s for small VMs", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 1, memoryMB: 1024 }));
      expect(matchCloudInstanceType(vm, "azure")).toBe("Standard_B1s");
    });

    it("matches to Azure Standard_D8s_v5 for 8-core VMs", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 8, memoryMB: 32768 }));
      expect(matchCloudInstanceType(vm, "azure")).toBe("Standard_D8s_v5");
    });

    it("matches to GCP e2-micro for tiny VMs", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 1, memoryMB: 1024 }));
      expect(matchCloudInstanceType(vm, "gcp")).toBe("e2-micro");
    });

    it("matches to GCP n2-standard-8 for 8-core VMs", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 8, memoryMB: 32768 }));
      expect(matchCloudInstanceType(vm, "gcp")).toBe("n2-standard-8");
    });

    it("returns custom type for unsupported cloud targets", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 4, memoryMB: 8192 }));
      const result = matchCloudInstanceType(vm, "on-premises");
      expect(result).toMatch(/^custom-/);
    });

    it("returns custom type for vmware target", () => {
      const vm = normalizeNutanixVM(makeNutanixVM({ numVcpus: 4, memoryMB: 8192 }));
      const result = matchCloudInstanceType(vm, "vmware");
      expect(result).toMatch(/^custom-/);
    });
  });
});

// =============================================================================
// On-Prem Data Normalizer Tests
// =============================================================================

describe("data/normalizer — on-prem", () => {
  describe("normalizeOnPremBucket", () => {
    it("normalizes a basic on-prem bucket", () => {
      const bucket: OnPremBucketInfo = {
        name: "staging-data",
        endpoint: "https://minio.internal:9000",
        region: "dc1",
        versioning: true,
        objectCount: 5000,
        totalSizeBytes: 1024 * 1024 * 1024 * 100,
        tags: { purpose: "migration" },
      };
      const result = normalizeOnPremBucket(bucket, "on-premises");
      expect(result.id).toBe("on-premises:staging-data");
      expect(result.name).toBe("staging-data");
      expect(result.provider).toBe("on-premises");
      expect(result.region).toBe("dc1");
      expect(result.versioning).toBe(true);
      expect(result.objectCount).toBe(5000);
      expect(result.encryption.type).toBe("none");
      expect(result.tags.purpose).toBe("migration");
    });

    it("defaults region to on-premises when not specified", () => {
      const bucket: OnPremBucketInfo = {
        name: "test-bucket",
        endpoint: "https://minio.internal:9000",
      };
      const result = normalizeOnPremBucket(bucket, "on-premises");
      expect(result.region).toBe("on-premises");
    });

    it("defaults versioning to false", () => {
      const bucket: OnPremBucketInfo = {
        name: "test-bucket",
        endpoint: "https://minio.internal:9000",
      };
      const result = normalizeOnPremBucket(bucket, "on-premises");
      expect(result.versioning).toBe(false);
    });

    it("defaults objectCount and totalSizeBytes to 0", () => {
      const bucket: OnPremBucketInfo = {
        name: "test-bucket",
        endpoint: "https://minio.internal:9000",
      };
      const result = normalizeOnPremBucket(bucket, "on-premises");
      expect(result.objectCount).toBe(0);
      expect(result.totalSizeBytes).toBe(0);
    });

    it("defaults tags to empty", () => {
      const bucket: OnPremBucketInfo = {
        name: "test-bucket",
        endpoint: "https://minio.internal:9000",
      };
      const result = normalizeOnPremBucket(bucket, "on-premises");
      expect(result.tags).toEqual({});
    });

    it("works with vmware provider", () => {
      const bucket: OnPremBucketInfo = {
        name: "vmware-staging",
        endpoint: "https://minio.vmware.internal:9000",
      };
      const result = normalizeOnPremBucket(bucket, "vmware");
      expect(result.provider).toBe("vmware");
      expect(result.id).toBe("vmware:vmware-staging");
    });

    it("works with nutanix provider", () => {
      const bucket: OnPremBucketInfo = {
        name: "nutanix-objects",
        endpoint: "https://objects.nutanix.internal",
      };
      const result = normalizeOnPremBucket(bucket, "nutanix");
      expect(result.provider).toBe("nutanix");
      expect(result.id).toBe("nutanix:nutanix-objects");
    });
  });

  describe("normalizeBucket dispatcher — on-prem paths", () => {
    it("dispatches on-premises to normalizeOnPremBucket", () => {
      const bucket: OnPremBucketInfo = { name: "b1", endpoint: "https://s3.local" };
      const result = normalizeBucket(bucket, "on-premises");
      expect(result.provider).toBe("on-premises");
    });

    it("dispatches vmware to normalizeOnPremBucket", () => {
      const bucket: OnPremBucketInfo = { name: "b2", endpoint: "https://s3.vmw" };
      const result = normalizeBucket(bucket, "vmware");
      expect(result.provider).toBe("vmware");
    });

    it("dispatches nutanix to normalizeOnPremBucket", () => {
      const bucket: OnPremBucketInfo = { name: "b3", endpoint: "https://obj.ntx" };
      const result = normalizeBucket(bucket, "nutanix");
      expect(result.provider).toBe("nutanix");
    });
  });
});
