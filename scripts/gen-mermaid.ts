import { SQLiteGraphStorage } from "../extensions/knowledge-graph/src/storage/index.js";
import { resolve } from "node:path";

const db = resolve(process.env.HOME!, ".espada/knowledge-graph.db");
const storage = new SQLiteGraphStorage(db);
await storage.initialize();

const nodes = await storage.queryNodes({});
const edges = await storage.queryEdges({});

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
}
function shortName(name: string): string {
  return name.length > 30 ? name.slice(0, 27) + "..." : name;
}

const lines: string[] = ["graph TD"];

// Connected nodes (VPC cluster)
const connectedIds = new Set<string>();
for (const e of edges) {
  connectedIds.add(e.sourceNodeId);
  connectedIds.add(e.targetNodeId);
}

const connectedNodes = nodes.filter((n) => connectedIds.has(n.id));
const orphanedNodes = nodes.filter((n) => !connectedIds.has(n.id));

lines.push("");
lines.push("  %% VPC Cluster - Connected Resources");

for (const node of connectedNodes) {
  const label = shortName(node.name);
  const sid = sanitize(node.id);
  switch (node.resourceType) {
    case "vpc":
      lines.push(`  ${sid}[["${label}<br/>VPC"]]`);
      break;
    case "subnet":
      lines.push(`  ${sid}(["${label}<br/>Subnet"])`);
      break;
    case "security-group":
      lines.push(`  ${sid}["${label}<br/>Security Group"]`);
      break;
    case "internet-gateway":
      lines.push(`  ${sid}["${label}<br/>Internet Gateway"]`);
      break;
    case "route-table":
      lines.push(`  ${sid}["${label}<br/>Route Table"]`);
      break;
    default:
      lines.push(`  ${sid}["${label}<br/>${node.resourceType}"]`);
      break;
  }
}

lines.push("");
lines.push("  %% Relationships");
for (const edge of edges) {
  const source = sanitize(edge.sourceNodeId);
  const target = sanitize(edge.targetNodeId);
  const label = edge.relationshipType;
  lines.push(`  ${source} -->|${label}| ${target}`);
}

lines.push("");
lines.push("  %% Orphaned Resources");
lines.push('  subgraph Orphaned["Orphaned Resources - $0.08/mo wasted"]');
for (const node of orphanedNodes) {
  const sid = sanitize(node.id);
  const label = shortName(node.name);
  if (node.resourceType === "iam-role") {
    lines.push(`    ${sid}{"${label}<br/>IAM Role"}`);
  } else if (node.resourceType === "storage") {
    lines.push(`    ${sid}[("${label}<br/>Storage")]`);
  } else {
    lines.push(`    ${sid}["${label}<br/>${node.resourceType}"]`);
  }
}
lines.push("  end");

lines.push("");
lines.push(
  "  classDef vpc fill:#3b82f6,stroke:#1e40af,color:#fff,stroke-width:3px",
);
lines.push("  classDef subnet fill:#22c55e,stroke:#15803d,color:#fff");
lines.push("  classDef security fill:#ef4444,stroke:#dc2626,color:#fff");
lines.push("  classDef gateway fill:#06b6d4,stroke:#0891b2,color:#fff");
lines.push("  classDef routing fill:#64748b,stroke:#475569,color:#fff");
lines.push("  classDef iam fill:#a855f7,stroke:#7c3aed,color:#fff");
lines.push("  classDef storage fill:#f59e0b,stroke:#d97706,color:#fff");
lines.push("  classDef custom fill:#94a3b8,stroke:#64748b,color:#fff");

for (const node of connectedNodes) {
  const sid = sanitize(node.id);
  const cls =
    node.resourceType === "vpc"
      ? "vpc"
      : node.resourceType === "subnet"
        ? "subnet"
        : node.resourceType === "security-group"
          ? "security"
          : node.resourceType === "internet-gateway"
            ? "gateway"
            : node.resourceType === "route-table"
              ? "routing"
              : node.resourceType;
  lines.push(`  class ${sid} ${cls}`);
}
for (const node of orphanedNodes) {
  const sid = sanitize(node.id);
  const cls =
    node.resourceType === "iam-role"
      ? "iam"
      : node.resourceType === "storage"
        ? "storage"
        : "custom";
  lines.push(`  class ${sid} ${cls}`);
}

console.log(lines.join("\n"));
await storage.close();
