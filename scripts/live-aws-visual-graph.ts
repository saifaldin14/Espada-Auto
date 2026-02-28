#!/usr/bin/env npx tsx
/**
 * Live AWS Discovery + Interactive Visual Graph
 *
 * 1. Discovers all infrastructure in a real AWS account
 * 2. Exports Mermaid + DOT diagrams
 * 3. Generates an interactive D3.js force-graph HTML page
 * 4. Opens it in the browser
 *
 * Usage: npx tsx scripts/live-aws-visual-graph.ts
 */

import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { GraphEngine } from "../extensions/knowledge-graph/src/core/engine.js";
import { InMemoryGraphStorage } from "../extensions/knowledge-graph/src/storage/index.js";
import { AwsDiscoveryAdapter } from "../extensions/knowledge-graph/src/adapters/aws.js";
import { exportTopology } from "../extensions/knowledge-graph/src/reporting/export.js";
import { exportVisualization, DEFAULT_COLORS } from "../extensions/knowledge-graph/src/analysis/visualization.js";

// ─── Configuration ───────────────────────────────────────────────────────────
const AWS_ACCOUNT_ID = "187093629249";
const AWS_REGIONS = ["us-east-1"];
const OUTPUT_DIR = "/tmp/espada-graph";

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  ESPADA — Live AWS Infrastructure Discovery + Visual Graph");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  Account:  ${AWS_ACCOUNT_ID}`);
  console.log(`  Regions:  ${AWS_REGIONS.join(", ")}`);
  console.log(`  Time:     ${new Date().toISOString()}`);

  // ── 1. Run live discovery ──
  console.log("\n  [1/5] Creating AWS adapter (live credentials)...");
  const awsAdapter = new AwsDiscoveryAdapter({
    accountId: AWS_ACCOUNT_ID,
    regions: AWS_REGIONS,
    enableCostExplorer: true,
  });

  console.log("  [2/5] Initializing knowledge-graph engine...");
  const storage = new InMemoryGraphStorage();
  await storage.initialize();
  const engine = new GraphEngine({
    storage,
    config: { enableDriftDetection: true, pruneOrphanedEdges: true },
  });
  engine.registerAdapter(awsAdapter);

  console.log("  [3/5] Running full discovery sync (this may take 20-30s)...\n");
  const syncRecords = await engine.sync({ discoverOptions: { regions: AWS_REGIONS } });

  for (const rec of syncRecords) {
    console.log(`    ✓ ${rec.provider.toUpperCase()}: ${rec.nodesDiscovered} nodes, ${rec.edgesDiscovered} edges (${rec.durationMs}ms)`);
    if (rec.errors.length > 0) {
      console.log(`      ⚠ ${rec.errors.length} non-critical error(s): ${rec.errors[0]?.slice(0, 80)}...`);
    }
  }

  // ── 2. Export all formats ──
  console.log("\n  [4/5] Exporting graph formats...");
  execSync(`mkdir -p ${OUTPUT_DIR}`);

  // Mermaid
  const mermaid = await exportTopology(storage, "mermaid", { includeCost: true });
  writeFileSync(`${OUTPUT_DIR}/graph.mmd`, mermaid.content);
  console.log(`    ✓ Mermaid diagram: ${OUTPUT_DIR}/graph.mmd (${mermaid.nodeCount} nodes, ${mermaid.edgeCount} edges)`);

  // DOT (Graphviz)
  const dot = await exportTopology(storage, "dot", { includeCost: true });
  writeFileSync(`${OUTPUT_DIR}/graph.dot`, dot.content);
  console.log(`    ✓ Graphviz DOT:    ${OUTPUT_DIR}/graph.dot`);

  // JSON topology
  const json = await exportTopology(storage, "json", { includeCost: true, includeMetadata: true });
  writeFileSync(`${OUTPUT_DIR}/graph.json`, json.content);
  console.log(`    ✓ JSON topology:   ${OUTPUT_DIR}/graph.json`);

  // D3 force graph data
  const d3Data = await exportVisualization(storage, "d3-force", {
    includeCost: true,
    includeMetadata: true,
    groupByProvider: true,
  });
  writeFileSync(`${OUTPUT_DIR}/d3-data.json`, d3Data.content);
  console.log(`    ✓ D3 force data:   ${OUTPUT_DIR}/d3-data.json`);

  // Cytoscape data
  const cytoData = await exportVisualization(storage, "cytoscape", {
    includeCost: true,
    includeMetadata: true,
    groupByProvider: true,
  });
  writeFileSync(`${OUTPUT_DIR}/cytoscape-data.json`, cytoData.content);
  console.log(`    ✓ Cytoscape data:  ${OUTPUT_DIR}/cytoscape-data.json`);

  // ── 3. Generate interactive HTML ──
  console.log("\n  [5/5] Generating interactive HTML visualization...");

  const stats = await engine.getStats();
  const totalCost = stats.totalCostMonthly;
  const d3Json = d3Data.content;

  const html = buildInteractiveHTML(d3Json, {
    accountId: AWS_ACCOUNT_ID,
    regions: AWS_REGIONS,
    totalNodes: stats.totalNodes,
    totalEdges: stats.totalEdges,
    totalCost,
    syncDuration: syncRecords.reduce((s, r) => s + (r.durationMs ?? 0), 0),
    mermaidContent: mermaid.content,
  });

  const htmlPath = `${OUTPUT_DIR}/infrastructure-graph.html`;
  writeFileSync(htmlPath, html);
  console.log(`    ✓ Interactive graph: ${htmlPath}`);

  // ── 4. Open in browser ──
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(`  Discovery complete in ${elapsed}s`);
  console.log(`  ${stats.totalNodes} resources, ${stats.totalEdges} relationships, $${totalCost.toFixed(2)}/mo`);
  console.log(`══════════════════════════════════════════════════════════════════\n`);

  console.log("  Opening interactive graph in browser...\n");
  try {
    execSync(`open "${htmlPath}"`);
  } catch {
    console.log(`  Could not auto-open. Open manually: file://${htmlPath}`);
  }
}

// ─── HTML Generator ──────────────────────────────────────────────────────────
function buildInteractiveHTML(
  d3Json: string,
  meta: {
    accountId: string;
    regions: string[];
    totalNodes: number;
    totalEdges: number;
    totalCost: number;
    syncDuration: number;
    mermaidContent: string;
  },
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Espada — AWS Infrastructure Graph</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    overflow: hidden;
  }

  /* Header */
  .header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: linear-gradient(135deg, #161b22 0%, #1c2333 100%);
    border-bottom: 1px solid #30363d;
    padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .header h1 {
    font-size: 18px; font-weight: 600; color: #f0f6fc;
    display: flex; align-items: center; gap: 10px;
  }
  .header h1 .logo {
    width: 28px; height: 28px; background: linear-gradient(135deg, #FF9900, #FF6600);
    border-radius: 6px; display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 800; color: #fff;
  }
  .stats-bar {
    display: flex; gap: 24px; font-size: 13px;
  }
  .stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .stat-value { font-size: 18px; font-weight: 700; color: #58a6ff; }
  .stat-label { font-size: 10px; text-transform: uppercase; color: #8b949e; letter-spacing: 0.5px; }

  /* Controls */
  .controls {
    position: fixed; top: 60px; left: 16px; z-index: 90;
    background: #161b22; border: 1px solid #30363d; border-radius: 12px;
    padding: 16px; width: 240px; max-height: calc(100vh - 80px); overflow-y: auto;
  }
  .controls h3 { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  .control-group { margin-bottom: 16px; }
  .control-group label { display: block; font-size: 12px; color: #c9d1d9; margin-bottom: 6px; }
  .control-group input[type="range"] { width: 100%; accent-color: #58a6ff; }
  .control-group select {
    width: 100%; padding: 6px 8px; background: #0d1117; border: 1px solid #30363d;
    border-radius: 6px; color: #c9d1d9; font-size: 12px;
  }
  .btn {
    display: block; width: 100%; padding: 8px; margin-top: 8px;
    background: #21262d; border: 1px solid #30363d; border-radius: 6px;
    color: #c9d1d9; font-size: 12px; cursor: pointer; text-align: center;
  }
  .btn:hover { background: #30363d; border-color: #58a6ff; }

  /* Legend */
  .legend { margin-top: 8px; }
  .legend-item {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; color: #8b949e; margin-bottom: 4px;
  }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  /* Tooltip */
  .tooltip {
    position: absolute; pointer-events: none; z-index: 200;
    background: #1c2333; border: 1px solid #30363d; border-radius: 8px;
    padding: 12px; font-size: 12px; max-width: 320px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); display: none;
  }
  .tooltip h4 { font-size: 14px; color: #f0f6fc; margin-bottom: 6px; }
  .tooltip .tt-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 3px; }
  .tooltip .tt-key { color: #8b949e; }
  .tooltip .tt-val { color: #c9d1d9; font-weight: 500; }

  /* SVG */
  #graph-container {
    position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
  }
  svg { width: 100%; height: 100%; }
  .node-label {
    font-size: 10px; fill: #c9d1d9; pointer-events: none;
    text-anchor: middle; dominant-baseline: central;
  }
  .edge-label {
    font-size: 8px; fill: #6e7681; pointer-events: none;
    text-anchor: middle;
  }
  .link { stroke-opacity: 0.5; }
  .link:hover { stroke-opacity: 1; }
</style>
</head>
<body>

<div class="header">
  <h1><div class="logo">E</div> Espada Infrastructure Graph</h1>
  <div class="stats-bar">
    <div class="stat"><span class="stat-value">${meta.totalNodes}</span><span class="stat-label">Resources</span></div>
    <div class="stat"><span class="stat-value">${meta.totalEdges}</span><span class="stat-label">Relationships</span></div>
    <div class="stat"><span class="stat-value">$${meta.totalCost.toFixed(2)}</span><span class="stat-label">Monthly Cost</span></div>
    <div class="stat"><span class="stat-value">${(meta.syncDuration / 1000).toFixed(1)}s</span><span class="stat-label">Scan Time</span></div>
    <div class="stat"><span class="stat-value">${meta.regions.join(", ")}</span><span class="stat-label">Region</span></div>
    <div class="stat"><span class="stat-value">${meta.accountId.slice(-6)}</span><span class="stat-label">Account</span></div>
  </div>
</div>

<div class="controls">
  <h3>Graph Controls</h3>
  <div class="control-group">
    <label>Force Strength: <span id="force-val">-200</span></label>
    <input type="range" id="force-charge" min="-500" max="-50" value="-200" step="10">
  </div>
  <div class="control-group">
    <label>Link Distance: <span id="dist-val">100</span></label>
    <input type="range" id="link-distance" min="30" max="300" value="100" step="10">
  </div>
  <div class="control-group">
    <label>Node Size: <span id="size-val">1.0</span></label>
    <input type="range" id="node-size" min="0.5" max="3" value="1" step="0.1">
  </div>
  <div class="control-group">
    <label>Filter by Type</label>
    <select id="type-filter"><option value="all">All Types</option></select>
  </div>
  <button class="btn" id="btn-reset">Reset View</button>
  <button class="btn" id="btn-mermaid">Show Mermaid</button>

  <h3 style="margin-top:20px">Legend</h3>
  <div class="legend" id="legend"></div>
</div>

<div id="graph-container"></div>
<div class="tooltip" id="tooltip"></div>

<!-- Mermaid modal -->
<div id="mermaid-modal" style="display:none; position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.7); display:none; align-items:center; justify-content:center;">
  <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:24px; max-width:800px; width:90%; max-height:80vh; overflow:auto;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h3 style="color:#f0f6fc;">Mermaid Diagram Source</h3>
      <button onclick="document.getElementById('mermaid-modal').style.display='none'" style="background:none; border:none; color:#8b949e; font-size:20px; cursor:pointer;">✕</button>
    </div>
    <pre id="mermaid-source" style="background:#0d1117; padding:16px; border-radius:8px; font-size:11px; color:#c9d1d9; white-space:pre-wrap; overflow-x:auto;"></pre>
    <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('mermaid-source').textContent)" style="margin-top:12px; max-width:200px;">Copy to Clipboard</button>
  </div>
</div>

<script>
// ── Data ──
const graphData = ${d3Json};
const mermaidSource = ${JSON.stringify(meta.mermaidContent)};

// ── Setup SVG ──
const container = document.getElementById("graph-container");
const width = container.clientWidth;
const height = container.clientHeight;

const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.setAttribute("viewBox", \`0 0 \${width} \${height}\`);
container.appendChild(svg);

// Zoom group
let gMain;
{
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(g);
  gMain = g;
}

// ── Build adjacency for highlighting ──
const adj = new Map();
graphData.links.forEach(l => {
  if (!adj.has(l.source)) adj.set(l.source, new Set());
  if (!adj.has(l.target)) adj.set(l.target, new Set());
  adj.get(l.source).add(l.target);
  adj.get(l.target).add(l.source);
});

// ── Populate legend + type filter ──
const typeSet = new Set(graphData.nodes.map(n => n.resourceType));
const colors = ${JSON.stringify(DEFAULT_COLORS)};
const legend = document.getElementById("legend");
const typeFilter = document.getElementById("type-filter");
[...typeSet].sort().forEach(t => {
  const c = colors[t] || "#666";
  legend.innerHTML += \`<div class="legend-item"><div class="legend-dot" style="background:\${c}"></div>\${t}</div>\`;
  const opt = document.createElement("option");
  opt.value = t; opt.text = t;
  typeFilter.appendChild(opt);
});

// ── D3-like force simulation (pure JS) ──
const nodes = graphData.nodes.map(n => ({
  ...n,
  x: width / 2 + (Math.random() - 0.5) * 400,
  y: height / 2 + (Math.random() - 0.5) * 400,
  vx: 0, vy: 0,
}));
const nodeMap = new Map(nodes.map(n => [n.id, n]));
const links = graphData.links.map(l => ({
  ...l,
  sourceNode: nodeMap.get(l.source),
  targetNode: nodeMap.get(l.target),
})).filter(l => l.sourceNode && l.targetNode);

let chargeStrength = -200;
let linkDist = 100;
let sizeMultiplier = 1;
let activeFilter = "all";
let selectedNode = null;
let transform = { x: 0, y: 0, k: 1 };

// ── Simulation ──
function simulate() {
  const alpha = 0.3;

  // Center gravity
  nodes.forEach(n => {
    if (n._hidden) return;
    n.vx += (width / 2 - n.x) * 0.001;
    n.vy += (height / 2 - n.y) * 0.001;
  });

  // Charge repulsion (Barnes-Hut approximation for large graphs)
  const visibleNodes = nodes.filter(n => !n._hidden);
  for (let i = 0; i < visibleNodes.length; i++) {
    for (let j = i + 1; j < visibleNodes.length; j++) {
      const a = visibleNodes[i], b = visibleNodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = chargeStrength / (dist * dist);
      const fx = dx / dist * force;
      const fy = dy / dist * force;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
    }
  }

  // Link spring forces
  links.forEach(l => {
    if (l.sourceNode._hidden || l.targetNode._hidden) return;
    const dx = l.targetNode.x - l.sourceNode.x;
    const dy = l.targetNode.y - l.sourceNode.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - linkDist) * 0.005;
    const fx = dx / dist * force, fy = dy / dist * force;
    l.sourceNode.vx += fx; l.sourceNode.vy += fy;
    l.targetNode.vx -= fx; l.targetNode.vy -= fy;
  });

  // Apply velocity with damping
  nodes.forEach(n => {
    if (n._hidden || n._dragging) return;
    n.vx *= 0.6; n.vy *= 0.6;
    n.x += n.vx * alpha;
    n.y += n.vy * alpha;
  });
}

// ── Render ──
function render() {
  gMain.innerHTML = "";
  gMain.setAttribute("transform", \`translate(\${transform.x},\${transform.y}) scale(\${transform.k})\`);

  // Draw links
  links.forEach(l => {
    if (l.sourceNode._hidden || l.targetNode._hidden) return;
    const isHighlighted = selectedNode && (l.source === selectedNode || l.target === selectedNode);
    const opacity = selectedNode ? (isHighlighted ? 0.8 : 0.1) : 0.4;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", l.sourceNode.x);
    line.setAttribute("y1", l.sourceNode.y);
    line.setAttribute("x2", l.targetNode.x);
    line.setAttribute("y2", l.targetNode.y);
    line.setAttribute("stroke", isHighlighted ? "#58a6ff" : "#30363d");
    line.setAttribute("stroke-width", isHighlighted ? 2.5 : 1.2);
    line.setAttribute("stroke-opacity", opacity);
    if (l.confidence < 0.8) line.setAttribute("stroke-dasharray", "5,5");
    gMain.appendChild(line);

    // Edge label
    const mx = (l.sourceNode.x + l.targetNode.x) / 2;
    const my = (l.sourceNode.y + l.targetNode.y) / 2;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", mx);
    text.setAttribute("y", my - 6);
    text.setAttribute("class", "edge-label");
    text.setAttribute("opacity", selectedNode ? (isHighlighted ? 1 : 0) : 0.6);
    text.textContent = l.relationship;
    gMain.appendChild(text);
  });

  // Draw nodes
  nodes.forEach(n => {
    if (n._hidden) return;
    const isNeighbor = selectedNode && (n.id === selectedNode || adj.get(selectedNode)?.has(n.id));
    const opacity = selectedNode ? (isNeighbor ? 1 : 0.15) : (n.opacity ?? 1);
    const r = (n.radius || 8) * sizeMultiplier;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", n.x);
    circle.setAttribute("cy", n.y);
    circle.setAttribute("r", r);
    circle.setAttribute("fill", n.color || "#666");
    circle.setAttribute("stroke", isNeighbor && selectedNode ? "#58a6ff" : "#0d1117");
    circle.setAttribute("stroke-width", isNeighbor && selectedNode ? 2.5 : 1.5);
    circle.setAttribute("opacity", opacity);
    circle.setAttribute("cursor", "pointer");
    circle.setAttribute("data-id", n.id);
    gMain.appendChild(circle);

    // Node label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", n.x);
    text.setAttribute("y", n.y + r + 14);
    text.setAttribute("class", "node-label");
    text.setAttribute("opacity", opacity);
    text.textContent = n.label;
    gMain.appendChild(text);
  });
}

// ── Animation loop ──
let running = true;
function tick() {
  if (!running) return;
  simulate();
  render();
  requestAnimationFrame(tick);
}
// Slow down after stabilization
setTimeout(() => { running = false; render(); }, 5000);
tick();

// ── Interaction: Click to select ──
svg.addEventListener("click", e => {
  const target = e.target;
  const id = target.getAttribute?.("data-id");
  if (id) {
    selectedNode = selectedNode === id ? null : id;
    render();
    showTooltip(e, id);
  } else {
    selectedNode = null;
    hideTooltip();
    render();
  }
});

// ── Interaction: Hover tooltip ──
const tooltip = document.getElementById("tooltip");
svg.addEventListener("mousemove", e => {
  const target = e.target;
  const id = target.getAttribute?.("data-id");
  if (id) showTooltip(e, id);
});
svg.addEventListener("mouseleave", hideTooltip);

function showTooltip(e, id) {
  const n = nodeMap.get(id);
  if (!n) return;
  const neighbors = adj.get(id)?.size ?? 0;
  tooltip.style.display = "block";
  tooltip.style.left = (e.clientX + 16) + "px";
  tooltip.style.top = (e.clientY + 16) + "px";
  tooltip.innerHTML = \`
    <h4>\${n.label}</h4>
    <div class="tt-row"><span class="tt-key">Type</span><span class="tt-val">\${n.resourceType}</span></div>
    <div class="tt-row"><span class="tt-key">Provider</span><span class="tt-val">\${n.provider}</span></div>
    <div class="tt-row"><span class="tt-key">Region</span><span class="tt-val">\${n.region || n.group || 'global'}</span></div>
    <div class="tt-row"><span class="tt-key">Status</span><span class="tt-val">\${n.status}</span></div>
    <div class="tt-row"><span class="tt-key">Cost</span><span class="tt-val">\${n.costMonthly != null ? '$' + n.costMonthly.toFixed(2) + '/mo' : '—'}</span></div>
    <div class="tt-row"><span class="tt-key">Connections</span><span class="tt-val">\${neighbors}</span></div>
  \`;
}
function hideTooltip() { tooltip.style.display = "none"; }

// ── Interaction: Zoom + Pan (mouse wheel + drag) ──
svg.addEventListener("wheel", e => {
  e.preventDefault();
  const scale = e.deltaY > 0 ? 0.9 : 1.1;
  transform.k *= scale;
  transform.k = Math.max(0.1, Math.min(5, transform.k));
  // Zoom toward cursor
  const rect = svg.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  transform.x = mx - (mx - transform.x) * scale;
  transform.y = my - (my - transform.y) * scale;
  render();
}, { passive: false });

let isPanning = false, panStart = { x: 0, y: 0 };
svg.addEventListener("mousedown", e => {
  if (e.target === svg || e.target.tagName === "line" || e.target.tagName === "text") {
    isPanning = true;
    panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }
});
svg.addEventListener("mousemove", e => {
  if (isPanning) {
    transform.x = e.clientX - panStart.x;
    transform.y = e.clientY - panStart.y;
    render();
  }
});
svg.addEventListener("mouseup", () => { isPanning = false; });

// ── Controls ──
document.getElementById("force-charge").addEventListener("input", e => {
  chargeStrength = +e.target.value;
  document.getElementById("force-val").textContent = chargeStrength;
  running = true; setTimeout(() => { running = false; render(); }, 3000); tick();
});
document.getElementById("link-distance").addEventListener("input", e => {
  linkDist = +e.target.value;
  document.getElementById("dist-val").textContent = linkDist;
  running = true; setTimeout(() => { running = false; render(); }, 3000); tick();
});
document.getElementById("node-size").addEventListener("input", e => {
  sizeMultiplier = +e.target.value;
  document.getElementById("size-val").textContent = sizeMultiplier.toFixed(1);
  render();
});
document.getElementById("type-filter").addEventListener("change", e => {
  activeFilter = e.target.value;
  nodes.forEach(n => { n._hidden = activeFilter !== "all" && n.resourceType !== activeFilter; });
  render();
});
document.getElementById("btn-reset").addEventListener("click", () => {
  transform = { x: 0, y: 0, k: 1 };
  selectedNode = null;
  activeFilter = "all";
  document.getElementById("type-filter").value = "all";
  nodes.forEach(n => { n._hidden = false; });
  running = true; setTimeout(() => { running = false; render(); }, 3000); tick();
});
document.getElementById("btn-mermaid").addEventListener("click", () => {
  document.getElementById("mermaid-source").textContent = mermaidSource;
  document.getElementById("mermaid-modal").style.display = "flex";
});
</script>
</body>
</html>`;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
