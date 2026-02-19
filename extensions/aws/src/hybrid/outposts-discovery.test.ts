/**
 * Tests for AWS Outposts Discovery Adapter
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AwsOutpostsDiscoveryAdapter } from "./outposts-discovery.js";
import type { AwsOutpostSite, AwsOutpost, AwsOutpostAsset, EKSAnywhereCluster } from "./types.js";

describe("AwsOutpostsDiscoveryAdapter", () => {
  let adapter: AwsOutpostsDiscoveryAdapter;

  beforeEach(() => {
    adapter = new AwsOutpostsDiscoveryAdapter("us-east-1");
  });

  describe("discoverSites", () => {
    it("maps outpost sites to hybrid sites", async () => {
      const site: AwsOutpostSite = {
        siteId: "site-001",
        siteArn: "arn:aws:outposts:us-east-1:123456789:site/site-001",
        accountId: "123456789",
        name: "NYC Data Center",
        operatingAddressCity: "New York",
        operatingAddressStateOrRegion: "NY",
        operatingAddressCountryCode: "US",
      };

      const outpost: AwsOutpost = {
        outpostId: "op-001",
        outpostArn: "arn:aws:outposts:us-east-1:123456789:outpost/op-001",
        ownerId: "123456789",
        name: "Outpost 1",
        siteId: "site-001",
        availabilityZone: "us-east-1a",
        availabilityZoneId: "use1-az1",
        lifeCycleStatus: "ACTIVE",
      };

      vi.spyOn(adapter, "listOutpostSites").mockResolvedValue([site]);
      vi.spyOn(adapter, "listOutposts").mockResolvedValue([outpost]);
      vi.spyOn(adapter, "listOutpostAssets").mockResolvedValue([]);

      const sites = await adapter.discoverSites();

      expect(sites).toHaveLength(1);
      expect(sites[0].id).toBe("site-001");
      expect(sites[0].name).toBe("NYC Data Center");
      expect(sites[0].provider).toBe("aws");
      expect(sites[0].type).toBe("datacenter");
      expect(sites[0].status).toBe("connected");
      expect(sites[0].location?.address).toContain("New York");
    });

    it("infers site status from outpost lifecycle", async () => {
      const site: AwsOutpostSite = {
        siteId: "s1",
        siteArn: "arn:...",
        accountId: "123",
        name: "Site",
      };

      const activeOutpost: AwsOutpost = {
        outpostId: "op-1",
        outpostArn: "arn:...",
        ownerId: "123",
        name: "OP1",
        siteId: "s1",
        availabilityZone: "az1",
        availabilityZoneId: "az1-id",
        lifeCycleStatus: "ACTIVE",
      };

      const inactiveOutpost: AwsOutpost = {
        outpostId: "op-2",
        outpostArn: "arn:...",
        ownerId: "123",
        name: "OP2",
        siteId: "s1",
        availabilityZone: "az1",
        availabilityZoneId: "az1-id",
        lifeCycleStatus: "PENDING",
      };

      vi.spyOn(adapter, "listOutpostSites").mockResolvedValue([site]);
      vi.spyOn(adapter, "listOutposts").mockResolvedValue([activeOutpost, inactiveOutpost]);
      vi.spyOn(adapter, "listOutpostAssets").mockResolvedValue([]);

      const sites = await adapter.discoverSites();
      // Mixed active/inactive → intermittent
      expect(sites[0].status).toBe("intermittent");
    });

    it("returns unknown status for site with no outposts", async () => {
      vi.spyOn(adapter, "listOutpostSites").mockResolvedValue([{
        siteId: "s1",
        siteArn: "arn:...",
        accountId: "123",
        name: "Empty Site",
      }]);
      vi.spyOn(adapter, "listOutposts").mockResolvedValue([]);
      vi.spyOn(adapter, "listOutpostAssets").mockResolvedValue([]);

      const sites = await adapter.discoverSites();
      expect(sites[0].status).toBe("unknown");
    });
  });

  describe("discoverFleet", () => {
    it("maps EKS Anywhere clusters to fleet clusters", async () => {
      const eksCluster: EKSAnywhereCluster = {
        name: "edge-cluster-01",
        arn: "arn:aws:eks:us-east-1:123456789:cluster/edge-cluster-01",
        kubernetesVersion: "1.28",
        status: "ACTIVE",
        provider: "vsphere",
        controlPlaneNodeCount: 3,
        workerNodeCount: 6,
        region: "us-east-1",
        connectorId: "connector-001",
      };

      vi.spyOn(adapter, "listEKSAnywhereClusters").mockResolvedValue([eksCluster]);

      const clusters = await adapter.discoverFleet();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].provider).toBe("aws");
      expect(clusters[0].kubernetesVersion).toBe("1.28");
      expect(clusters[0].nodeCount).toBe(9); // 3 + 6
      expect(clusters[0].status).toBe("healthy");
      expect(clusters[0].connectivity).toBe("connected");
    });

    it("maps CREATING status to provisioning", async () => {
      vi.spyOn(adapter, "listEKSAnywhereClusters").mockResolvedValue([{
        name: "new-cluster",
        kubernetesVersion: "1.28",
        status: "CREATING",
        provider: "bare_metal",
        controlPlaneNodeCount: 1,
        workerNodeCount: 0,
        region: "us-east-1",
      }]);

      const clusters = await adapter.discoverFleet();
      expect(clusters[0].status).toBe("provisioning");
    });

    it("maps FAILED status to degraded", async () => {
      vi.spyOn(adapter, "listEKSAnywhereClusters").mockResolvedValue([{
        name: "broken",
        kubernetesVersion: "1.27",
        status: "FAILED",
        provider: "vsphere",
        controlPlaneNodeCount: 3,
        workerNodeCount: 3,
        region: "us-west-2",
      }]);

      const clusters = await adapter.discoverFleet();
      expect(clusters[0].status).toBe("degraded");
    });
  });

  describe("discoverConnections", () => {
    it("returns empty (connections via networking module)", async () => {
      const connections = await adapter.discoverConnections();
      expect(connections).toEqual([]);
    });
  });

  describe("healthCheck", () => {
    it("returns true when API succeeds", async () => {
      vi.spyOn(adapter, "listOutposts").mockResolvedValue([]);
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false on failure", async () => {
      vi.spyOn(adapter, "listOutposts").mockRejectedValue(new Error("denied"));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("discoverAll", () => {
    it("combines all AWS hybrid resource types", async () => {
      vi.spyOn(adapter, "listOutposts").mockResolvedValue([]);
      vi.spyOn(adapter, "listOutpostSites").mockResolvedValue([]);
      vi.spyOn(adapter, "listOutpostAssets").mockResolvedValue([]);
      vi.spyOn(adapter, "listEKSAnywhereClusters").mockResolvedValue([]);
      vi.spyOn(adapter, "listECSAnywhereInstances").mockResolvedValue([]);
      vi.spyOn(adapter, "listSSMManagedInstances").mockResolvedValue([]);

      const result = await adapter.discoverAll();

      expect(result.region).toBe("us-east-1");
      expect(result.discoveredAt).toBeTruthy();
      expect(result.outposts).toEqual([]);
      expect(result.eksAnywhereClusters).toEqual([]);
    });
  });
});
