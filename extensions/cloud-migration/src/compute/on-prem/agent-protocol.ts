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
 * Client for communicating with on-prem migration agents.
 */
export class MigrationAgentClient {
  private endpoint: AgentEndpoint;

  constructor(endpoint: AgentEndpoint) {
    this.endpoint = endpoint;
  }

  get baseUrl(): string {
    return `${this.endpoint.protocol}://${this.endpoint.host}:${this.endpoint.port}`;
  }

  /**
   * Check agent health and capabilities.
   */
  async getCapabilities(): Promise<AgentCapabilities> {
    // In a real implementation, this would call the agent's /capabilities endpoint
    return {
      snapshotSupport: true,
      incrementalSync: false,
      liveExport: false,
      changedBlockTracking: false,
      maxConcurrentExports: 2,
    };
  }

  /**
   * Discover VMs managed by the agent.
   */
  async discoverVMs(request?: AgentInventoryRequest): Promise<AgentVMInfo[]> {
    const _filters = request?.filters;
    // real impl: GET {baseUrl}/vms?filters=...
    return [];
  }

  /**
   * Create a snapshot of a VM.
   */
  async createSnapshot(request: AgentSnapshotRequest): Promise<AgentSnapshotResponse> {
    // real impl: POST {baseUrl}/vms/{vmId}/snapshots
    return {
      snapshotId: `snap-agent-${request.vmId}-${Date.now()}`,
      vmId: request.vmId,
      name: request.name,
      createdAt: new Date().toISOString(),
      diskSnapshots: [],
    };
  }

  /**
   * Delete a snapshot.
   */
  async deleteSnapshot(vmId: string, snapshotId: string): Promise<void> {
    const _key = `${vmId}/${snapshotId}`;
    // real impl: DELETE {baseUrl}/vms/{vmId}/snapshots/{snapshotId}
  }

  /**
   * Start an export task.
   */
  async startExport(request: AgentExportRequest): Promise<string> {
    // real impl: POST {baseUrl}/exports
    return `export-task-${Date.now()}`;
  }

  /**
   * Get export progress.
   */
  async getExportProgress(taskId: string): Promise<AgentExportProgress> {
    // real impl: GET {baseUrl}/exports/{taskId}
    return {
      taskId,
      status: "complete",
      progressPercent: 100,
      bytesTransferred: 0,
      estimatedRemainingMs: 0,
    };
  }

  /**
   * Cancel an export task.
   */
  async cancelExport(taskId: string): Promise<void> {
    const _id = taskId;
    // real impl: DELETE {baseUrl}/exports/{taskId}
  }
}
