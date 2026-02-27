/**
 * Tests for the supply chain graph module (P2.22).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "./storage/index.js";
import type { GraphNodeInput, GraphStorage } from "./types.js";
import {
  parseCycloneDX,
  parseSPDX,
  parseSBOM,
  ingestContainerImage,
  findImagesByCVE,
  getImageVulnerabilities,
  generateSupplyChainReport,
  formatSupplyChainMarkdown,
  buildImageNodeId,
  buildPackageNodeId,
  buildCVENodeId,
  linkImageToInfra,
} from "./supply-chain.js";
import type { ContainerImage, CVEReference, SBOMPackage } from "./supply-chain.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id,
    name: id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

const SAMPLE_CVE: CVEReference = {
  id: "CVE-2023-0001",
  severity: 9.8,
  severityLevel: "critical",
  summary: "Remote code execution vulnerability",
  fixedIn: "1.2.4",
};

const SAMPLE_PACKAGE: SBOMPackage = {
  name: "lodash",
  version: "4.17.20",
  purl: "pkg:npm/lodash@4.17.20",
  license: "MIT",
  packageType: "npm",
  cves: [SAMPLE_CVE],
};

const SAMPLE_IMAGE: ContainerImage = {
  reference: "myregistry.io/app:v1.0.0",
  digest: "sha256:abc123",
  baseImage: "node:18-slim",
  sizeBytes: 150_000_000,
  packages: [SAMPLE_PACKAGE],
};

// =============================================================================
// Tests
// =============================================================================

describe("Supply Chain Graph (P2.22)", () => {
  let storage: GraphStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
  });

  describe("Node ID builders", () => {
    it("buildImageNodeId creates deterministic IDs", () => {
      const id = buildImageNodeId("aws", "123", "myregistry.io/app:v1.0.0");
      expect(id).toContain("aws");
      expect(id).toContain("123");
      expect(id).toContain("container-image");
    });

    it("buildPackageNodeId creates deterministic IDs", () => {
      const id = buildPackageNodeId("npm", "lodash", "4.17.20");
      expect(id).toContain("package");
      expect(id).toContain("npm");
      expect(id).toContain("lodash");
    });

    it("buildCVENodeId creates deterministic IDs", () => {
      const id = buildCVENodeId("CVE-2023-0001");
      expect(id).toContain("vulnerability");
      expect(id).toContain("CVE-2023-0001");
    });
  });

  describe("SBOM Parsing", () => {
    it("parseCycloneDX extracts packages from components", () => {
      const sbom = {
        bomFormat: "CycloneDX",
        specVersion: "1.4",
        components: [
          {
            type: "library",
            name: "express",
            version: "4.18.2",
            purl: "pkg:npm/express@4.18.2",
            licenses: [{ license: { id: "MIT" } }],
          },
          {
            type: "library",
            name: "lodash",
            version: "4.17.21",
          },
        ],
      };

      const packages = parseCycloneDX(sbom);
      expect(packages.length).toBe(2);
      expect(packages[0]!.name).toBe("express");
      expect(packages[0]!.version).toBe("4.18.2");
      expect(packages[0]!.license).toBe("MIT");
      expect(packages[1]!.name).toBe("lodash");
    });

    it("parseCycloneDX handles empty components", () => {
      const sbom = { bomFormat: "CycloneDX" };
      const packages = parseCycloneDX(sbom);
      expect(packages).toEqual([]);
    });

    it("parseSPDX extracts packages with purl from externalRefs", () => {
      const sbom = {
        spdxVersion: "SPDX-2.3",
        packages: [
          {
            name: "requests",
            versionInfo: "2.28.0",
            licenseConcluded: "Apache-2.0",
            externalRefs: [
              {
                referenceCategory: "PACKAGE-MANAGER",
                referenceType: "purl",
                referenceLocator: "pkg:pypi/requests@2.28.0",
              },
            ],
          },
        ],
      };

      const packages = parseSPDX(sbom);
      expect(packages.length).toBe(1);
      expect(packages[0]!.name).toBe("requests");
      expect(packages[0]!.purl).toBe("pkg:pypi/requests@2.28.0");
      expect(packages[0]!.packageType).toBe("pip");
    });

    it("parseSBOM auto-detects CycloneDX format", () => {
      const { format, packages } = parseSBOM({
        bomFormat: "CycloneDX",
        components: [{ type: "library", name: "test", version: "1.0" }],
      });
      expect(format).toBe("cyclonedx");
      expect(packages.length).toBe(1);
    });

    it("parseSBOM auto-detects SPDX format", () => {
      const { format } = parseSBOM({
        spdxVersion: "SPDX-2.3",
        packages: [],
      });
      expect(format).toBe("spdx");
    });
  });

  describe("ingestContainerImage", () => {
    it("creates image, package, and CVE nodes", async () => {
      const result = await ingestContainerImage(storage, SAMPLE_IMAGE, "aws", "123");

      expect(result.imageNodeId).toBeDefined();
      expect(result.packageNodeIds.length).toBe(1);
      expect(result.cveNodeIds.length).toBe(1);

      // Verify image node
      const imageNode = await storage.getNode(result.imageNodeId);
      expect(imageNode).toBeDefined();
      expect(imageNode!.name).toBe("myregistry.io/app:v1.0.0");
      expect(imageNode!.metadata.isContainerImage).toBe(true);

      // Verify package node
      const pkgNode = await storage.getNode(result.packageNodeIds[0]!);
      expect(pkgNode).toBeDefined();
      expect(pkgNode!.metadata.isPackage).toBe(true);

      // Verify CVE node
      const cveNode = await storage.getNode(result.cveNodeIds[0]!);
      expect(cveNode).toBeDefined();
      expect(cveNode!.metadata.isVulnerability).toBe(true);
      expect(cveNode!.metadata.severity).toBe(9.8);
    });

    it("creates edges between image, packages, and CVEs", async () => {
      const result = await ingestContainerImage(storage, SAMPLE_IMAGE);

      // Image → contains → package
      const imgEdges = await storage.getEdgesForNode(result.imageNodeId, "downstream");
      const containsEdge = imgEdges.find((e) => e.relationshipType === "contains");
      expect(containsEdge).toBeDefined();

      // Package → depends-on → CVE
      const pkgEdges = await storage.getEdgesForNode(result.packageNodeIds[0]!, "downstream");
      const vulnEdge = pkgEdges.find((e) => e.relationshipType === "depends-on");
      expect(vulnEdge).toBeDefined();
    });

    it("handles images with no CVEs", async () => {
      const imageNoCVEs: ContainerImage = {
        reference: "safe-image:latest",
        packages: [
          { name: "safe-pkg", version: "1.0.0", packageType: "npm" },
        ],
      };

      const result = await ingestContainerImage(storage, imageNoCVEs);
      expect(result.cveNodeIds.length).toBe(0);
      expect(result.packageNodeIds.length).toBe(1);
    });
  });

  describe("linkImageToInfra", () => {
    it("creates uses edge between infra node and image", async () => {
      const result = await ingestContainerImage(storage, SAMPLE_IMAGE);
      await storage.upsertNode(makeNode("ecs-task", { resourceType: "container" }));

      await linkImageToInfra(storage, result.imageNodeId, "ecs-task");

      const edges = await storage.getEdgesForNode("ecs-task", "downstream");
      const usesEdge = edges.find(
        (e) => e.targetNodeId === result.imageNodeId && e.relationshipType === "uses",
      );
      expect(usesEdge).toBeDefined();
    });
  });

  describe("findImagesByCVE", () => {
    it("finds images affected by a specific CVE", async () => {
      await ingestContainerImage(storage, SAMPLE_IMAGE, "aws", "123");

      const affected = await findImagesByCVE(storage, "CVE-2023-0001");
      expect(affected.length).toBe(1);
      expect(affected[0]!.name).toBe("myregistry.io/app:v1.0.0");
    });

    it("returns empty for non-existent CVE", async () => {
      const affected = await findImagesByCVE(storage, "CVE-9999-0000");
      expect(affected).toEqual([]);
    });
  });

  describe("getImageVulnerabilities", () => {
    it("returns package-vulnerability pairs", async () => {
      const result = await ingestContainerImage(storage, SAMPLE_IMAGE);
      const vulns = await getImageVulnerabilities(storage, result.imageNodeId);

      expect(vulns.length).toBe(1);
      expect(vulns[0]!.package.metadata.isPackage).toBe(true);
      expect(vulns[0]!.vulnerability.metadata.isVulnerability).toBe(true);
    });
  });

  describe("generateSupplyChainReport", () => {
    it("generates report for ingested images", async () => {
      await ingestContainerImage(storage, SAMPLE_IMAGE, "aws", "123");

      const report = await generateSupplyChainReport(storage);
      expect(report.totalImages).toBe(1);
      expect(report.totalVulnerabilities).toBeGreaterThanOrEqual(1);
      expect(report.criticalVulnerabilities).toBeGreaterThanOrEqual(1);
      expect(report.images.length).toBe(1);
    });

    it("returns empty report for empty graph", async () => {
      const report = await generateSupplyChainReport(storage);
      expect(report.totalImages).toBe(0);
      expect(report.totalVulnerabilities).toBe(0);
    });
  });

  describe("formatSupplyChainMarkdown", () => {
    it("formats report as markdown", async () => {
      await ingestContainerImage(storage, SAMPLE_IMAGE, "aws", "123");
      const report = await generateSupplyChainReport(storage);
      const md = formatSupplyChainMarkdown(report);

      expect(md).toContain("Supply Chain Security Report");
      expect(md).toContain("Container images");
      expect(md).toContain("Vulnerabilities");
    });
  });

  describe("serialization safety", () => {
    it("packageUsage serializes correctly to JSON", async () => {
      await ingestContainerImage(storage, SAMPLE_IMAGE, "aws", "123");
      const report = await generateSupplyChainReport(storage);

      // packageUsage is now Record<string, string[]> instead of Map,
      // so JSON.stringify preserves the data
      const json = JSON.stringify(report);
      const parsed = JSON.parse(json);
      expect(typeof parsed.packageUsage).toBe("object");
      expect(parsed.packageUsage).not.toEqual({});
    });
  });

  describe("edge cases", () => {
    it("parseSPDX handles non-string name gracefully", () => {
      const sbom = {
        spdxVersion: "SPDX-2.3",
        packages: [
          {
            name: 12345, // numeric name
            versionInfo: "1.0.0",
          },
        ],
      };

      const packages = parseSPDX(sbom as Record<string, unknown>);
      expect(packages.length).toBe(1);
      expect(packages[0]!.name).toBe("unknown"); // should fallback, not propagate number
    });

    it("findImagesByCVE deduplicates images", async () => {
      // Create an image with two packages that share the same CVE
      const sharedCVE: CVEReference = {
        id: "CVE-2024-SHARED",
        severity: 8.0,
        severityLevel: "high",
        summary: "Shared vulnerability",
      };
      const image: ContainerImage = {
        reference: "myregistry.io/app:v2.0.0",
        digest: "sha256:dedup123",
        baseImage: "node:20-slim",
        sizeBytes: 200_000_000,
        packages: [
          { name: "pkg-a", version: "1.0.0", packageType: "npm", cves: [sharedCVE] },
          { name: "pkg-b", version: "2.0.0", packageType: "npm", cves: [sharedCVE] },
        ],
      };

      await ingestContainerImage(storage, image, "aws", "123");
      const images = await findImagesByCVE(storage, "CVE-2024-SHARED");
      // Should return the image only once despite two packages referencing the same CVE
      expect(images.length).toBe(1);
    });
  });
});
