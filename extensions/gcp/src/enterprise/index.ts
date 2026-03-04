/**
 * GCP Enterprise Manager
 *
 * Manages GCP organization hierarchy, projects, folders, billing
 * accounts, and IAM at the org level using Resource Manager and
 * Cloud Billing APIs.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type Organization = {
  name: string;
  displayName: string;
  directoryCustomerId: string;
  state: "ACTIVE" | "DELETE_REQUESTED";
  createTime: string;
  updateTime: string;
  etag: string;
};

export type Folder = {
  name: string;
  parent: string;
  displayName: string;
  state: "ACTIVE" | "DELETE_REQUESTED";
  createTime: string;
  updateTime: string;
  etag: string;
};

export type Project = {
  name: string;
  projectId: string;
  displayName: string;
  parent: string;
  state: "ACTIVE" | "DELETE_REQUESTED" | "DELETE_IN_PROGRESS";
  labels: Record<string, string>;
  createTime: string;
  updateTime: string;
  etag: string;
};

export type CreateFolderOptions = {
  parent: string;
  displayName: string;
};

export type CreateProjectOptions = {
  projectId: string;
  displayName: string;
  parent: string;
  labels?: Record<string, string>;
};

export type IamBinding = {
  role: string;
  members: string[];
  condition?: {
    title: string;
    expression: string;
    description?: string;
  };
};

export type IamPolicy = {
  bindings: IamBinding[];
  etag: string;
  version: number;
};

export type BillingAccount = {
  name: string;
  displayName: string;
  open: boolean;
  masterBillingAccount?: string;
};

export type BillingInfo = {
  name: string;
  projectId: string;
  billingAccountName: string;
  billingEnabled: boolean;
};

export type OrgQuota = {
  metric: string;
  limit: number;
  usage: number;
  unit: string;
};

// =============================================================================
// Manager
// =============================================================================

const CRM_BASE = "https://cloudresourcemanager.googleapis.com/v3";
const BILLING_BASE = "https://cloudbilling.googleapis.com/v1";

export class GcpEnterpriseManager {
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
      service: "enterprise",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  async listOrganizations(): Promise<Organization[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/organizations:search`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token, { method: "POST", body: {} });
      const orgs = (raw.organizations ?? []) as Array<Record<string, unknown>>;
      return orgs.map((o) => this.mapOrganization(o));
    }, this.retryOptions);
  }

  async getOrganization(orgId: string): Promise<Organization> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/organizations/${orgId}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapOrganization(raw);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  async listFolders(parent: string): Promise<Folder[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/folders?parent=${encodeURIComponent(parent)}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "folders");
      return items.map((f) => this.mapFolder(f));
    }, this.retryOptions);
  }

  async getFolder(folderId: string): Promise<Folder> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/folders/${folderId}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapFolder(raw);
    }, this.retryOptions);
  }

  async createFolder(opts: CreateFolderOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/folders`;
      const body = { parent: opts.parent, displayName: opts.displayName };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: `Folder "${opts.displayName}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteFolder(folderId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/folders/${folderId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async moveFolder(folderId: string, destinationParent: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/folders/${folderId}:move`;
      const result = await gcpMutate(url, token, { destinationParent });
      return { success: true, message: `Folder moved to ${destinationParent}`, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async listProjects(parent?: string): Promise<Project[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = parent ? `?parent=${encodeURIComponent(parent)}` : "";
      const url = `${CRM_BASE}/projects${params}`;
      const items = await gcpList<Record<string, unknown>>(url, token, "projects");
      return items.map((p) => this.mapProject(p));
    }, this.retryOptions);
  }

  async getProject(projectId?: string): Promise<Project> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const id = projectId ?? this.projectId;
      const url = `${CRM_BASE}/projects/${id}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapProject(raw);
    }, this.retryOptions);
  }

  async createProject(opts: CreateProjectOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/projects`;
      const body = {
        projectId: opts.projectId,
        displayName: opts.displayName,
        parent: opts.parent,
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: `Project "${opts.projectId}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteProject(projectId: string): Promise<GcpOperationResult> {
    if (!projectId) {
      throw new Error("deleteProject requires an explicit projectId argument");
    }
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${CRM_BASE}/projects/${projectId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async updateProjectLabels(labels: Record<string, string>, projectId?: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const id = projectId ?? this.projectId;
      const url = `${CRM_BASE}/projects/${id}`;
      const current = await gcpRequest<Record<string, unknown>>(url, token);
      const body = { ...current, labels };
      await gcpMutate(url, token, body, "PATCH");
      return { success: true, message: "Labels updated" };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // IAM
  // ---------------------------------------------------------------------------

  async getIamPolicy(resource?: string): Promise<IamPolicy> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const target = resource ?? `projects/${this.projectId}`;
      const url = `${CRM_BASE}/${target}:getIamPolicy`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token, {
        method: "POST",
        body: { options: { requestedPolicyVersion: 3 } },
      });
      return this.mapIamPolicy(raw);
    }, this.retryOptions);
  }

  async setIamPolicy(policy: IamPolicy, resource?: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const target = resource ?? `projects/${this.projectId}`;
      const url = `${CRM_BASE}/${target}:setIamPolicy`;
      await gcpMutate(url, token, { policy: { bindings: policy.bindings, etag: policy.etag, version: 3 } });
      return {
        success: true,
        message: "IAM policy updated",
      };
    }, this.retryOptions);
  }

  async addIamBinding(role: string, member: string, resource?: string): Promise<GcpOperationResult> {
    const policy = await this.getIamPolicy(resource);
    const existing = policy.bindings.find((b) => b.role === role);
    if (existing) {
      if (!existing.members.includes(member)) {
        existing.members.push(member);
      }
    } else {
      policy.bindings.push({ role, members: [member] });
    }
    return this.setIamPolicy(policy, resource);
  }

  async removeIamBinding(role: string, member: string, resource?: string): Promise<GcpOperationResult> {
    const policy = await this.getIamPolicy(resource);
    const binding = policy.bindings.find((b) => b.role === role);
    if (binding) {
      binding.members = binding.members.filter((m) => m !== member);
      if (binding.members.length === 0) {
        policy.bindings = policy.bindings.filter((b) => b.role !== role);
      }
    }
    return this.setIamPolicy(policy, resource);
  }

  // ---------------------------------------------------------------------------
  // Billing
  // ---------------------------------------------------------------------------

  async listBillingAccounts(): Promise<BillingAccount[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BILLING_BASE}/billingAccounts`;
      const items = await gcpList<Record<string, unknown>>(url, token, "billingAccounts");
      return items.map((b) => ({
        name: String(b.name ?? ""),
        displayName: String(b.displayName ?? ""),
        open: Boolean(b.open),
        masterBillingAccount: b.masterBillingAccount ? String(b.masterBillingAccount) : undefined,
      }));
    }, this.retryOptions);
  }

  async getProjectBillingInfo(projectId?: string): Promise<BillingInfo> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const id = projectId ?? this.projectId;
      const url = `${BILLING_BASE}/projects/${id}/billingInfo`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: String(raw.name ?? ""),
        projectId: String(raw.projectId ?? id),
        billingAccountName: String(raw.billingAccountName ?? ""),
        billingEnabled: Boolean(raw.billingEnabled),
      };
    }, this.retryOptions);
  }

  async linkBillingAccount(billingAccountName: string, projectId?: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const id = projectId ?? this.projectId;
      const url = `${BILLING_BASE}/projects/${id}/billingInfo`;
      await gcpMutate(url, token, { billingAccountName }, "PUT");
      return { success: true, message: `Billing account linked to project ${id}` };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mapOrganization(raw: Record<string, unknown>): Organization {
    return {
      name: String(raw.name ?? ""),
      displayName: String(raw.displayName ?? ""),
      directoryCustomerId: String(raw.directoryCustomerId ?? ""),
      state: (raw.state as Organization["state"]) ?? "ACTIVE",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      etag: String(raw.etag ?? ""),
    };
  }

  private mapFolder(raw: Record<string, unknown>): Folder {
    return {
      name: String(raw.name ?? ""),
      parent: String(raw.parent ?? ""),
      displayName: String(raw.displayName ?? ""),
      state: (raw.state as Folder["state"]) ?? "ACTIVE",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      etag: String(raw.etag ?? ""),
    };
  }

  private mapProject(raw: Record<string, unknown>): Project {
    return {
      name: String(raw.name ?? ""),
      projectId: String(raw.projectId ?? ""),
      displayName: String(raw.displayName ?? ""),
      parent: String(raw.parent ?? ""),
      state: (raw.state as Project["state"]) ?? "ACTIVE",
      labels: (raw.labels as Record<string, string>) ?? {},
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      etag: String(raw.etag ?? ""),
    };
  }

  private mapIamPolicy(raw: Record<string, unknown>): IamPolicy {
    const bindings = (raw.bindings ?? []) as Array<Record<string, unknown>>;
    return {
      bindings: bindings.map((b) => ({
        role: String(b.role ?? ""),
        members: (b.members ?? []) as string[],
        condition: b.condition
          ? {
              title: String((b.condition as Record<string, unknown>).title ?? ""),
              expression: String((b.condition as Record<string, unknown>).expression ?? ""),
              description: (b.condition as Record<string, unknown>).description
                ? String((b.condition as Record<string, unknown>).description)
                : undefined,
            }
          : undefined,
      })),
      etag: String(raw.etag ?? ""),
      version: Number(raw.version ?? 1),
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createEnterpriseManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpEnterpriseManager {
  return new GcpEnterpriseManager(projectId, getAccessToken, retryOptions);
}
