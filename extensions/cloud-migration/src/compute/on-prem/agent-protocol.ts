/**
 * On-Prem — Agent Protocol
 *
 * Defines the protocol for communicating with on-premises migration
 * agents installed on hypervisor hosts. The agent provides VM
 * inventory, snapshot, and image export capabilities.
 */

import type { MigrationProvider } from "../../types.js";

// =============================================================================
// Agent Protocol Types
// =============================================================================

export interface AgentEndpoint {
  host: string;
  port: number;
  protocol: "https" | "grpc";
  apiKey: string;
  tlsVerify?: boolean;
}

export interface AgentCapabilities {
  snapshotSupport: boolean;
  incrementalSync: boolean;
  liveExport: boolean;
  changedBlockTracking: boolean;
  maxConcurrentExports: number;
}

export interface AgentInventoryRequest {
  filters?: {
    hypervisor?: string;
    cluster?: string;
    datacenter?: string;
    tags?: Record<string, string>;
  };
}

export interface AgentVMInfo {
  id: string;
  name: string;
  hypervisor: MigrationProvider;
  vcpus: number;
  memoryMB: number;
  disks: Array<{
    id: string;
    sizeGB: number;
    path: string;
    format: "vmdk" | "qcow2" | "raw" | "vhd";
  }>;
  nics: Array<{
    id: string;
    macAddress: string;
    network: string;
    ipAddress?: string;
  }>;
  powerState: "on" | "off" | "suspended";
  guestOS?: string;
  cluster?: string;
  datacenter?: string;
  tags?: Record<string, string>;
}

export interface AgentSnapshotRequest {
  vmId: string;
  name: string;
  quiesce?: boolean;
  memory?: boolean;
}

export interface AgentSnapshotResponse {
  snapshotId: string;
  vmId: string;
  name: string;
  createdAt: string;
  diskSnapshots: Array<{
    diskId: string;
    snapshotPath: string;
    sizeGB: number;
  }>;
}

export interface AgentExportRequest {
  vmId: string;
  snapshotId: string;
  format: "ova" | "vmdk" | "qcow2" | "raw";
  destination: {
    type: "http" | "s3" | "nfs" | "local";
    url: string;
    credentials?: Record<string, string>;
  };
  changedBlocksOnly?: boolean;
  previousSnapshotId?: string;
}

export interface AgentExportProgress {
  taskId: string;
  status: "queued" | "exporting" | "uploading" | "complete" | "failed";
  progressPercent: number;
  bytesTransferred: number;
  estimatedRemainingMs: number;
  error?: string;
}

// =============================================================================
// Agent Client
// =============================================================================

/**
 * Internal helper: perform an HTTP request to the agent.
 * Uses Node's built-in fetch (Node 18+). Falls back to https/http modules.
 */
async function agentFetch<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  opts: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
  };
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchOpts: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (opts.body !== undefined) {
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const response = await fetch(url, fetchOpts);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Agent request failed: ${method} ${path} → ${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Default retry configuration for agent operations. */
export interface AgentRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: AgentRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
};

async function withRetry<T>(
  fn: () => Promise<T>,
  config: AgentRetryConfig = DEFAULT_RETRY,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt),
          config.maxDelayMs,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Client for communicating with on-prem migration agents.
 *
 * All operations communicate with the agent via HTTPS REST API.
 * The agent runs inside the customer datacenter and exposes:
 *   - /api/v1/capabilities    — Agent health & feature flags
 *   - /api/v1/vms             — VM inventory discovery
 *   - /api/v1/snapshots       — Snapshot lifecycle
 *   - /api/v1/exports         — Disk image export tasks
 */
export class MigrationAgentClient {
  private endpoint: AgentEndpoint;
  private retryConfig: AgentRetryConfig;

  constructor(endpoint: AgentEndpoint, retryConfig?: AgentRetryConfig) {
    this.endpoint = endpoint;
    this.retryConfig = retryConfig ?? DEFAULT_RETRY;
  }

  get baseUrl(): string {
    return `${this.endpoint.protocol}://${this.endpoint.host}:${this.endpoint.port}`;
  }

  /**
   * Check agent health and capabilities.
   */
  async getCapabilities(): Promise<AgentCapabilities> {
    return withRetry(
      () => agentFetch<AgentCapabilities>(
        this.baseUrl,
        "/api/v1/capabilities",
        this.endpoint.apiKey,
        { timeoutMs: 10_000 },
      ),
      this.retryConfig,
    );
  }

  /**
   * Discover VMs managed by the agent.
   */
  async discoverVMs(request?: AgentInventoryRequest): Promise<AgentVMInfo[]> {
    return withRetry(
      () => agentFetch<AgentVMInfo[]>(
        this.baseUrl,
        "/api/v1/vms",
        this.endpoint.apiKey,
        { method: "POST", body: request ?? {} },
      ),
      this.retryConfig,
    );
  }

  /**
   * Create a snapshot of a VM.
   */
  async createSnapshot(request: AgentSnapshotRequest): Promise<AgentSnapshotResponse> {
    return withRetry(
      () => agentFetch<AgentSnapshotResponse>(
        this.baseUrl,
        `/api/v1/vms/${encodeURIComponent(request.vmId)}/snapshots`,
        this.endpoint.apiKey,
        { method: "POST", body: request },
      ),
      this.retryConfig,
    );
  }

  /**
   * Delete a snapshot.
   */
  async deleteSnapshot(vmId: string, snapshotId: string): Promise<void> {
    await withRetry(
      () => agentFetch<unknown>(
        this.baseUrl,
        `/api/v1/vms/${encodeURIComponent(vmId)}/snapshots/${encodeURIComponent(snapshotId)}`,
        this.endpoint.apiKey,
        { method: "DELETE" },
      ),
      this.retryConfig,
    );
  }

  /**
   * Start an export task.
   */
  async startExport(request: AgentExportRequest): Promise<string> {
    const result = await withRetry(
      () => agentFetch<{ taskId: string }>(
        this.baseUrl,
        "/api/v1/exports",
        this.endpoint.apiKey,
        { method: "POST", body: request },
      ),
      this.retryConfig,
    );
    return result.taskId;
  }

  /**
   * Get export progress.
   */
  async getExportProgress(taskId: string): Promise<AgentExportProgress> {
    return withRetry(
      () => agentFetch<AgentExportProgress>(
        this.baseUrl,
        `/api/v1/exports/${encodeURIComponent(taskId)}`,
        this.endpoint.apiKey,
      ),
      this.retryConfig,
    );
  }

  /**
   * Cancel an export task.
   */
  async cancelExport(taskId: string): Promise<void> {
    await withRetry(
      () => agentFetch<unknown>(
        this.baseUrl,
        `/api/v1/exports/${encodeURIComponent(taskId)}`,
        this.endpoint.apiKey,
        { method: "DELETE" },
      ),
      this.retryConfig,
    );
  }

  /**
   * Poll an export task until it reaches a terminal state.
   * @returns The final export progress (status === "complete" or "failed").
   */
  async waitForExport(
    taskId: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number; onProgress?: (p: AgentExportProgress) => void },
  ): Promise<AgentExportProgress> {
    const pollInterval = opts?.pollIntervalMs ?? 5_000;
    const timeout = opts?.timeoutMs ?? 3_600_000; // 1 hour default
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const progress = await this.getExportProgress(taskId);
      opts?.onProgress?.(progress);

      if (progress.status === "complete" || progress.status === "failed") {
        return progress;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`Export task ${taskId} timed out after ${timeout}ms`);
  }

  /**
   * Import a disk image into the on-prem hypervisor.
   * The agent pulls the image from the specified source and creates a VM disk.
   */
  async importImage(params: {
    sourceUrl: string;
    format: "vmdk" | "qcow2" | "raw" | "vhd";
    targetDatastore?: string;
    vmName?: string;
  }): Promise<{ diskId: string; importTaskId: string }> {
    return withRetry(
      () => agentFetch<{ diskId: string; importTaskId: string }>(
        this.baseUrl,
        "/api/v1/imports",
        this.endpoint.apiKey,
        { method: "POST", body: params },
      ),
      this.retryConfig,
    );
  }

  /**
   * Provision a VM on the on-prem hypervisor from an imported disk.
   */
  async provisionVM(params: {
    diskId: string;
    vmName: string;
    cpuCores: number;
    memoryMB: number;
    networkName?: string;
    tags?: Record<string, string>;
  }): Promise<{ vmId: string; ipAddress?: string }> {
    return withRetry(
      () => agentFetch<{ vmId: string; ipAddress?: string }>(
        this.baseUrl,
        "/api/v1/vms",
        this.endpoint.apiKey,
        { method: "PUT", body: params },
      ),
      this.retryConfig,
    );
  }

  /**
   * Get the status of a VM.
   */
  async getVMStatus(vmId: string): Promise<{ vmId: string; powerState: string; ipAddress?: string }> {
    return withRetry(
      () => agentFetch<{ vmId: string; powerState: string; ipAddress?: string }>(
        this.baseUrl,
        `/api/v1/vms/${encodeURIComponent(vmId)}/status`,
        this.endpoint.apiKey,
      ),
      this.retryConfig,
    );
  }

  /**
   * Stop a VM.
   */
  async stopVM(vmId: string): Promise<void> {
    await withRetry(
      () => agentFetch<unknown>(
        this.baseUrl,
        `/api/v1/vms/${encodeURIComponent(vmId)}/stop`,
        this.endpoint.apiKey,
        { method: "POST" },
      ),
      this.retryConfig,
    );
  }

  /**
   * Terminate/delete a VM.
   */
  async terminateVM(vmId: string): Promise<void> {
    await withRetry(
      () => agentFetch<unknown>(
        this.baseUrl,
        `/api/v1/vms/${encodeURIComponent(vmId)}`,
        this.endpoint.apiKey,
        { method: "DELETE" },
      ),
      this.retryConfig,
    );
  }

  /**
   * List DNS records managed by the on-prem DNS server.
   */
  async listDNSRecords(zoneId?: string): Promise<Array<{ name: string; type: string; ttl: number; values: string[] }>> {
    const path = zoneId ? `/api/v1/dns/zones/${encodeURIComponent(zoneId)}/records` : "/api/v1/dns/records";
    return withRetry(
      () => agentFetch<Array<{ name: string; type: string; ttl: number; values: string[] }>>(
        this.baseUrl,
        path,
        this.endpoint.apiKey,
      ),
      this.retryConfig,
    );
  }

  /**
   * Create or update a DNS record.
   */
  async upsertDNSRecord(zoneId: string, record: { name: string; type: string; ttl: number; values: string[] }): Promise<void> {
    await withRetry(
      () => agentFetch<unknown>(
        this.baseUrl,
        `/api/v1/dns/zones/${encodeURIComponent(zoneId)}/records`,
        this.endpoint.apiKey,
        { method: "PUT", body: record },
      ),
      this.retryConfig,
    );
  }

  /**
   * List firewall/security rules on the on-prem infrastructure.
   */
  async listFirewallRules(): Promise<Array<{
    id: string; name: string; direction: string; action: string;
    protocol: string; portRange: { from: number; to: number };
    source: string; destination: string; priority: number;
  }>> {
    return withRetry(
      () => agentFetch(
        this.baseUrl,
        "/api/v1/network/firewall-rules",
        this.endpoint.apiKey,
      ),
      this.retryConfig,
    );
  }

  /**
   * Create firewall/security rules on the on-prem infrastructure.
   */
  async createFirewallRules(rules: Array<{
    name: string; direction: string; action: string;
    protocol: string; portRange: { from: number; to: number };
    source: string; destination: string; priority: number;
  }>): Promise<{ createdCount: number; ruleIds: string[] }> {
    return withRetry(
      () => agentFetch(
        this.baseUrl,
        "/api/v1/network/firewall-rules",
        this.endpoint.apiKey,
        { method: "POST", body: { rules } },
      ),
      this.retryConfig,
    );
  }

  /**
   * List network segments/VLANs.
   */
  async listNetworks(): Promise<Array<{ id: string; name: string; cidr?: string; vlanId?: number }>> {
    return withRetry(
      () => agentFetch(
        this.baseUrl,
        "/api/v1/network/segments",
        this.endpoint.apiKey,
      ),
      this.retryConfig,
    );
  }
}
