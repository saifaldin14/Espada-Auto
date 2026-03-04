/**
 * GCP Security Command Center Manager
 *
 * Security posture management using Security Command Center API (v2),
 * IAM security analysis, and threat detection.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type SecurityFindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNSPECIFIED";

export type SecurityFindingState = "ACTIVE" | "INACTIVE" | "MUTED";

export type SecurityFinding = {
  name: string;
  parent: string;
  category: string;
  resourceName: string;
  state: SecurityFindingState;
  severity: SecurityFindingSeverity;
  description: string;
  sourceProperties: Record<string, unknown>;
  createTime: string;
  eventTime: string;
  externalUri?: string;
  recommendation?: string;
};

export type SecuritySource = {
  name: string;
  displayName: string;
  description: string;
};

export type SecurityMark = {
  name: string;
  marks: Record<string, string>;
};

export type IamPolicyAnalysis = {
  identity: string;
  roles: string[];
  permissions: string[];
  resources: string[];
  hasExcessivePermissions: boolean;
  recommendations: string[];
};

export type ServiceAccountKeyAge = {
  serviceAccount: string;
  keyId: string;
  keyType: string;
  createdAt: string;
  ageInDays: number;
  needsRotation: boolean;
};

export type SecurityPostureSummary = {
  totalFindings: number;
  bySeverity: Record<SecurityFindingSeverity, number>;
  byCategory: Record<string, number>;
  byState: Record<SecurityFindingState, number>;
  criticalResources: string[];
  lastScanTime: string;
};

export type ComplianceCheckResult = {
  checkId: string;
  name: string;
  description: string;
  passed: boolean;
  severity: SecurityFindingSeverity;
  resource?: string;
  remediation?: string;
};

export type MuteConfig = {
  name: string;
  displayName: string;
  filter: string;
  description: string;
  createTime: string;
};

export type ListFindingsOptions = {
  organizationId?: string;
  filter?: string;
  severity?: SecurityFindingSeverity[];
  state?: SecurityFindingState;
  category?: string;
  orderBy?: string;
};

// =============================================================================
// Manager
// =============================================================================

const SCC_BASE = "https://securitycenter.googleapis.com/v2";
const IAM_BASE = "https://iam.googleapis.com/v1";

export class GcpSecurityManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "security",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Security Findings
  // ---------------------------------------------------------------------------

  async listFindings(opts?: ListFindingsOptions): Promise<SecurityFinding[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const parent = opts?.organizationId
        ? `organizations/${opts.organizationId}`
        : `projects/${this.projectId}`;
      let url = `${SCC_BASE}/${parent}/findings`;

      const filters: string[] = [];
      if (opts?.severity?.length) {
        filters.push(`severity="${opts.severity.join('" OR severity="')}"`);
      }
      if (opts?.state) filters.push(`state="${opts.state}"`);
      if (opts?.category) filters.push(`category="${opts.category}"`);
      if (opts?.filter) filters.push(opts.filter);

      if (filters.length > 0) {
        url += `?filter=${encodeURIComponent(filters.join(" AND "))}`;
      }

      const items = await gcpList<Record<string, unknown>>(url, token, "listFindingsResults");
      return items.map((item) => {
        const finding = (item.finding ?? item) as Record<string, unknown>;
        return this.mapFinding(finding);
      });
    }, this.retryOptions);
  }

  async getFinding(findingName: string): Promise<SecurityFinding> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCC_BASE}/${findingName}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapFinding(raw);
    }, this.retryOptions);
  }

  async muteFinding(findingName: string, mute: boolean): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCC_BASE}/${findingName}:setMute`;
      await gcpRequest(url, token, {
        method: "POST",
        body: { mute: mute ? "MUTED" : "UNMUTED" },
      });
      return { success: true, message: `Finding ${mute ? "muted" : "unmuted"}` };
    }, this.retryOptions);
  }

  async updateFindingState(findingName: string, state: SecurityFindingState): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCC_BASE}/${findingName}:setState`;
      await gcpRequest(url, token, {
        method: "POST",
        body: { state },
      });
      return { success: true, message: `Finding state updated to ${state}` };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Security Posture Summary
  // ---------------------------------------------------------------------------

  async getSecurityPosture(organizationId?: string): Promise<SecurityPostureSummary> {
    const findings = await this.listFindings({ organizationId });

    const bySeverity: Record<string, number> = {
      CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNSPECIFIED: 0,
    };
    const byCategory: Record<string, number> = {};
    const byState: Record<string, number> = {
      ACTIVE: 0, INACTIVE: 0, MUTED: 0,
    };
    const criticalResources: string[] = [];

    for (const finding of findings) {
      bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
      byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
      byState[finding.state] = (byState[finding.state] ?? 0) + 1;

      if (finding.severity === "CRITICAL" && finding.state === "ACTIVE") {
        criticalResources.push(finding.resourceName);
      }
    }

    return {
      totalFindings: findings.length,
      bySeverity: bySeverity as Record<SecurityFindingSeverity, number>,
      byCategory,
      byState: byState as Record<SecurityFindingState, number>,
      criticalResources: [...new Set(criticalResources)],
      lastScanTime: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Mute Configs
  // ---------------------------------------------------------------------------

  async listMuteConfigs(organizationId?: string): Promise<MuteConfig[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const parent = organizationId
        ? `organizations/${organizationId}`
        : `projects/${this.projectId}`;
      const url = `${SCC_BASE}/${parent}/muteConfigs`;
      const items = await gcpList<Record<string, unknown>>(url, token, "muteConfigs");
      return items.map((m) => ({
        name: String(m.name ?? ""),
        displayName: String(m.displayName ?? ""),
        filter: String(m.filter ?? ""),
        description: String(m.description ?? ""),
        createTime: String(m.createTime ?? ""),
      }));
    }, this.retryOptions);
  }

  async createMuteConfig(
    muteConfigId: string,
    filter: string,
    description?: string,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCC_BASE}/projects/${this.projectId}/muteConfigs?muteConfigId=${encodeURIComponent(muteConfigId)}`;
      await gcpMutate(url, token, {
        filter,
        description: description ?? "",
      });
      return { success: true, message: `Mute config "${muteConfigId}" created` };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // IAM Security Analysis
  // ---------------------------------------------------------------------------

  async analyzeIamPolicy(identity?: string): Promise<IamPolicyAnalysis[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${this.projectId}:getIamPolicy`;
      const data = await gcpRequest<Record<string, unknown>>(url, token, {
        method: "POST",
        body: { options: { requestedPolicyVersion: 3 } },
      });

      const bindings = (data.bindings ?? []) as Array<Record<string, unknown>>;
      const analysisMap = new Map<string, IamPolicyAnalysis>();

      for (const binding of bindings) {
        const role = String(binding.role ?? "");
        const members = (binding.members ?? []) as string[];

        for (const member of members) {
          if (identity && !member.includes(identity)) continue;

          const existing = analysisMap.get(member) ?? {
            identity: member,
            roles: [],
            permissions: [],
            resources: [`projects/${this.projectId}`],
            hasExcessivePermissions: false,
            recommendations: [],
          };
          existing.roles.push(role);
          analysisMap.set(member, existing);
        }
      }

      // Detect excessive permissions using exact predefined role matching
      const PRIVILEGED_ROLES = new Set([
        "roles/owner",
        "roles/editor",
        "roles/iam.securityAdmin",
        "roles/iam.serviceAccountAdmin",
        "roles/iam.serviceAccountKeyAdmin",
        "roles/iam.organizationRoleAdmin",
        "roles/resourcemanager.organizationAdmin",
        "roles/resourcemanager.folderAdmin",
        "roles/resourcemanager.projectIamAdmin",
        "roles/billing.admin",
        "roles/compute.admin",
        "roles/storage.admin",
        "roles/container.admin",
      ]);

      for (const analysis of analysisMap.values()) {
        const hasOwner = analysis.roles.includes("roles/owner");
        const hasEditor = analysis.roles.includes("roles/editor");
        const privilegedCount = analysis.roles.filter((r) => PRIVILEGED_ROLES.has(r)).length;

        if (hasOwner || (hasEditor && privilegedCount > 1)) {
          analysis.hasExcessivePermissions = true;
          analysis.recommendations.push("Consider using more granular roles instead of broad access");
        }
        if (analysis.roles.length > 5) {
          analysis.recommendations.push("Consider consolidating roles using custom roles");
        }
      }

      return [...analysisMap.values()];
    }, this.retryOptions);
  }

  async listServiceAccountKeys(): Promise<ServiceAccountKeyAge[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      // List all service accounts
      const saUrl = `${IAM_BASE}/projects/${this.projectId}/serviceAccounts`;
      const serviceAccounts = await gcpList<Record<string, unknown>>(saUrl, token, "accounts");

      const allKeys: ServiceAccountKeyAge[] = [];
      for (const sa of serviceAccounts) {
        const email = String(sa.email ?? "");
        try {
          const keysUrl = `${IAM_BASE}/projects/${this.projectId}/serviceAccounts/${email}/keys`;
          const keys = await gcpList<Record<string, unknown>>(keysUrl, token, "keys");

          for (const key of keys) {
            const createdAt = String(key.validAfterTime ?? "");
            const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : 0;
            const ageInDays = Math.floor(ageMs / 86400000);

            allKeys.push({
              serviceAccount: email,
              keyId: String(key.name ?? "").split("/").pop() ?? "",
              keyType: String(key.keyType ?? ""),
              createdAt,
              ageInDays,
              needsRotation: ageInDays > 90,
            });
          }
        } catch {
          // Skip service accounts we can't access
        }
      }
      return allKeys;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Compliance Checks
  // ---------------------------------------------------------------------------

  async runComplianceChecks(): Promise<ComplianceCheckResult[]> {
    const results: ComplianceCheckResult[] = [];

    // Check 1: Service account key age
    try {
      const keys = await this.listServiceAccountKeys();
      const oldKeys = keys.filter((k) => k.needsRotation && k.keyType === "USER_MANAGED");
      results.push({
        checkId: "gcp-iam-key-rotation",
        name: "Service Account Key Rotation",
        description: "Service account keys should be rotated every 90 days",
        passed: oldKeys.length === 0,
        severity: oldKeys.length > 0 ? "HIGH" : "LOW",
        remediation: oldKeys.length > 0
          ? `${oldKeys.length} key(s) need rotation: ${oldKeys.map((k) => k.serviceAccount).join(", ")}`
          : undefined,
      });
    } catch {
      results.push({
        checkId: "gcp-iam-key-rotation",
        name: "Service Account Key Rotation",
        description: "Service account keys should be rotated every 90 days",
        passed: false,
        severity: "MEDIUM",
        remediation: "Unable to check key rotation — ensure IAM permissions are configured",
      });
    }

    // Check 2: IAM excessive permissions
    try {
      const analysis = await this.analyzeIamPolicy();
      const excessive = analysis.filter((a) => a.hasExcessivePermissions);
      results.push({
        checkId: "gcp-iam-excessive-permissions",
        name: "Excessive IAM Permissions",
        description: "Identities should follow least-privilege principle",
        passed: excessive.length === 0,
        severity: excessive.length > 0 ? "HIGH" : "LOW",
        remediation: excessive.length > 0
          ? `${excessive.length} identity(ies) with excessive permissions: ${excessive.map((e) => e.identity).join(", ")}`
          : undefined,
      });
    } catch {
      results.push({
        checkId: "gcp-iam-excessive-permissions",
        name: "Excessive IAM Permissions",
        description: "Identities should follow least-privilege principle",
        passed: false,
        severity: "MEDIUM",
        remediation: "Unable to analyze IAM — ensure Resource Manager permissions",
      });
    }

    // Check 3: SCC findings
    try {
      const posture = await this.getSecurityPosture();
      results.push({
        checkId: "gcp-scc-critical-findings",
        name: "Security Command Center Critical Findings",
        description: "No critical security findings should be active",
        passed: posture.bySeverity.CRITICAL === 0,
        severity: posture.bySeverity.CRITICAL > 0 ? "CRITICAL" : "LOW",
        remediation: posture.bySeverity.CRITICAL > 0
          ? `${posture.bySeverity.CRITICAL} critical finding(s) active. Review SCC dashboard.`
          : undefined,
      });
    } catch {
      results.push({
        checkId: "gcp-scc-critical-findings",
        name: "Security Command Center Critical Findings",
        description: "No critical security findings should be active",
        passed: false,
        severity: "MEDIUM",
        remediation: "Unable to access Security Command Center — ensure SCC is enabled",
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapFinding(raw: Record<string, unknown>): SecurityFinding {
    return {
      name: String(raw.name ?? ""),
      parent: String(raw.parent ?? ""),
      category: String(raw.category ?? ""),
      resourceName: String(raw.resourceName ?? ""),
      state: (raw.state as SecurityFindingState) ?? "ACTIVE",
      severity: (raw.severity as SecurityFindingSeverity) ?? "UNSPECIFIED",
      description: String(raw.description ?? ""),
      sourceProperties: (raw.sourceProperties as Record<string, unknown>) ?? {},
      createTime: String(raw.createTime ?? ""),
      eventTime: String(raw.eventTime ?? ""),
      externalUri: raw.externalUri ? String(raw.externalUri) : undefined,
      recommendation: raw.recommendation ? String(raw.recommendation) : undefined,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createSecurityManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpSecurityManager {
  return new GcpSecurityManager(projectId, getAccessToken, retryOptions);
}
