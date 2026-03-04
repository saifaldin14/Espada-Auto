/**
 * GCP Resource Tagging (Labels) Manager
 *
 * Manages resource labels and tag bindings using the Cloud Resource Manager
 * API and Compute Engine API for bulk labeling operations.
 */

import type { GcpRetryOptions, GcpOperationResult, GcpLabelSet } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type TagValidationRule = {
  requiredLabels?: string[];
  optionalLabels?: string[];
  prohibitedLabels?: string[];
  keyPattern?: string;
  valuePattern?: string;
  maxKeyLength?: number;
  maxValueLength?: number;
};

export type TagValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type TagKey = {
  name: string;
  shortName: string;
  parent: string;
  description: string;
  createTime: string;
  updateTime: string;
  purpose?: string;
};

export type TagValue = {
  name: string;
  shortName: string;
  parent: string;
  description: string;
  createTime: string;
  updateTime: string;
};

export type TagBinding = {
  name: string;
  parent: string;
  tagValue: string;
  tagKey: string;
};

export type BulkLabelOperation = {
  resourceType: string;
  resourceId: string;
  zone?: string;
  region?: string;
  action: "add" | "remove" | "replace";
  labels: GcpLabelSet;
};

export type BulkLabelResult = {
  totalOperations: number;
  succeeded: number;
  failed: number;
  errors: Array<{ resource: string; error: string }>;
};

export type LabelAuditEntry = {
  resourceType: string;
  resourceId: string;
  labels: GcpLabelSet;
  missingRequired: string[];
  hasProhibited: string[];
  compliant: boolean;
};

export type LabelComplianceReport = {
  totalResources: number;
  compliantResources: number;
  nonCompliantResources: number;
  byResourceType: Record<string, { total: number; compliant: number }>;
  entries: LabelAuditEntry[];
};

// =============================================================================
// Constants
// =============================================================================

const SENSITIVE_PATTERNS = [
  /password/i, /secret/i, /\bapi[_-]?key\b/i, /\baccess[_-]?token\b/i, /credential/i,
  /ssn/i, /social.?security/i, /credit.?card/i, /cvv/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN pattern
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
];

// =============================================================================
// Manager
// =============================================================================

const CRM_BASE = "https://cloudresourcemanager.googleapis.com/v3";
const COMPUTE_BASE = "https://compute.googleapis.com/compute/v1";

export class GcpTaggingManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;
  private validationRules: TagValidationRule;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
    validationRules?: TagValidationRule,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "tagging",
      projectId: this.projectId,
    };
    this.validationRules = validationRules ?? {
      maxKeyLength: 63,
      maxValueLength: 63,
      keyPattern: "^[a-z][a-z0-9_-]*$",
      valuePattern: "^[a-z0-9_-]*$",
    };
  }

  // ---------------------------------------------------------------------------
  // Tag Keys & Values (Organization-level tags)
  // ---------------------------------------------------------------------------

  async listTagKeys(parent: string): Promise<TagKey[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/tagKeys?parent=${encodeURIComponent(parent)}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "tagKeys");
      return items.map((t) => this.mapTagKey(t));
    }, this.retryOptions);
  }

  async createTagKey(parent: string, shortName: string, description?: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/tagKeys`;
      const result = await gcpMutate(url, token, {
        parent,
        shortName,
        description: description ?? "",
      });
      return { success: true, message: `Tag key "${shortName}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async listTagValues(tagKeyName: string): Promise<TagValue[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/tagValues?parent=${encodeURIComponent(tagKeyName)}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "tagValues");
      return items.map((v) => ({
        name: String(v.name ?? ""),
        shortName: String(v.shortName ?? ""),
        parent: String(v.parent ?? ""),
        description: String(v.description ?? ""),
        createTime: String(v.createTime ?? ""),
        updateTime: String(v.updateTime ?? ""),
      }));
    }, this.retryOptions);
  }

  async createTagValue(tagKeyName: string, shortName: string, description?: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/tagValues`;
      const result = await gcpMutate(url, token, {
        parent: tagKeyName,
        shortName,
        description: description ?? "",
      });
      return { success: true, message: `Tag value "${shortName}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Tag Bindings (Resource-level)
  // ---------------------------------------------------------------------------

  async listTagBindings(resourceName: string): Promise<TagBinding[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/tagBindings?parent=${encodeURIComponent(resourceName)}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "tagBindings");
      return items.map((b) => ({
        name: String(b.name ?? ""),
        parent: String(b.parent ?? ""),
        tagValue: String(b.tagValue ?? ""),
        tagKey: String(b.tagValueNamespacedName ?? "").split("/")[0] ?? "",
      }));
    }, this.retryOptions);
  }

  async createTagBinding(resourceName: string, tagValueName: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/tagBindings`;
      const result = await gcpMutate(url, token, {
        parent: resourceName,
        tagValue: tagValueName,
      });
      return { success: true, message: "Tag binding created", operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Label Operations (Compute-style labels)
  // ---------------------------------------------------------------------------

  async setLabels(
    resourceType: string,
    resourceId: string,
    labels: GcpLabelSet,
    opts?: { zone?: string; region?: string },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = this.buildLabelUrl(resourceType, resourceId, opts);
      if (!url) {
        return { success: false, error: `Unsupported resource type: ${resourceType}` };
      }

      // Get current fingerprint
      const current = await gcpRequest<Record<string, unknown>>(
        url.replace("/setLabels", ""),
        token,
      );

      const result = await gcpMutate(url, token, {
        labels,
        labelFingerprint: current.labelFingerprint ?? "",
      });
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async bulkSetLabels(operations: BulkLabelOperation[]): Promise<BulkLabelResult> {
    const result: BulkLabelResult = {
      totalOperations: operations.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    // Run operations concurrently in batches of 10 for throughput
    const BATCH_SIZE = 10;
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batch = operations.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(async (op) => {
          const res = await this.setLabels(op.resourceType, op.resourceId, op.labels, {
            zone: op.zone,
            region: op.region,
          });
          return { op, res };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          if (outcome.value.res.success) {
            result.succeeded++;
          } else {
            result.failed++;
            result.errors.push({ resource: outcome.value.op.resourceId, error: outcome.value.res.error ?? "Unknown error" });
          }
        } else {
          result.failed++;
          const err = outcome.reason;
          result.errors.push({
            resource: "unknown",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validateLabels(labels: GcpLabelSet): TagValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rules = this.validationRules;

    // Check required labels
    for (const required of rules.requiredLabels ?? []) {
      if (!labels[required]) {
        errors.push(`Missing required label: "${required}"`);
      }
    }

    // Check prohibited labels
    for (const prohibited of rules.prohibitedLabels ?? []) {
      if (labels[prohibited]) {
        errors.push(`Prohibited label found: "${prohibited}"`);
      }
    }

    for (const [key, value] of Object.entries(labels)) {
      // Key length
      if (rules.maxKeyLength && key.length > rules.maxKeyLength) {
        errors.push(`Label key "${key}" exceeds max length (${rules.maxKeyLength})`);
      }

      // Value length
      if (rules.maxValueLength && value.length > rules.maxValueLength) {
        errors.push(`Label value for "${key}" exceeds max length (${rules.maxValueLength})`);
      }

      // Key pattern
      if (rules.keyPattern && !new RegExp(rules.keyPattern).test(key)) {
        errors.push(`Label key "${key}" does not match pattern: ${rules.keyPattern}`);
      }

      // Value pattern
      if (rules.valuePattern && value && !new RegExp(rules.valuePattern).test(value)) {
        errors.push(`Label value for "${key}" does not match pattern: ${rules.valuePattern}`);
      }

      // Sensitive data detection
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(value)) {
          warnings.push(`Label "${key}" may contain sensitive data`);
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Compliance Audit
  // ---------------------------------------------------------------------------

  async auditLabelCompliance(
    resources: Array<{ type: string; id: string; labels: GcpLabelSet }>,
  ): Promise<LabelComplianceReport> {
    const entries: LabelAuditEntry[] = [];
    const byResourceType: Record<string, { total: number; compliant: number }> = {};

    for (const resource of resources) {
      const missingRequired = (this.validationRules.requiredLabels ?? []).filter(
        (l) => !resource.labels[l],
      );
      const hasProhibited = (this.validationRules.prohibitedLabels ?? []).filter(
        (l) => resource.labels[l],
      );
      const compliant = missingRequired.length === 0 && hasProhibited.length === 0;

      entries.push({
        resourceType: resource.type,
        resourceId: resource.id,
        labels: resource.labels,
        missingRequired,
        hasProhibited,
        compliant,
      });

      const rt = byResourceType[resource.type] ?? { total: 0, compliant: 0 };
      rt.total++;
      if (compliant) rt.compliant++;
      byResourceType[resource.type] = rt;
    }

    return {
      totalResources: resources.length,
      compliantResources: entries.filter((e) => e.compliant).length,
      nonCompliantResources: entries.filter((e) => !e.compliant).length,
      byResourceType,
      entries,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildLabelUrl(
    resourceType: string,
    resourceId: string,
    opts?: { zone?: string; region?: string },
  ): string | undefined {
    const base = COMPUTE_BASE;
    switch (resourceType) {
      case "instance":
      case "compute.googleapis.com/Instance":
        return `${base}/projects/${this.projectId}/zones/${opts?.zone ?? "-"}/instances/${resourceId}/setLabels`;
      case "disk":
      case "compute.googleapis.com/Disk":
        return `${base}/projects/${this.projectId}/zones/${opts?.zone ?? "-"}/disks/${resourceId}/setLabels`;
      case "image":
        return `${base}/projects/${this.projectId}/global/images/${resourceId}/setLabels`;
      case "snapshot":
        return `${base}/projects/${this.projectId}/global/snapshots/${resourceId}/setLabels`;
      case "forwarding-rule":
        return opts?.region
          ? `${base}/projects/${this.projectId}/regions/${opts.region}/forwardingRules/${resourceId}/setLabels`
          : `${base}/projects/${this.projectId}/global/forwardingRules/${resourceId}/setLabels`;
      default:
        return undefined;
    }
  }

  private mapTagKey(raw: Record<string, unknown>): TagKey {
    return {
      name: String(raw.name ?? ""),
      shortName: String(raw.shortName ?? ""),
      parent: String(raw.parent ?? ""),
      description: String(raw.description ?? ""),
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      purpose: raw.purpose ? String(raw.purpose) : undefined,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTaggingManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
  validationRules?: TagValidationRule,
): GcpTaggingManager {
  return new GcpTaggingManager(projectId, getAccessToken, retryOptions, validationRules);
}
