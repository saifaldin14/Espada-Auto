/**
 * Network Pipeline — DNS Migrator
 *
 * Handles DNS zone and record migration between providers,
 * including record translation, TTL optimization, and
 * provider-specific record type handling.
 */

import type { NormalizedDNSRecord, MigrationProvider } from "../types.js";
import type { DNSZone, DNSMigrationPlan } from "./types.js";

// =============================================================================
// DNS Record Translation
// =============================================================================

/** Record types supported by each provider */
const SUPPORTED_RECORD_TYPES: Record<string, Set<string>> = {
  aws: new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT", "CAA", "NAPTR", "DS"]),
  azure: new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT", "CAA"]),
  gcp: new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT", "CAA", "DS", "IPSECKEY", "SPF"]),
  "on-premises": new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"]),
  vmware: new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"]),
  nutanix: new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"]),
};

/** Provider-specific alias record types */
const ALIAS_RECORD_TYPES: Record<string, string> = {
  aws: "ALIAS", // Route53 alias records
  azure: "ALIAS", // Azure alias records (different underlying mechanism)
  gcp: "CNAME", // GCP doesn't have alias — must use CNAME or static IP
  "on-premises": "CNAME", // On-prem DNS (BIND/AD) — use CNAME for aliases
  vmware: "CNAME",
  nutanix: "CNAME",
};

/**
 * Create a DNS migration plan.
 */
export function planDNSMigration(params: {
  sourceZone: DNSZone;
  targetProvider: MigrationProvider;
  ipMappings?: Record<string, string>; // old IP → new IP
}): DNSMigrationPlan {
  const { sourceZone, targetProvider, ipMappings = {} } = params;
  const targetTypes = SUPPORTED_RECORD_TYPES[targetProvider] ?? new Set<string>();

  const recordsToCreate: NormalizedDNSRecord[] = [];
  const recordsToUpdate: DNSMigrationPlan["recordsToUpdate"] = [];
  const recordsToSkip: DNSMigrationPlan["recordsToSkip"] = [];

  for (const record of sourceZone.records) {
    // Skip NS at zone apex (managed by provider)
    if (record.type === "NS" && record.name === sourceZone.name) {
      recordsToSkip.push({
        record,
        reason: `${record.type} records at zone apex are managed by the target provider`,
      });
      continue;
    }

    // Check if record type is supported
    if (!targetTypes.has(record.type)) {
      recordsToSkip.push({
        record,
        reason: `Record type ${record.type} is not supported by ${targetProvider}`,
      });
      continue;
    }

    // Check for IP address updates
    if ((record.type === "A" || record.type === "AAAA") && record.values.length > 0 && ipMappings[record.values[0]]) {
      recordsToUpdate.push({
        record: { ...record, values: record.values.map((v) => ipMappings[v] ?? v) },
        oldValue: record.values[0],
        newValue: ipMappings[record.values[0]],
        reason: "IP address mapped to new target infrastructure",
      });
      continue;
    }

    // Standard record — create as-is
    recordsToCreate.push(record);
  }

  return {
    sourceZone,
    targetProvider,
    recordsToCreate,
    recordsToUpdate,
    recordsToSkip,
    nameServerChange: true, // always need NS update for provider migration
  };
}

/**
 * Generate low-TTL pre-migration records.
 * Before migration, lower TTLs so DNS propagation is faster at cutover.
 */
export function generatePreMigrationTTLUpdates(
  zone: DNSZone,
  targetTTL: number = 60,
): Array<{ record: NormalizedDNSRecord; oldTTL: number; newTTL: number }> {
  const updates: Array<{ record: NormalizedDNSRecord; oldTTL: number; newTTL: number }> = [];

  for (const record of zone.records) {
    if (record.type === "NS") continue;
    if (record.ttl > targetTTL) {
      updates.push({
        record,
        oldTTL: record.ttl,
        newTTL: targetTTL,
      });
    }
  }

  return updates;
}

/**
 * Generate post-migration TTL restoration records.
 */
export function generatePostMigrationTTLRestore(
  updates: Array<{ record: NormalizedDNSRecord; oldTTL: number }>,
): Array<{ record: NormalizedDNSRecord; newTTL: number }> {
  return updates.map((u) => ({
    record: u.record,
    newTTL: u.oldTTL,
  }));
}

/**
 * Validate DNS migration plan.
 */
export function validateDNSPlan(plan: DNSMigrationPlan): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (plan.recordsToSkip.length > 0) {
    warnings.push(
      `${plan.recordsToSkip.length} record(s) will be skipped — review before migration`,
    );
  }

  // Check for CNAME at zone apex (not allowed by RFC)
  for (const record of plan.recordsToCreate) {
    if (record.type === "CNAME" && record.name === plan.sourceZone.name) {
      errors.push("CNAME at zone apex is not allowed. Use provider-specific alias or A record.");
    }
  }

  // Check for conflicting records
  const recordMap = new Map<string, NormalizedDNSRecord[]>();
  for (const record of [...plan.recordsToCreate, ...plan.recordsToUpdate.map((r) => r.record)]) {
    const key = `${record.name}:${record.type}`;
    const existing = recordMap.get(key) ?? [];
    existing.push(record);
    recordMap.set(key, existing);
  }

  // CNAME cannot coexist with other record types at the same name
  for (const [key, records] of recordMap) {
    if (records.some((r) => r.type === "CNAME") && records.length > 1) {
      errors.push(`Conflicting records at ${key}: CNAME cannot coexist with other record types`);
    }
  }

  if (plan.nameServerChange) {
    warnings.push("Name server change required — coordinate with domain registrar");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
