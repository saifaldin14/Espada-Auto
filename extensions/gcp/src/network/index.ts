/**
 * GCP Extension — Networking Manager
 *
 * Manages VPC networks, subnetworks, firewall rules, load balancers, and addresses.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** A VPC network in Compute Engine. */
export type GcpNetwork = {
  name: string;
  autoCreateSubnetworks: boolean;
  subnetworks: string[];
  routingConfig: { routingMode: string };
  createdAt: string;
};

/** A subnetwork within a VPC network. */
export type GcpSubnetwork = {
  name: string;
  network: string;
  region: string;
  ipCidrRange: string;
  privateIpGoogleAccess: boolean;
};

/** A VPC firewall rule. */
export type GcpFirewallRule = {
  name: string;
  network: string;
  direction: "INGRESS" | "EGRESS";
  priority: number;
  allowed: Array<{ IPProtocol: string; ports?: string[] }>;
  denied: Array<{ IPProtocol: string; ports?: string[] }>;
  sourceRanges: string[];
  targetTags: string[];
  disabled: boolean;
};

/** Input for creating a firewall rule. */
export type GcpFirewallRuleInput = {
  network: string;
  direction: "INGRESS" | "EGRESS";
  priority: number;
  allowed?: Array<{ IPProtocol: string; ports?: string[] }>;
  denied?: Array<{ IPProtocol: string; ports?: string[] }>;
  sourceRanges?: string[];
  targetTags?: string[];
  disabled?: boolean;
  description?: string;
};

/** A load balancer (forwarding rule). */
export type GcpLoadBalancer = {
  name: string;
  type: string;
  scheme: string;
  region?: string;
  ipAddress: string;
  backendServices: string[];
};

/** A reserved static address. */
export type GcpAddress = {
  name: string;
  address: string;
  region: string;
  status: string;
  addressType: "INTERNAL" | "EXTERNAL";
};

// =============================================================================
// GcpNetworkManager
// =============================================================================

/**
 * Manages GCP Networking resources.
 *
 * Provides methods for listing and inspecting VPC networks, subnetworks,
 * firewall rules, load balancers, and IP addresses.
 */
export class GcpNetworkManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all VPC networks in the project. */
  async listNetworks(): Promise<GcpNetwork[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/networks`;
      return [] as GcpNetwork[];
    }, this.retryOptions);
  }

  /** Get a single VPC network by name. */
  async getNetwork(name: string): Promise<GcpNetwork> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/networks/${name}`;
      throw new Error(`Network ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List subnetworks, optionally filtered by region. */
  async listSubnetworks(opts?: { region?: string }): Promise<GcpSubnetwork[]> {
    return withGcpRetry(async () => {
      const _endpoint = opts?.region
        ? `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/regions/${opts.region}/subnetworks`
        : `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/subnetworks`;
      return [] as GcpSubnetwork[];
    }, this.retryOptions);
  }

  /** List all firewall rules in the project. */
  async listFirewallRules(): Promise<GcpFirewallRule[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls`;
      return [] as GcpFirewallRule[];
    }, this.retryOptions);
  }

  /** Get a single firewall rule by name. */
  async getFirewallRule(name: string): Promise<GcpFirewallRule> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls/${name}`;
      throw new Error(`Firewall rule ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** Create a new firewall rule. */
  async createFirewallRule(rule: GcpFirewallRuleInput): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls`;
      const _body = rule;
      return { success: true, message: "Firewall rule created (placeholder)" } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Delete a firewall rule by name. */
  async deleteFirewallRule(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls/${name}`;
      return { success: true, message: `Firewall rule ${name} deleted (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** List load balancers (global forwarding rules). */
  async listLoadBalancers(): Promise<GcpLoadBalancer[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/forwardingRules`;
      return [] as GcpLoadBalancer[];
    }, this.retryOptions);
  }

  /** List reserved IP addresses, optionally filtered by region. */
  async listAddresses(opts?: { region?: string }): Promise<GcpAddress[]> {
    return withGcpRetry(async () => {
      const _endpoint = opts?.region
        ? `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/regions/${opts.region}/addresses`
        : `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/addresses`;
      return [] as GcpAddress[];
    }, this.retryOptions);
  }
}
