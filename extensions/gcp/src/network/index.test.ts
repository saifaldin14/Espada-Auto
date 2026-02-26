import { describe, it, expect, vi, beforeEach } from "vitest";
import { GcpNetworkManager } from "./index.js";
import { gcpRequest, gcpList, gcpAggregatedList, gcpMutate } from "../api.js";

vi.mock("../api.js", () => ({
  gcpRequest: vi.fn(),
  gcpList: vi.fn(),
  gcpAggregatedList: vi.fn(),
  gcpMutate: vi.fn(),
  shortName: (s: string) => s.split("/").pop() ?? s,
}));

vi.mock("../retry.js", () => ({
  withGcpRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const PROJECT = "test-project";
const TOKEN = "tok_test";
const getToken = vi.fn(async () => TOKEN);

function makeManager() {
  return new GcpNetworkManager(PROJECT, getToken);
}

describe("GcpNetworkManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Networks
  // ---------------------------------------------------------------------------

  describe("listNetworks", () => {
    it("returns mapped VPC networks", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([
        { name: "default", autoCreateSubnetworks: true, subnetworks: ["sub1"], routingConfig: { routingMode: "REGIONAL" }, creationTimestamp: "2024-01-01" },
      ]);

      const result = await makeManager().listNetworks();

      expect(gcpList).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/networks`,
        TOKEN,
        "items",
      );
      expect(result).toEqual([
        { name: "default", autoCreateSubnetworks: true, subnetworks: ["sub1"], routingConfig: { routingMode: "REGIONAL" }, createdAt: "2024-01-01" },
      ]);
    });

    it("handles missing fields with defaults", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([{}]);
      const result = await makeManager().listNetworks();
      expect(result[0]).toEqual({ name: "", autoCreateSubnetworks: false, subnetworks: [], routingConfig: { routingMode: "" }, createdAt: "" });
    });
  });

  describe("getNetwork", () => {
    it("fetches a single VPC network by name", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({ name: "my-vpc", autoCreateSubnetworks: false, subnetworks: [], routingConfig: { routingMode: "GLOBAL" }, creationTimestamp: "2024-06-01" });

      const result = await makeManager().getNetwork("my-vpc");

      expect(gcpRequest).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/networks/my-vpc`,
        TOKEN,
      );
      expect(result.name).toBe("my-vpc");
      expect(result.routingConfig.routingMode).toBe("GLOBAL");
    });
  });

  // ---------------------------------------------------------------------------
  // Subnetworks
  // ---------------------------------------------------------------------------

  describe("listSubnetworks", () => {
    it("uses aggregated list when no region specified", async () => {
      vi.mocked(gcpAggregatedList).mockResolvedValueOnce([
        { name: "sub1", network: "projects/p/global/networks/default", region: "projects/p/regions/us-central1", ipCidrRange: "10.0.0.0/24", privateIpGoogleAccess: true },
      ]);

      const result = await makeManager().listSubnetworks();

      expect(gcpAggregatedList).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/subnetworks`,
        TOKEN,
        "subnetworks",
      );
      expect(result[0]).toEqual({ name: "sub1", network: "default", region: "us-central1", ipCidrRange: "10.0.0.0/24", privateIpGoogleAccess: true });
    });

    it("uses region-scoped list when region is provided", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([
        { name: "sub2", network: "projects/p/global/networks/vpc1", region: "projects/p/regions/europe-west1", ipCidrRange: "10.1.0.0/24", privateIpGoogleAccess: false },
      ]);

      const result = await makeManager().listSubnetworks({ region: "europe-west1" });

      expect(gcpList).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/europe-west1/subnetworks`,
        TOKEN,
        "items",
      );
      expect(result[0].name).toBe("sub2");
    });
  });

  // ---------------------------------------------------------------------------
  // Firewall Rules
  // ---------------------------------------------------------------------------

  describe("listFirewallRules", () => {
    it("returns mapped firewall rules", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([
        { name: "allow-ssh", network: "projects/p/global/networks/default", direction: "INGRESS", priority: 1000, allowed: [{ IPProtocol: "tcp", ports: ["22"] }], sourceRanges: ["0.0.0.0/0"], targetTags: ["ssh"], disabled: false },
      ]);

      const result = await makeManager().listFirewallRules();

      expect(gcpList).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/firewalls`,
        TOKEN,
        "items",
      );
      expect(result[0].name).toBe("allow-ssh");
      expect(result[0].network).toBe("default");
      expect(result[0].allowed).toEqual([{ IPProtocol: "tcp", ports: ["22"] }]);
    });
  });

  describe("getFirewallRule", () => {
    it("fetches a single firewall rule", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({ name: "deny-all", network: "projects/p/global/networks/vpc1", direction: "EGRESS", priority: 65534, denied: [{ IPProtocol: "all" }], disabled: true });

      const result = await makeManager().getFirewallRule("deny-all");

      expect(gcpRequest).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/firewalls/deny-all`,
        TOKEN,
      );
      expect(result.direction).toBe("EGRESS");
      expect(result.disabled).toBe(true);
    });
  });

  describe("createFirewallRule", () => {
    it("sends POST with rule body", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ status: "DONE", operationId: "op-1" });

      const rule = { network: "default", direction: "INGRESS" as const, priority: 1000, allowed: [{ IPProtocol: "tcp", ports: ["443"] }] };
      const result = await makeManager().createFirewallRule("allow-https", rule);

      expect(gcpMutate).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/firewalls`,
        TOKEN,
        { name: "allow-https", ...rule },
      );
      expect(result.status).toBe("DONE");
    });
  });

  describe("deleteFirewallRule", () => {
    it("sends DELETE for the named rule", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ status: "DONE", operationId: "op-2" });

      const result = await makeManager().deleteFirewallRule("old-rule");

      expect(gcpMutate).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/firewalls/old-rule`,
        TOKEN,
        undefined,
        "DELETE",
      );
      expect(result.status).toBe("DONE");
    });
  });

  // ---------------------------------------------------------------------------
  // Load Balancers
  // ---------------------------------------------------------------------------

  describe("listLoadBalancers", () => {
    it("returns mapped forwarding rules", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([
        { name: "lb-1", loadBalancingScheme: "EXTERNAL", IPProtocol: "TCP", IPAddress: "34.1.2.3", target: "projects/p/targetHttpProxies/proxy-1" },
      ]);

      const result = await makeManager().listLoadBalancers();

      expect(result[0]).toEqual({ name: "lb-1", scheme: "EXTERNAL", type: "TCP", ipAddress: "34.1.2.3", region: undefined, backendServices: ["projects/p/targetHttpProxies/proxy-1"] });
    });

    it("returns empty backendServices when no target or backendService", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([{ name: "lb-empty", IPAddress: "10.0.0.1" }]);

      const result = await makeManager().listLoadBalancers();
      expect(result[0].backendServices).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------

  describe("listAddresses", () => {
    it("uses aggregated list when no region specified", async () => {
      vi.mocked(gcpAggregatedList).mockResolvedValueOnce([
        { name: "addr-1", address: "34.5.6.7", status: "IN_USE", addressType: "EXTERNAL", region: "projects/p/regions/us-east1" },
      ]);

      const result = await makeManager().listAddresses();

      expect(gcpAggregatedList).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/addresses`,
        TOKEN,
        "addresses",
      );
      expect(result[0]).toEqual({ name: "addr-1", address: "34.5.6.7", status: "IN_USE", addressType: "EXTERNAL", region: "us-east1" });
    });

    it("uses region-scoped list when region is provided", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([
        { name: "addr-2", address: "10.0.0.5", status: "RESERVED", addressType: "INTERNAL", region: "projects/p/regions/us-west1" },
      ]);

      const result = await makeManager().listAddresses({ region: "us-west1" });

      expect(gcpList).toHaveBeenCalledWith(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/us-west1/addresses`,
        TOKEN,
        "items",
      );
      expect(result[0].name).toBe("addr-2");
      expect(result[0].addressType).toBe("INTERNAL");
    });
  });
});
