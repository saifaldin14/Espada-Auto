/**
 * Network Pipeline — Security Rule Translator
 *
 * Translates security group / firewall rules between cloud providers,
 * handling differences in rule models (stateful vs stateless, CIDR
 * formats, protocol naming, priority systems).
 */

import type { NormalizedSecurityRule, MigrationProvider } from "../types.js";
import type { SecurityGroupMapping, SecurityRuleMapping } from "./types.js";

// =============================================================================
// Provider Rule Limits
// =============================================================================

const RULE_LIMITS: Record<string, { maxRulesPerGroup: number; maxGroups: number; priorityBased: boolean }> = {
  aws: { maxRulesPerGroup: 60, maxGroups: 2500, priorityBased: false },
  azure: { maxRulesPerGroup: 1000, maxGroups: 5000, priorityBased: true },
  gcp: { maxRulesPerGroup: 0, maxGroups: 0, priorityBased: true }, // GCP uses VPC firewall rules, not groups
};

// =============================================================================
// Protocol Normalization
// =============================================================================

const PROTOCOL_MAP: Record<string, Record<string, string>> = {
  aws: { "-1": "all", "6": "tcp", "17": "udp", "1": "icmp" },
  azure: { "*": "all", Tcp: "tcp", Udp: "udp", Icmp: "icmp" },
  gcp: { all: "all", tcp: "tcp", udp: "udp", icmp: "icmp" },
};

function normalizeProtocol(protocol: string, provider: string): string {
  const map = PROTOCOL_MAP[provider];
  if (!map) return protocol.toLowerCase();
  return map[protocol] ?? protocol.toLowerCase();
}

function denormalizeProtocol(protocol: string, targetProvider: string): string {
  const reverseMap: Record<string, Record<string, string>> = {
    aws: { all: "-1", tcp: "6", udp: "17", icmp: "1" },
    azure: { all: "*", tcp: "Tcp", udp: "Udp", icmp: "Icmp" },
    gcp: { all: "all", tcp: "tcp", udp: "udp", icmp: "icmp" },
  };
  const map = reverseMap[targetProvider];
  if (!map) return protocol;
  return map[protocol] ?? protocol;
}

// =============================================================================
// Rule Translation
// =============================================================================

/**
 * Translate a single security rule to the target provider format.
 */
export function translateRule(
  rule: NormalizedSecurityRule,
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
): SecurityRuleMapping {
  const notes: string[] = [];
  let lossOfFidelity = false;

  // Protocol translation
  const normalizedProtocol = normalizeProtocol(rule.protocol, sourceProvider);
  const targetProtocol = denormalizeProtocol(normalizedProtocol, targetProvider);

  // Port range normalization
  let fromPort = rule.portRange.from;
  let toPort = rule.portRange.to;

  // AWS uses -1 for all ports; Azure uses *; GCP uses 0-65535
  if (fromPort === -1 && toPort === -1) {
    if (targetProvider === "gcp") {
      fromPort = 0;
      toPort = 65535;
      notes.push("Converted 'all ports' to 0-65535 for GCP");
    }
  }

  // Source handling
  const sourceValue = rule.source.value;
  if (sourceValue === "0.0.0.0/0" && rule.direction === "inbound") {
    notes.push("Rule allows all inbound traffic — review for security compliance");
  }

  // Priority (Azure/GCP use priorities, AWS does not)
  let priority = rule.priority;
  if (targetProvider === "azure" && !priority) {
    priority = 1000; // default Azure priority
    notes.push("Assigned default Azure priority 1000");
  }
  if (targetProvider === "gcp" && !priority) {
    priority = 1000;
    notes.push("Assigned default GCP priority 1000");
  }
  if (sourceProvider === "azure" && targetProvider === "aws" && priority) {
    notes.push(`Azure priority ${priority} dropped (AWS doesn't support rule priorities)`);
    lossOfFidelity = true;
  }

  // Self-referencing security groups
  let source = rule.source;
  if (rule.source.type === "security-group") {
    notes.push("Self-referencing group rule needs manual group ID mapping after creation");
    source = { type: "cidr", value: "0.0.0.0/0" }; // placeholder
    lossOfFidelity = true;
  }

  const targetRule: NormalizedSecurityRule = {
    id: `${rule.id}-translated`,
    name: rule.name,
    direction: rule.direction,
    action: rule.action,
    protocol: targetProtocol as NormalizedSecurityRule["protocol"],
    portRange: { from: fromPort, to: toPort },
    source,
    destination: rule.destination,
    priority,
    description: rule.description,
  };

  return {
    sourceRule: rule,
    targetRule,
    translationNotes: notes,
    lossOfFidelity,
  };
}

/**
 * Translate an entire security group's rules.
 */
export function translateSecurityGroup(params: {
  groupId: string;
  groupName: string;
  rules: NormalizedSecurityRule[];
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
}): SecurityGroupMapping {
  const warnings: string[] = [];
  const rules: SecurityRuleMapping[] = [];

  // Check rule limits
  const limits = RULE_LIMITS[params.targetProvider];
  if (limits?.maxRulesPerGroup && params.rules.length > limits.maxRulesPerGroup) {
    warnings.push(
      `Source group has ${params.rules.length} rules but ${params.targetProvider} allows max ${limits.maxRulesPerGroup}. ` +
      `Rules will need to be split across multiple groups.`,
    );
  }

  for (const rule of params.rules) {
    const mapping = translateRule(rule, params.sourceProvider, params.targetProvider);
    rules.push(mapping);
    if (mapping.lossOfFidelity) {
      warnings.push(`Rule ${rule.id}: fidelity loss during translation`);
    }
  }

  return {
    sourceGroupId: params.groupId,
    sourceGroupName: params.groupName,
    sourceProvider: params.sourceProvider,
    targetGroupName: `${params.groupName}-migrated`,
    targetProvider: params.targetProvider,
    rules,
    warnings,
  };
}

/**
 * Get a summary of translation for a set of security groups.
 */
export function getTranslationSummary(mappings: SecurityGroupMapping[]): {
  totalGroups: number;
  totalRules: number;
  rulesWithWarnings: number;
  fidelityLoss: number;
  warnings: string[];
} {
  let totalRules = 0;
  let rulesWithWarnings = 0;
  let fidelityLoss = 0;
  const allWarnings: string[] = [];

  for (const mapping of mappings) {
    totalRules += mapping.rules.length;
    for (const rule of mapping.rules) {
      if (rule.translationNotes.length > 0) rulesWithWarnings++;
      if (rule.lossOfFidelity) fidelityLoss++;
    }
    allWarnings.push(...mapping.warnings);
  }

  return {
    totalGroups: mappings.length,
    totalRules,
    rulesWithWarnings,
    fidelityLoss,
    warnings: allWarnings,
  };
}
