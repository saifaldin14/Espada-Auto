/**
 * Cross-Cloud Migration Engine — Network Rule Translator & DNS Migrator Tests
 */
import { describe, it, expect } from "vitest";

import {
  translateRule,
  translateSecurityGroup,
  getTranslationSummary,
} from "../src/network/rule-translator.js";

import {
  planDNSMigration,
  generatePreMigrationTTLUpdates,
  generatePostMigrationTTLRestore,
  validateDNSPlan,
} from "../src/network/dns-migrator.js";

import type { NormalizedSecurityRule, NormalizedDNSRecord } from "../src/types.js";
import type { DNSZone } from "../src/network/types.js";

describe("network/rule-translator", () => {
  const sampleRule: NormalizedSecurityRule = {
    id: "rule-1",
    name: "allow-https",
    direction: "inbound",
    action: "allow",
    protocol: "tcp",
    portRange: { from: 443, to: 443 },
    source: { type: "cidr", value: "0.0.0.0/0" },
    destination: { type: "cidr", value: "10.0.0.0/24" },
    priority: 100,
  };

  describe("translateRule", () => {
    it("translates a rule from AWS to Azure format", () => {
      const result = translateRule(sampleRule, "aws", "azure");
      expect(result).toHaveProperty("targetRule");
      expect(result).toHaveProperty("translationNotes");
      expect(result.targetRule.protocol).toBeDefined();
      expect(result.targetRule.portRange.from).toBe(443);
    });

    it("translates a rule from AWS to GCP format", () => {
      const result = translateRule(sampleRule, "aws", "gcp");
      expect(result.targetRule).toBeDefined();
      expect(result.targetRule.direction).toBe("inbound");
    });

    it("preserves action and port range", () => {
      const result = translateRule(sampleRule, "azure", "aws");
      expect(result.targetRule.action).toBe("allow");
      expect(result.targetRule.portRange).toEqual({ from: 443, to: 443 });
    });

    it("adds warnings for security-group source type", () => {
      const sgRule: NormalizedSecurityRule = {
        ...sampleRule,
        source: { type: "security-group", value: "sg-12345" },
      };
      const result = translateRule(sgRule, "aws", "gcp");
      expect(result.translationNotes.length).toBeGreaterThan(0);
      expect(result.lossOfFidelity).toBe(true);
    });
  });

  describe("translateSecurityGroup", () => {
    it("translates a group of rules", () => {
      const rules: NormalizedSecurityRule[] = [
        sampleRule,
        {
          ...sampleRule,
          id: "rule-2",
          name: "allow-http",
          portRange: { from: 80, to: 80 },
          priority: 200,
        },
      ];

      const result = translateSecurityGroup({
        groupId: "sg-001",
        groupName: "web-sg",
        rules,
        sourceProvider: "aws",
        targetProvider: "azure",
      });

      expect(result.rules.length).toBe(2);
      expect(result).toHaveProperty("warnings");
      expect(result.sourceGroupId).toBe("sg-001");
    });
  });

  describe("getTranslationSummary", () => {
    it("returns a summary with counts", () => {
      const rules: NormalizedSecurityRule[] = [sampleRule];
      const groupMapping = translateSecurityGroup({
        groupId: "sg-001",
        groupName: "web-sg",
        rules,
        sourceProvider: "aws",
        targetProvider: "azure",
      });

      const summary = getTranslationSummary([groupMapping]);
      expect(summary).toHaveProperty("totalGroups");
      expect(summary).toHaveProperty("totalRules");
      expect(summary.totalGroups).toBe(1);
      expect(summary.totalRules).toBe(1);
    });
  });
});

describe("network/dns-migrator", () => {
  const sampleRecords: NormalizedDNSRecord[] = [
    {
      name: "api.example.com",
      type: "A",
      ttl: 300,
      values: ["1.2.3.4"],
    },
    {
      name: "www.example.com",
      type: "CNAME",
      ttl: 3600,
      values: ["example.com"],
    },
  ];

  const sampleZone: DNSZone = {
    id: "zone-1",
    name: "example.com",
    provider: "aws",
    type: "public",
    records: sampleRecords,
    nameServers: ["ns1.example.com", "ns2.example.com"],
  };

  describe("planDNSMigration", () => {
    it("creates a migration plan for DNS records", () => {
      const plan = planDNSMigration({
        sourceZone: sampleZone,
        targetProvider: "azure",
      });

      expect(plan).toHaveProperty("sourceZone");
      expect(plan).toHaveProperty("targetProvider");
      expect(plan).toHaveProperty("recordsToCreate");
      expect(plan.recordsToCreate.length + plan.recordsToUpdate.length + plan.recordsToSkip.length).toBeGreaterThan(0);
    });
  });

  describe("generatePreMigrationTTLUpdates", () => {
    it("generates TTL lowering commands for cut-over prep", () => {
      const updates = generatePreMigrationTTLUpdates(sampleZone, 60);
      expect(Array.isArray(updates)).toBe(true);
      expect(updates.length).toBeGreaterThan(0);
      for (const u of updates) {
        expect(u).toHaveProperty("record");
        expect(u).toHaveProperty("oldTTL");
        expect(u.newTTL).toBe(60);
      }
    });
  });

  describe("generatePostMigrationTTLRestore", () => {
    it("generates TTL restore commands", () => {
      const updates = generatePreMigrationTTLUpdates(sampleZone, 60);
      const restores = generatePostMigrationTTLRestore(updates);
      expect(restores.length).toBe(updates.length);
      for (const r of restores) {
        expect(r).toHaveProperty("record");
        expect(r.newTTL).toBeGreaterThan(60);
      }
    });
  });

  describe("validateDNSPlan", () => {
    it("validates a correct plan", () => {
      const plan = planDNSMigration({
        sourceZone: sampleZone,
        targetProvider: "gcp",
      });

      const result = validateDNSPlan(plan);
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
    });
  });
});
