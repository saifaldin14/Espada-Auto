/**
 * GCP Extension — Networking Manager
 *
 * Manages VPC networks, subnetworks, firewall rules, load balancers, and addresses.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpAggregatedList, gcpRequest, gcpMutate, shortName } from "../api.js";

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
  private getAccessToken: () => Promise<string>;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all VPC networks in the project. */
  async listNetworks(): Promise<GcpNetwork[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/networks`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "items");
      return raw.map((n) => ({
        name: (n.name as string) ?? "",
        autoCreateSubnetworks: (n.autoCreateSubnetworks as boolean) ?? false,
        subnetworks: (n.subnetworks as string[]) ?? [],
        routingConfig: (n.routingConfig as { routingMode: string }) ?? { routingMode: "" },
        createdAt: (n.creationTimestamp as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Get a single VPC network by name. */
  async getNetwork(name: string): Promise<GcpNetwork> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/networks/${name}`;
      const n = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: (n.name as string) ?? "",
        autoCreateSubnetworks: (n.autoCreateSubnetworks as boolean) ?? false,
        subnetworks: (n.subnetworks as string[]) ?? [],
        routingConfig: (n.routingConfig as { routingMode: string }) ?? { routingMode: "" },
        createdAt: (n.creationTimestamp as string) ?? "",
      };
    }, this.retryOptions);
  }

  /** List subnetworks, optionally filtered by region. */
  async listSubnetworks(opts?: { region?: string }): Promise<GcpSubnetwork[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      let raw: Record<string, unknown>[];
      if (opts?.region) {
        const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/regions/${opts.region}/subnetworks`;
        raw = await gcpList<Record<string, unknown>>(url, token, "items");
      } else {
        const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/subnetworks`;
        raw = await gcpAggregatedList<Record<string, unknown>>(url, token, "subnetworks");
      }
      return raw.map((s) => ({
        name: (s.name as string) ?? "",
        network: shortName((s.network as string) ?? ""),
        region: shortName((s.region as string) ?? ""),
        ipCidrRange: (s.ipCidrRange as string) ?? "",
        privateIpGoogleAccess: (s.privateIpGoogleAccess as boolean) ?? false,
      }));
    }, this.retryOptions);
  }

  /** List all firewall rules in the project. */
  async listFirewallRules(): Promise<GcpFirewallRule[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "items");
      return raw.map((f) => ({
        name: (f.name as string) ?? "",
        network: shortName((f.network as string) ?? ""),
        direction: (f.direction as "INGRESS" | "EGRESS") ?? "INGRESS",
        priority: (f.priority as number) ?? 1000,
        allowed: (f.allowed as GcpFirewallRule["allowed"]) ?? [],
        denied: (f.denied as GcpFirewallRule["denied"]) ?? [],
        sourceRanges: (f.sourceRanges as string[]) ?? [],
        targetTags: (f.targetTags as string[]) ?? [],
        disabled: (f.disabled as boolean) ?? false,
      }));
    }, this.retryOptions);
  }

  /** Get a single firewall rule by name. */
  async getFirewallRule(name: string): Promise<GcpFirewallRule> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls/${name}`;
      const f = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: (f.name as string) ?? "",
        network: shortName((f.network as string) ?? ""),
        direction: (f.direction as "INGRESS" | "EGRESS") ?? "INGRESS",
        priority: (f.priority as number) ?? 1000,
        allowed: (f.allowed as GcpFirewallRule["allowed"]) ?? [],
        denied: (f.denied as GcpFirewallRule["denied"]) ?? [],
        sourceRanges: (f.sourceRanges as string[]) ?? [],
        targetTags: (f.targetTags as string[]) ?? [],
        disabled: (f.disabled as boolean) ?? false,
      };
    }, this.retryOptions);
  }

  /** Create a new firewall rule. */
  async createFirewallRule(name: string, rule: GcpFirewallRuleInput): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls`;
      return gcpMutate(url, token, { name, ...rule });
    }, this.retryOptions);
  }

  /** Delete a firewall rule by name. */
  async deleteFirewallRule(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/firewalls/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** List load balancers (global forwarding rules). */
  async listLoadBalancers(): Promise<GcpLoadBalancer[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/forwardingRules`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "items");
      return raw.map((r) => {
        const backend = (r.target as string) || (r.backendService as string) || "";
        return {
          name: (r.name as string) ?? "",
          scheme: (r.loadBalancingScheme as string) ?? "",
          type: (r.IPProtocol as string) ?? "",
          region: r.region ? shortName(r.region as string) : undefined,
          ipAddress: (r.IPAddress as string) ?? "",
          backendServices: backend ? [backend] : [],
        };
      });
    }, this.retryOptions);
  }

  /** List reserved IP addresses, optionally filtered by region. */
  async listAddresses(opts?: { region?: string }): Promise<GcpAddress[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      let raw: Record<string, unknown>[];
      if (opts?.region) {
        const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/regions/${opts.region}/addresses`;
        raw = await gcpList<Record<string, unknown>>(url, token, "items");
      } else {
        const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/addresses`;
        raw = await gcpAggregatedList<Record<string, unknown>>(url, token, "addresses");
      }
      return raw.map((a) => ({
        name: (a.name as string) ?? "",
        address: (a.address as string) ?? "",
        status: (a.status as string) ?? "",
        addressType: (a.addressType as "INTERNAL" | "EXTERNAL") ?? "EXTERNAL",
        region: shortName((a.region as string) ?? ""),
      }));
    }, this.retryOptions);
  }
}
