/**
 * Cross-Cloud Migration Engine — Compute Normalizer Tests
 */
import { describe, it, expect } from "vitest";

import {
  normalizeEC2Instance,
  normalizeAzureVM,
  normalizeGcpInstance,
  type EC2Instance,
  type AzureVMInstance,
  type GcpComputeInstance,
} from "../src/compute/normalizer.js";

describe("compute/normalizer", () => {
  describe("normalizeEC2Instance", () => {
    it("normalizes a basic EC2 instance", () => {
      const ec2: EC2Instance = {
        instanceId: "i-12345",
        instanceType: "t3.large",
        platform: "linux",
        placement: { availabilityZone: "us-east-1a" },
        tags: [{ Key: "Name", Value: "web-server" }],
      };

      const vm = normalizeEC2Instance(ec2);
      expect(vm.provider).toBe("aws");
      expect(vm.id).toBe("i-12345");
      expect(vm.name).toBe("web-server");
      expect(vm.cpuCores).toBe(2);
      expect(vm.memoryGB).toBe(8);
      expect(vm.osType).toBe("linux");
    });

    it("handles unknown instance type gracefully", () => {
      const ec2: EC2Instance = {
        instanceId: "i-99999",
        instanceType: "x99.unknown",
      };

      const vm = normalizeEC2Instance(ec2);
      expect(vm.provider).toBe("aws");
      expect(typeof vm.cpuCores).toBe("number");
      expect(typeof vm.memoryGB).toBe("number");
    });

    it("preserves tags", () => {
      const ec2: EC2Instance = {
        instanceId: "i-100",
        instanceType: "m5.large",
        tags: [
          { Key: "Environment", Value: "prod" },
          { Key: "Team", Value: "platform" },
        ],
      };

      const vm = normalizeEC2Instance(ec2);
      expect(vm.tags.Environment).toBe("prod");
      expect(vm.tags.Team).toBe("platform");
    });
  });

  describe("normalizeAzureVM", () => {
    it("normalizes an Azure VM", () => {
      const azure: AzureVMInstance = {
        id: "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
        name: "api-server",
        location: "eastus",
        vmSize: "Standard_D2s_v3",
        osType: "linux",
        tags: { App: "api" },
      };

      const vm = normalizeAzureVM(azure);
      expect(vm.provider).toBe("azure");
      expect(vm.region).toBe("eastus");
      expect(vm.name).toBe("api-server");
      expect(vm.cpuCores).toBe(2);
      expect(vm.memoryGB).toBe(8);
    });
  });

  describe("normalizeGcpInstance", () => {
    it("normalizes a GCP compute instance", () => {
      const gcp: GcpComputeInstance = {
        name: "gcp-vm-1",
        zone: "us-central1-a",
        machineType: "n1-standard-4",
        labels: { env: "staging" },
      };

      const vm = normalizeGcpInstance(gcp);
      expect(vm.provider).toBe("gcp");
      expect(vm.id).toBe("gcp-vm-1");
      expect(vm.name).toBe("gcp-vm-1");
      expect(typeof vm.cpuCores).toBe("number");
      expect(typeof vm.memoryGB).toBe("number");
      expect(vm.tags.env).toBe("staging");
    });
  });
});
