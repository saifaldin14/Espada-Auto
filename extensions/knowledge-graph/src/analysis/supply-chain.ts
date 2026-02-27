/**
 * Infrastructure Knowledge Graph — Supply Chain Graph (P2.22)
 *
 * Models software supply chain as graph nodes:
 * - Container images, packages, and vulnerabilities (CVEs)
 * - SBOM (Software Bill of Materials) parsing for CycloneDX/SPDX
 * - Cross-referencing packages → CVEs → infrastructure resources
 */

import type {
  GraphNode,
  GraphNodeInput,
  GraphEdgeInput,
  GraphStorage,
  CloudProvider,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** SBOM input format. */
export type SBOMFormat = "cyclonedx" | "spdx";

/** A parsed software package from an SBOM. */
export type SBOMPackage = {
  name: string;
  version: string;
  /** Package URL (purl://type/namespace/name@version). */
  purl?: string;
  /** License identifier. */
  license?: string;
  /** Package type (npm, pip, maven, docker, os). */
  packageType: string;
  /** Known CVEs for this package. */
  cves?: CVEReference[];
};

/** A CVE reference. */
export type CVEReference = {
  id: string;
  /** CVSS severity score (0.0–10.0). */
  severity: number;
  /** Severity classification. */
  severityLevel: "critical" | "high" | "medium" | "low" | "none";
  /** Short description. */
  summary: string;
  /** Fixed version if known. */
  fixedIn?: string;
};

/** A container image. */
export type ContainerImage = {
  /** Full image reference (registry/repo:tag). */
  reference: string;
  /** Image digest (sha256:...). */
  digest?: string;
  /** Base image. */
  baseImage?: string;
  /** Image size in bytes. */
  sizeBytes?: number;
  /** When the image was created. */
  createdAt?: string;
  /** Packages inside this image (from SBOM). */
  packages: SBOMPackage[];
};

/** Supply chain report for a cluster/environment. */
export type SupplyChainReport = {
  generatedAt: string;
  totalImages: number;
  totalPackages: number;
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  images: Array<{
    reference: string;
    nodeId: string;
    packageCount: number;
    vulnerabilityCount: number;
    criticalCount: number;
  }>;
  topVulnerabilities: CVEReference[];
  /** Package → which images use it. */
  packageUsage: Record<string, string[]>;
};

// =============================================================================
// Node ID Builders
// =============================================================================

export function buildImageNodeId(
  provider: CloudProvider,
  account: string,
  reference: string,
): string {
  const sanitized = reference.replace(/[/:@]/g, "_");
  return `${provider}:${account}:global:container-image:${sanitized}`;
}

export function buildPackageNodeId(
  packageType: string,
  name: string,
  version: string,
): string {
  return `custom:packages:global:package:${packageType}_${name}_${version}`;
}

export function buildCVENodeId(cveId: string): string {
  return `custom:security:global:vulnerability:${cveId}`;
}

// =============================================================================
// SBOM Parsing
// =============================================================================

/**
 * Parse a CycloneDX SBOM JSON document into packages.
 */
export function parseCycloneDX(
  sbom: Record<string, unknown>,
): SBOMPackage[] {
  const packages: SBOMPackage[] = [];
  const components = sbom.components as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(components)) return packages;

  for (const comp of components) {
    const name = typeof comp.name === "string" ? comp.name : "unknown";
    const version = typeof comp.version === "string" ? comp.version : "unknown";
    const purl = comp.purl as string | undefined;
    const packageType = comp.type === "library"
      ? inferPackageType(purl ?? name)
      : (comp.type as string) ?? "unknown";

    // Extract license
    const licenses = comp.licenses as Array<Record<string, unknown>> | undefined;
    const license = licenses?.[0]
      ? ((licenses[0].license as Record<string, unknown>)?.id as string) ??
        ((licenses[0].license as Record<string, unknown>)?.name as string)
      : undefined;

    packages.push({ name, version, purl, license, packageType, cves: [] });
  }

  return packages;
}

/**
 * Parse an SPDX SBOM JSON document into packages.
 */
export function parseSPDX(
  sbom: Record<string, unknown>,
): SBOMPackage[] {
  const packages: SBOMPackage[] = [];
  const spdxPackages = sbom.packages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(spdxPackages)) return packages;

  for (const pkg of spdxPackages) {
    const name = typeof pkg.name === "string" ? pkg.name : "unknown";
    const version = typeof pkg.versionInfo === "string" ? pkg.versionInfo : "unknown";

    // SPDX stores purl in externalRefs
    const externalRefs = pkg.externalRefs as Array<Record<string, unknown>> | undefined;
    const purlRef = externalRefs?.find(
      (r) => r.referenceType === "purl" || r.referenceCategory === "PACKAGE-MANAGER",
    );
    const purl = purlRef?.referenceLocator as string | undefined;

    const license = (pkg.licenseConcluded as string) ?? (pkg.licenseDeclared as string);
    const packageType = inferPackageType(purl ?? name);

    packages.push({ name, version, purl, license, packageType, cves: [] });
  }

  return packages;
}

/**
 * Auto-detect SBOM format and parse.
 */
export function parseSBOM(
  sbom: Record<string, unknown>,
): { format: SBOMFormat; packages: SBOMPackage[] } {
  if (sbom.bomFormat === "CycloneDX" || sbom.specVersion != null) {
    return { format: "cyclonedx", packages: parseCycloneDX(sbom) };
  }
  if (sbom.spdxVersion != null || sbom.SPDXID != null) {
    return { format: "spdx", packages: parseSPDX(sbom) };
  }
  // Default to CycloneDX attempt
  return { format: "cyclonedx", packages: parseCycloneDX(sbom) };
}

/** Infer package type from purl or name. */
function inferPackageType(ref: string): string {
  if (ref.startsWith("pkg:npm/")) return "npm";
  if (ref.startsWith("pkg:pypi/")) return "pip";
  if (ref.startsWith("pkg:maven/")) return "maven";
  if (ref.startsWith("pkg:golang/")) return "go";
  if (ref.startsWith("pkg:cargo/")) return "cargo";
  if (ref.startsWith("pkg:nuget/")) return "nuget";
  if (ref.startsWith("pkg:deb/") || ref.startsWith("pkg:apk/") || ref.startsWith("pkg:rpm/"))
    return "os";
  if (ref.startsWith("pkg:docker/")) return "docker";
  if (ref.startsWith("pkg:oci/")) return "oci";
  return "unknown";
}

// =============================================================================
// Graph Integration
// =============================================================================

/**
 * Ingest a container image and its SBOM into the knowledge graph.
 *
 * Creates nodes for:
 * - The container image itself
 * - Each package found in the SBOM
 * - Each known CVE
 *
 * Creates edges:
 * - image → contains → package
 * - package → has-vulnerability → cve (via "depends-on")
 */
export async function ingestContainerImage(
  storage: GraphStorage,
  image: ContainerImage,
  provider: CloudProvider = "custom",
  account: string = "default",
): Promise<{
  imageNodeId: string;
  packageNodeIds: string[];
  cveNodeIds: string[];
}> {
  const now = new Date().toISOString();
  const imageNodeId = buildImageNodeId(provider, account, image.reference);

  // Create image node
  const imageNode: GraphNodeInput = {
    id: imageNodeId,
    provider,
    resourceType: "container",
    nativeId: image.digest ?? image.reference,
    name: image.reference,
    region: "global",
    account,
    status: "running",
    tags: {
      ...(image.baseImage ? { baseImage: image.baseImage } : {}),
      imageType: "container-image",
    },
    metadata: {
      digest: image.digest,
      baseImage: image.baseImage,
      sizeBytes: image.sizeBytes,
      packageCount: image.packages.length,
      isContainerImage: true,
    },
    costMonthly: null,
    owner: null,
    createdAt: image.createdAt ?? now,
  };
  await storage.upsertNode(imageNode);

  const packageNodeIds: string[] = [];
  const cveNodeIds: string[] = [];

  // Create package and CVE nodes
  for (const pkg of image.packages) {
    const pkgNodeId = buildPackageNodeId(pkg.packageType, pkg.name, pkg.version);
    packageNodeIds.push(pkgNodeId);

    const pkgNode: GraphNodeInput = {
      id: pkgNodeId,
      provider: "custom",
      resourceType: "custom",
      nativeId: pkg.purl ?? `${pkg.packageType}:${pkg.name}@${pkg.version}`,
      name: `${pkg.name}@${pkg.version}`,
      region: "global",
      account: "packages",
      status: "running",
      tags: {
        packageType: pkg.packageType,
        ...(pkg.license ? { license: pkg.license } : {}),
        nodeCategory: "package",
      },
      metadata: {
        packageType: pkg.packageType,
        version: pkg.version,
        purl: pkg.purl,
        license: pkg.license,
        isPackage: true,
      },
      costMonthly: null,
      owner: null,
      createdAt: now,
    };
    await storage.upsertNode(pkgNode);

    // Image → contains → package
    const containsEdge: GraphEdgeInput = {
      id: `edge:${imageNodeId}:contains:${pkgNodeId}`,
      sourceNodeId: imageNodeId,
      targetNodeId: pkgNodeId,
      relationshipType: "contains",
      confidence: 1.0,
      discoveredVia: "config-scan",
      metadata: {},
    };
    await storage.upsertEdge(containsEdge);

    // Process CVEs
    if (pkg.cves) {
      for (const cve of pkg.cves) {
        const cveNodeId = buildCVENodeId(cve.id);
        if (!cveNodeIds.includes(cveNodeId)) {
          cveNodeIds.push(cveNodeId);
        }

        const cveNode: GraphNodeInput = {
          id: cveNodeId,
          provider: "custom",
          resourceType: "custom",
          nativeId: cve.id,
          name: cve.id,
          region: "global",
          account: "security",
          status: cve.fixedIn ? "running" : "error",
          tags: {
            severity: cve.severityLevel,
            nodeCategory: "vulnerability",
            ...(cve.fixedIn ? { fixedIn: cve.fixedIn } : {}),
          },
          metadata: {
            severity: cve.severity,
            severityLevel: cve.severityLevel,
            summary: cve.summary,
            fixedIn: cve.fixedIn,
            isVulnerability: true,
          },
          costMonthly: null,
          owner: null,
          createdAt: now,
        };
        await storage.upsertNode(cveNode);

        // Package → depends-on → CVE (vulnerability relationship)
        const vulnEdge: GraphEdgeInput = {
          id: `edge:${pkgNodeId}:depends-on:${cveNodeId}`,
          sourceNodeId: pkgNodeId,
          targetNodeId: cveNodeId,
          relationshipType: "depends-on",
          confidence: 1.0,
          discoveredVia: "config-scan",
          metadata: {
            severity: cve.severity,
            severityLevel: cve.severityLevel,
          },
        };
        await storage.upsertEdge(vulnEdge);
      }
    }
  }

  return { imageNodeId, packageNodeIds, cveNodeIds };
}

/**
 * Link a container image to the infrastructure node that runs it.
 * E.g., link a Docker image to the ECS task, K8s pod, or compute instance.
 */
export async function linkImageToInfra(
  storage: GraphStorage,
  imageNodeId: string,
  infraNodeId: string,
): Promise<void> {
  const edge: GraphEdgeInput = {
    id: `edge:${infraNodeId}:uses:${imageNodeId}`,
    sourceNodeId: infraNodeId,
    targetNodeId: imageNodeId,
    relationshipType: "uses",
    confidence: 1.0,
    discoveredVia: "config-scan",
    metadata: {},
  };
  await storage.upsertEdge(edge);
}

// =============================================================================
// Analysis
// =============================================================================

/**
 * Find all images affected by a specific CVE.
 */
export async function findImagesByCVE(
  storage: GraphStorage,
  cveId: string,
): Promise<GraphNode[]> {
  const cveNodeId = buildCVENodeId(cveId);
  const images: GraphNode[] = [];
  const seen = new Set<string>();

  // CVE ← depends-on ← package ← contains ← image
  const pkgEdges = await storage.getEdgesForNode(cveNodeId, "upstream");
  for (const pkgEdge of pkgEdges) {
    if (pkgEdge.relationshipType === "depends-on") {
      const imgEdges = await storage.getEdgesForNode(pkgEdge.sourceNodeId, "upstream");
      for (const imgEdge of imgEdges) {
        if (imgEdge.relationshipType === "contains") {
          const node = await storage.getNode(imgEdge.sourceNodeId);
          if (node && node.metadata.isContainerImage && !seen.has(node.id)) {
            seen.add(node.id);
            images.push(node);
          }
        }
      }
    }
  }

  return images;
}

/**
 * Get all vulnerabilities for a specific image.
 */
export async function getImageVulnerabilities(
  storage: GraphStorage,
  imageNodeId: string,
): Promise<{ package: GraphNode; vulnerability: GraphNode }[]> {
  const results: { package: GraphNode; vulnerability: GraphNode }[] = [];

  // Image → contains → package → depends-on → CVE
  const pkgEdges = await storage.getEdgesForNode(imageNodeId, "downstream");
  for (const edge of pkgEdges) {
    if (edge.relationshipType === "contains") {
      const pkgNode = await storage.getNode(edge.targetNodeId);
      if (!pkgNode) continue;

      const cveEdges = await storage.getEdgesForNode(edge.targetNodeId, "downstream");
      for (const cveEdge of cveEdges) {
        if (cveEdge.relationshipType === "depends-on") {
          const cveNode = await storage.getNode(cveEdge.targetNodeId);
          if (cveNode && cveNode.metadata.isVulnerability) {
            results.push({ package: pkgNode, vulnerability: cveNode });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Generate a supply chain report for all container images in the graph.
 */
export async function generateSupplyChainReport(
  storage: GraphStorage,
  provider?: CloudProvider,
): Promise<SupplyChainReport> {
  // Find all container image nodes
  const allNodes = await storage.queryNodes({
    ...(provider ? { provider } : {}),
  });

  const imageNodes = allNodes.filter((n) => n.metadata.isContainerImage);
  const packageUsage: Record<string, string[]> = {};
  const allVulns: CVEReference[] = [];
  const imageDetails: SupplyChainReport["images"] = [];

  for (const img of imageNodes) {
    const vulns = await getImageVulnerabilities(storage, img.id);

    let criticalCount = 0;
    let vulnCount = 0;

    // Track packages
    const pkgEdges = await storage.getEdgesForNode(img.id, "downstream");
    const packageCount = pkgEdges.filter((e) => e.relationshipType === "contains").length;

    for (const { package: pkg, vulnerability: vuln } of vulns) {
      vulnCount++;
      const severity = vuln.metadata.severityLevel as string;
      if (severity === "critical") criticalCount++;

      // Track package usage
      const pkgKey = `${pkg.name}`;
      const usages = packageUsage[pkgKey] ?? [];
      if (!usages.includes(img.name)) {
        usages.push(img.name);
        packageUsage[pkgKey] = usages;
      }

      allVulns.push({
        id: vuln.name,
        severity: (vuln.metadata.severity as number) ?? 0,
        severityLevel: (vuln.metadata.severityLevel as CVEReference["severityLevel"]) ?? "none",
        summary: (vuln.metadata.summary as string) ?? "",
        fixedIn: vuln.metadata.fixedIn as string | undefined,
      });
    }

    imageDetails.push({
      reference: img.name,
      nodeId: img.id,
      packageCount,
      vulnerabilityCount: vulnCount,
      criticalCount,
    });
  }

  // Deduplicate and sort vulnerabilities
  const uniqueVulns = new Map<string, CVEReference>();
  for (const v of allVulns) uniqueVulns.set(v.id, v);
  const topVulns = [...uniqueVulns.values()]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    totalImages: imageNodes.length,
    totalPackages: Object.keys(packageUsage).length,
    totalVulnerabilities: uniqueVulns.size,
    criticalVulnerabilities: [...uniqueVulns.values()].filter(
      (v) => v.severityLevel === "critical",
    ).length,
    highVulnerabilities: [...uniqueVulns.values()].filter(
      (v) => v.severityLevel === "high",
    ).length,
    images: imageDetails,
    topVulnerabilities: topVulns,
    packageUsage,
  };
}

/**
 * Format a supply chain report as markdown.
 */
export function formatSupplyChainMarkdown(report: SupplyChainReport): string {
  const lines: string[] = [
    "# Supply Chain Security Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Container images | ${report.totalImages} |`,
    `| Unique packages | ${report.totalPackages} |`,
    `| Vulnerabilities | ${report.totalVulnerabilities} |`,
    `| Critical | ${report.criticalVulnerabilities} |`,
    `| High | ${report.highVulnerabilities} |`,
    "",
  ];

  if (report.topVulnerabilities.length > 0) {
    lines.push(
      "## Top Vulnerabilities",
      "",
      "| CVE | Severity | Score | Summary | Fix Available |",
      "|-----|----------|-------|---------|---------------|",
      ...report.topVulnerabilities.map(
        (v) =>
          `| ${v.id} | ${v.severityLevel.toUpperCase()} | ${v.severity.toFixed(1)} | ${v.summary.slice(0, 60)} | ${v.fixedIn ?? "No"} |`,
      ),
      "",
    );
  }

  if (report.images.length > 0) {
    lines.push(
      "## Container Images",
      "",
      "| Image | Packages | Vulns | Critical |",
      "|-------|----------|-------|----------|",
      ...report.images
        .sort((a, b) => b.criticalCount - a.criticalCount)
        .map(
          (i) =>
            `| ${i.reference} | ${i.packageCount} | ${i.vulnerabilityCount} | ${i.criticalCount} |`,
        ),
      "",
    );
  }

  return lines.join("\n");
}
