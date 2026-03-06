/**
 * Cross-Cloud Migration Engine — On-Prem Network & Boot Remediation Tests
 *
 * Tests on-prem paths in:
 * - Security rule translator (on-prem/vmware/nutanix source and target)
 * - DNS migrator with on-prem zones
 * - Boot remediator for on-prem/vmware/nutanix targets
 * - Storage class mappings for on-prem directions
 */
import { describe, it, expect } from "vitest";

import {
  translateRule,
  translateSecurityGroup,
} from "../src/network/rule-translator.js";

import {
  planDNSMigration,
  validateDNSPlan,
} from "../src/network/dns-migrator.js";

import {
  getRemediationRecipe,
  generateLinuxRemediationScript,
  needsRemediation,
  getRemediationSummary,
} from "../src/compute/boot-remediator.js";

import { mapStorageClass, STORAGE_CLASS_MAP } from "../src/data/types.js";

import type { NormalizedSecurityRule, NormalizedDNSRecord } from "../src/types.js";
import type { DNSZone } from "../src/network/types.js";

// =============================================================================
// Security Rule Translator — On-Prem Paths
// =============================================================================

describe("network/rule-translator — on-prem paths", () => {
  const sampleRule: NormalizedSecurityRule = {
    id: "rule-1",
    name: "allow-ssh",
    direction: "inbound",
    action: "allow",
    protocol: "tcp",
    portRange: { from: 22, to: 22 },
    source: { type: "cidr", value: "10.0.0.0/8" },
    destination: { type: "cidr", value: "10.1.0.0/24" },
    priority: 100,
  };

  describe("translateRule with on-prem source", () => {
    it("translates on-premises → aws", () => {
      const result = translateRule(sampleRule, "on-premises", "aws");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.portRange.from).toBe(22);
      expect(result.targetRule.portRange.to).toBe(22);
    });

    it("translates on-premises → azure", () => {
      const result = translateRule(sampleRule, "on-premises", "azure");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.direction).toBe("inbound");
    });

    it("translates on-premises → gcp", () => {
      const result = translateRule(sampleRule, "on-premises", "gcp");
      expect(result.targetRule).toBeDefined();
    });

    it("translates vmware → aws", () => {
      const result = translateRule(sampleRule, "vmware", "aws");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.action).toBe("allow");
    });

    it("translates nutanix → azure", () => {
      const result = translateRule(sampleRule, "nutanix", "azure");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.protocol).toBeDefined();
    });
  });

  describe("translateRule with on-prem target", () => {
    it("translates aws → on-premises", () => {
      const result = translateRule(sampleRule, "aws", "on-premises");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.portRange).toEqual({ from: 22, to: 22 });
    });

    it("translates azure → vmware", () => {
      const result = translateRule(sampleRule, "azure", "vmware");
      expect(result.targetRule).toBeDefined();
    });

    it("translates gcp → nutanix", () => {
      const result = translateRule(sampleRule, "gcp", "nutanix");
      expect(result.targetRule).toBeDefined();
    });
  });

  describe("translateRule — on-prem to on-prem", () => {
    it("translates vmware → nutanix", () => {
      const result = translateRule(sampleRule, "vmware", "nutanix");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.portRange).toEqual({ from: 22, to: 22 });
    });

    it("translates nutanix → on-premises", () => {
      const result = translateRule(sampleRule, "nutanix", "on-premises");
      expect(result.targetRule).toBeDefined();
    });
  });

  describe("translateRule — protocol translation for on-prem", () => {
    it("preserves tcp protocol for on-prem → aws", () => {
      const result = translateRule(sampleRule, "on-premises", "aws");
      // On-prem 'tcp' → AWS numeric '6'
      expect(result.targetRule.protocol).toBeDefined();
    });

    it("handles all-ports rule translation to GCP", () => {
      const allPortsRule: NormalizedSecurityRule = {
        ...sampleRule,
        portRange: { from: -1, to: -1 },
      };
      const result = translateRule(allPortsRule, "on-premises", "gcp");
      expect(result.targetRule.portRange.from).toBe(0);
      expect(result.targetRule.portRange.to).toBe(65535);
    });
  });

  describe("translateSecurityGroup with on-prem", () => {
    it("translates an entire security group from vmware → aws", () => {
      const rules: NormalizedSecurityRule[] = [
        sampleRule,
        { ...sampleRule, id: "rule-2", name: "allow-https", portRange: { from: 443, to: 443 } },
      ];
      const result = translateSecurityGroup({
        groupId: "sg-vmw-1",
        groupName: "web-tier",
        rules,
        sourceProvider: "vmware",
        targetProvider: "aws",
      });

      expect(result.rules.length).toBe(2);
      expect(result.targetGroupName).toBe("web-tier-migrated");
      expect(result.targetProvider).toBe("aws");
    });
  });
});

// =============================================================================
// DNS Migrator — On-Prem Paths
// =============================================================================

describe("network/dns-migrator — on-prem paths", () => {
  function makeZone(provider: string = "on-premises"): DNSZone {
    return {
      id: "zone-1",
      name: "internal.example.com",
      provider: provider as any,
      type: "private",
      records: [
        { name: "app.internal.example.com", type: "A", ttl: 300, values: ["10.0.1.5"] },
        { name: "db.internal.example.com", type: "A", ttl: 300, values: ["10.0.1.10"] },
        { name: "mail.internal.example.com", type: "MX", ttl: 3600, values: ["10 smtp.internal.example.com"] },
        { name: "internal.example.com", type: "NS", ttl: 86400, values: ["ns1.internal.example.com"] },
        { name: "app.internal.example.com", type: "TXT", ttl: 300, values: ["v=spf1 include:example.com ~all"] },
      ],
      nameServers: ["ns1.internal.example.com"],
    };
  }

  describe("planDNSMigration from on-prem to cloud", () => {
    it("plans migration from on-prem to AWS", () => {
      const plan = planDNSMigration({
        sourceZone: makeZone("on-premises"),
        targetProvider: "aws",
      });

      expect(plan.targetProvider).toBe("aws");
      expect(plan.recordsToCreate.length).toBeGreaterThan(0);
    });

    it("skips NS records at zone apex", () => {
      const plan = planDNSMigration({
        sourceZone: makeZone("on-premises"),
        targetProvider: "aws",
      });

      const skippedNS = plan.recordsToSkip.find(
        (s) => s.record.type === "NS" && s.record.name === "internal.example.com",
      );
      expect(skippedNS).toBeDefined();
    });

    it("applies IP mappings for A records", () => {
      const plan = planDNSMigration({
        sourceZone: makeZone("on-premises"),
        targetProvider: "aws",
        ipMappings: { "10.0.1.5": "54.123.45.67" },
      });

      const updated = plan.recordsToUpdate.find((u) => u.oldValue === "10.0.1.5");
      expect(updated).toBeDefined();
      expect(updated!.newValue).toBe("54.123.45.67");
    });

    it("handles VMware source zone", () => {
      const plan = planDNSMigration({
        sourceZone: makeZone("vmware"),
        targetProvider: "azure",
      });

      expect(plan.recordsToCreate.length).toBeGreaterThan(0);
    });

    it("handles Nutanix source zone", () => {
      const plan = planDNSMigration({
        sourceZone: makeZone("nutanix"),
        targetProvider: "gcp",
      });

      expect(plan.recordsToCreate.length).toBeGreaterThan(0);
    });
  });

  describe("planDNSMigration from cloud to on-prem", () => {
    it("plans migration from AWS to on-premises", () => {
      const zone: DNSZone = {
        id: "aws-zone-1",
        name: "example.com",
        provider: "aws",
        type: "public",
        records: [
          { name: "www.example.com", type: "A", ttl: 300, values: ["1.2.3.4"] },
          { name: "api.example.com", type: "CNAME", ttl: 300, values: ["lb.example.com"] },
        ],
        nameServers: ["ns-1.awsdns-01.com"],
      };

      const plan = planDNSMigration({
        sourceZone: zone,
        targetProvider: "on-premises",
      });

      expect(plan.recordsToCreate.length).toBeGreaterThan(0);
    });
  });

  describe("validateDNSPlan with on-prem", () => {
    it("validates an on-prem to cloud plan", () => {
      const plan = planDNSMigration({
        sourceZone: makeZone("on-premises"),
        targetProvider: "aws",
      });

      const validation = validateDNSPlan(plan);
      expect(validation.valid).toBeDefined();
      expect(Array.isArray(validation.errors)).toBe(true);
      expect(Array.isArray(validation.warnings)).toBe(true);
    });
  });
});

// =============================================================================
// Boot Remediator — On-Prem/VMware/Nutanix Targets
// =============================================================================

describe("compute/boot-remediator — on-prem targets", () => {
  describe("getRemediationRecipe", () => {
    it("returns recipe for on-premises target", () => {
      const recipe = getRemediationRecipe("on-premises");
      expect(recipe.targetProvider).toBe("on-premises");
      expect(recipe.installPackages).toContain("qemu-guest-agent");
      expect(recipe.kernelModules).toContain("virtio_blk");
      expect(recipe.kernelModules).toContain("virtio_net");
    });

    it("returns recipe for vmware target", () => {
      const recipe = getRemediationRecipe("vmware");
      expect(recipe.targetProvider).toBe("vmware");
      expect(recipe.installPackages).toContain("open-vm-tools");
      expect(recipe.kernelModules).toContain("vmw_pvscsi");
      expect(recipe.kernelModules).toContain("vmxnet3");
    });

    it("returns recipe for nutanix target", () => {
      const recipe = getRemediationRecipe("nutanix");
      expect(recipe.targetProvider).toBe("nutanix");
      expect(recipe.installPackages).toContain("qemu-guest-agent");
      expect(recipe.kernelModules).toContain("virtio_blk");
      expect(recipe.kernelModules).toContain("virtio_net");
      expect(recipe.kernelModules).toContain("virtio_scsi");
    });

    it("on-prem recipe removes cloud agents", () => {
      const recipe = getRemediationRecipe("on-premises");
      expect(recipe.removePackages).toContain("walinuxagent");
      expect(recipe.removePackages).toContain("google-guest-agent");
      expect(recipe.removePackages).toContain("aws-cfn-bootstrap");
    });

    it("vmware recipe removes cloud agents and qemu-guest-agent", () => {
      const recipe = getRemediationRecipe("vmware");
      expect(recipe.removePackages).toContain("walinuxagent");
      expect(recipe.removePackages).toContain("google-guest-agent");
      expect(recipe.removePackages).toContain("aws-cfn-bootstrap");
      expect(recipe.removePackages).toContain("qemu-guest-agent");
    });

    it("nutanix recipe removes cloud agents and open-vm-tools", () => {
      const recipe = getRemediationRecipe("nutanix");
      expect(recipe.removePackages).toContain("walinuxagent");
      expect(recipe.removePackages).toContain("google-guest-agent");
      expect(recipe.removePackages).toContain("open-vm-tools");
    });

    it("returns safe default for unknown provider", () => {
      const recipe = getRemediationRecipe("alien-cloud");
      expect(recipe.installPackages).toEqual([]);
      expect(recipe.removePackages).toEqual([]);
    });
  });

  describe("generateLinuxRemediationScript", () => {
    it("generates script for on-premises target", () => {
      const recipe = getRemediationRecipe("on-premises");
      const script = generateLinuxRemediationScript(recipe);
      expect(script).toContain("#!/bin/bash");
      expect(script).toContain("qemu-guest-agent");
      expect(script).toContain("virtio_blk");
    });

    it("generates script for vmware target", () => {
      const recipe = getRemediationRecipe("vmware");
      const script = generateLinuxRemediationScript(recipe);
      expect(script).toContain("open-vm-tools");
      expect(script).toContain("vmw_pvscsi");
      expect(script).toContain("vmxnet3");
      expect(script).toContain("vmtoolsd");
    });

    it("generates script for nutanix target", () => {
      const recipe = getRemediationRecipe("nutanix");
      const script = generateLinuxRemediationScript(recipe);
      expect(script).toContain("qemu-guest-agent");
      expect(script).toContain("virtio_scsi");
    });

    it("includes grub fixes for nutanix", () => {
      const recipe = getRemediationRecipe("nutanix");
      expect(recipe.grubFixes.length).toBeGreaterThan(0);
      const script = generateLinuxRemediationScript(recipe);
      expect(script).toContain("grub");
    });

    it("no grub fixes for vmware", () => {
      const recipe = getRemediationRecipe("vmware");
      expect(recipe.grubFixes.length).toBe(0);
    });
  });

  describe("needsRemediation", () => {
    it("returns true for vmware → aws", () => {
      expect(needsRemediation("vmware", "aws")).toBe(true);
    });

    it("returns true for nutanix → azure", () => {
      expect(needsRemediation("nutanix", "azure")).toBe(true);
    });

    it("returns true for aws → on-premises", () => {
      expect(needsRemediation("aws", "on-premises")).toBe(true);
    });

    it("returns false for same provider", () => {
      expect(needsRemediation("vmware", "vmware")).toBe(false);
    });
  });

  describe("getRemediationSummary", () => {
    it("returns summary for on-premises", () => {
      const summary = getRemediationSummary("on-premises");
      expect(summary.installCount).toBeGreaterThan(0);
      expect(summary.removeCount).toBeGreaterThan(0);
      expect(summary.description).toBeTruthy();
    });

    it("returns summary for vmware", () => {
      const summary = getRemediationSummary("vmware");
      expect(summary.installCount).toBeGreaterThan(0);
    });

    it("returns summary for nutanix", () => {
      const summary = getRemediationSummary("nutanix");
      expect(summary.installCount).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Storage Class Mappings — On-Prem Directions
// =============================================================================

describe("data/types — storage class mappings for on-prem", () => {
  describe("STORAGE_CLASS_MAP coverage", () => {
    const onPremDirections = [
      "on-premises→aws", "on-premises→azure", "on-premises→gcp",
      "aws→on-premises", "azure→on-premises", "gcp→on-premises",
      "vmware→aws", "vmware→azure", "vmware→gcp",
      "aws→vmware", "azure→vmware", "gcp→vmware",
      "nutanix→aws", "nutanix→azure", "nutanix→gcp",
      "aws→nutanix", "azure→nutanix", "gcp→nutanix",
      "on-premises→on-premises", "vmware→vmware", "nutanix→nutanix",
      "vmware→on-premises", "on-premises→vmware",
      "nutanix→on-premises", "on-premises→nutanix",
      "vmware→nutanix", "nutanix→vmware",
    ];

    for (const direction of onPremDirections) {
      it(`has mapping for ${direction}`, () => {
        expect(STORAGE_CLASS_MAP[direction]).toBeDefined();
        expect(Object.keys(STORAGE_CLASS_MAP[direction]).length).toBeGreaterThan(0);
      });
    }
  });

  describe("mapStorageClass for on-prem directions", () => {
    it("maps on-premises STANDARD → AWS STANDARD", () => {
      expect(mapStorageClass("STANDARD", "on-premises", "aws")).toBe("STANDARD");
    });

    it("maps on-premises COLD → AWS STANDARD_IA", () => {
      expect(mapStorageClass("COLD", "on-premises", "aws")).toBe("STANDARD_IA");
    });

    it("maps on-premises ARCHIVE → AWS GLACIER", () => {
      expect(mapStorageClass("ARCHIVE", "on-premises", "aws")).toBe("GLACIER");
    });

    it("maps AWS STANDARD → on-premises STANDARD", () => {
      expect(mapStorageClass("STANDARD", "aws", "on-premises")).toBe("STANDARD");
    });

    it("maps AWS GLACIER → on-premises ARCHIVE", () => {
      expect(mapStorageClass("GLACIER", "aws", "on-premises")).toBe("ARCHIVE");
    });

    it("maps on-premises STANDARD → Azure Hot", () => {
      expect(mapStorageClass("STANDARD", "on-premises", "azure")).toBe("Hot");
    });

    it("maps vmware COLD → GCP NEARLINE", () => {
      expect(mapStorageClass("COLD", "vmware", "gcp")).toBe("NEARLINE");
    });

    it("maps nutanix STANDARD → Azure Hot", () => {
      expect(mapStorageClass("STANDARD", "nutanix", "azure")).toBe("Hot");
    });

    it("returns same class for unmapped classes", () => {
      expect(mapStorageClass("CUSTOM_CLASS", "on-premises", "aws")).toBe("CUSTOM_CLASS");
    });

    it("identity mapping for on-prem ↔ on-prem", () => {
      expect(mapStorageClass("STANDARD", "vmware", "on-premises")).toBe("STANDARD");
      expect(mapStorageClass("COLD", "on-premises", "nutanix")).toBe("COLD");
      expect(mapStorageClass("ARCHIVE", "nutanix", "vmware")).toBe("ARCHIVE");
    });
  });
});
