import { useEffect, useRef, useCallback, useState } from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import dagre from "cytoscape-dagre";
import fcose from "cytoscape-fcose";
import type { GraphNode, GraphEdge } from "../types";
import {
  RESOURCE_TYPE_COLORS,
  RESOURCE_TYPE_COLORS_DARK,
  RESOURCE_TYPE_SHAPES,
  RESOURCE_TYPE_ICONS,
} from "../types";

// Register layout extensions
cytoscape.use(dagre);
cytoscape.use(fcose);

/** Hierarchy tier for top-down layout ranking */
const RESOURCE_TIER: Record<string, number> = {
  "internet-gateway": 0,
  "load-balancer": 1,
  "nat-gateway": 1,
  vpc: 2,
  subnet: 3,
  "security-group": 3,
  "route-table": 3,
  compute: 4,
  container: 4,
  database: 5,
  storage: 5,
  "iam-role": 6,
  "elastic-ip": 6,
  custom: 7,
};

const LAYOUTS = [
  { id: "dagre-tb", label: "Hierarchy ↓" },
  { id: "dagre-lr", label: "Hierarchy →" },
  { id: "fcose", label: "Force" },
  { id: "breadthfirst", label: "Tree" },
  { id: "concentric", label: "Concentric" },
  { id: "grid", label: "Grid" },
] as const;
type LayoutName = (typeof LAYOUTS)[number]["id"];

/** Build Cytoscape layout options for a given layout name */
function buildLayoutOptions(name: LayoutName) {
  const base = {
    animate: true,
    animationDuration: 750,
    animationEasing: "ease-out-cubic",
    nodeDimensionsIncludeLabels: true,
  };

  switch (name) {
    case "dagre-tb":
      return {
        ...base,
        name: "dagre",
        rankDir: "TB",
        rankSep: 80,
        nodeSep: 50,
        edgeSep: 20,
        ranker: "tight-tree",
      };
    case "dagre-lr":
      return {
        ...base,
        name: "dagre",
        rankDir: "LR",
        rankSep: 100,
        nodeSep: 40,
        edgeSep: 20,
        ranker: "tight-tree",
      };
    case "fcose":
      return {
        ...base,
        name: "fcose",
        quality: "proof",
        randomize: true,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 140,
        edgeElasticity: () => 0.45,
        gravity: 0.25,
        gravityRange: 3.8,
        numIter: 2500,
        tile: true,
        tilingPaddingVertical: 20,
        tilingPaddingHorizontal: 20,
      };
    case "breadthfirst":
      return {
        ...base,
        name: "breadthfirst",
        directed: true,
        spacingFactor: 1.5,
        avoidOverlap: true,
        circle: false,
      };
    case "concentric":
      return {
        ...base,
        name: "concentric",
        minNodeSpacing: 60,
        concentric: (node: any) => {
          const tier = RESOURCE_TIER[node.data("type")];
          return tier !== undefined ? 10 - tier : 3;
        },
        levelWidth: () => 2,
        avoidOverlap: true,
      };
    case "grid":
      return {
        ...base,
        name: "grid",
        avoidOverlap: true,
        condense: true,
        rows: undefined,
        sort: (a: any, b: any) => {
          const ta = RESOURCE_TIER[a.data("type")] ?? 99;
          const tb = RESOURCE_TIER[b.data("type")] ?? 99;
          return ta - tb;
        },
      };
    default:
      return { ...base, name };
  }
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  typeFilter: Set<string>;
}

export function GraphView({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  typeFilter,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [layoutName, setLayoutName] = useState<LayoutName>("dagre-tb");
  const [searchTerm, setSearchTerm] = useState("");
  const [hideOrphans, setHideOrphans] = useState(true);

  // Build elements
  const buildElements = useCallback(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const visibleNodeIds = new Set(
      nodes
        .filter((n) => typeFilter.size === 0 || typeFilter.has(n.resourceType))
        .map((n) => n.id),
    );

    // Pre-compute edge counts for sizing
    const edgeCounts: Record<string, number> = {};
    for (const e of edges) {
      // Only count edges where both endpoints are visible
      const src = e.sourceNodeId;
      const tgt = e.targetNodeId;
      if (
        src &&
        tgt &&
        nodeIds.has(src) &&
        nodeIds.has(tgt) &&
        visibleNodeIds.has(src) &&
        visibleNodeIds.has(tgt)
      ) {
        edgeCounts[src] = (edgeCounts[src] || 0) + 1;
        edgeCounts[tgt] = (edgeCounts[tgt] || 0) + 1;
      }
    }

    // Determine connected node IDs (nodes that have at least one visible edge)
    const connectedNodeIds = new Set(Object.keys(edgeCounts));

    const elems: cytoscape.ElementDefinition[] = [];

    for (const n of nodes) {
      if (!visibleNodeIds.has(n.id)) continue;
      // Skip orphans if toggle is on
      if (hideOrphans && !connectedNodeIds.has(n.id)) continue;
      const degree = edgeCounts[n.id] || 0;
      // Nodes with more connections or higher cost appear larger
      const sizeWeight = Math.min(
        1,
        0.4 + degree * 0.1 + (n.costMonthly > 50 ? 0.2 : 0),
      );
      elems.push({
        group: "nodes",
        data: {
          id: n.id,
          label: n.name,
          type: n.resourceType,
          provider: n.provider,
          region: n.region,
          account: n.account,
          cost: n.costMonthly,
          status: n.status,
          icon: RESOURCE_TYPE_ICONS[n.resourceType] || "\u2699",
          sizeWeight,
        },
      });
    }

    for (const e of edges) {
      const src = e.sourceNodeId;
      const tgt = e.targetNodeId;
      if (!src || !tgt || !nodeIds.has(src) || !nodeIds.has(tgt)) continue;
      if (!visibleNodeIds.has(src) || !visibleNodeIds.has(tgt)) continue;
      elems.push({
        group: "edges",
        data: {
          id: e.id || `${src}-${tgt}`,
          source: src,
          target: tgt,
          label: e.relationshipType,
        },
      });
    }

    return elems;
  }, [nodes, edges, typeFilter, hideOrphans]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    // Build per-type style rules with gradient fills
    const typeStyles = Object.entries(RESOURCE_TYPE_COLORS).map(
      ([type, color]) => ({
        selector: `node[type="${type}"]`,
        style: {
          "background-color": color,
          "background-fill": "linear-gradient" as any,
          "background-gradient-stop-colors":
            `${color} ${RESOURCE_TYPE_COLORS_DARK[type] || color}` as any,
          "background-gradient-direction": "to-bottom-right" as any,
          shape: (RESOURCE_TYPE_SHAPES[type] || "ellipse") as any,
          "border-color": color,
        },
      }),
    );

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(),
      style: [
        // ── Base node style ──
        {
          selector: "node",
          style: {
            // Label
            label: "data(label)",
            "font-size": "10px",
            "font-weight": "600" as any,
            color: "#e6edf3",
            "text-outline-color": "#0d1117",
            "text-outline-width": 2.5,
            "text-outline-opacity": 0.85 as any,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 10,
            "text-max-width": "90px" as any,
            "text-wrap": "ellipsis" as any,

            // Size — driven by sizeWeight
            width: "mapData(sizeWeight, 0, 1, 36, 60)" as any,
            height: "mapData(sizeWeight, 0, 1, 36, 60)" as any,

            // Color (fallback)
            "background-color": "#768390",
            "background-opacity": 1,

            // Border
            "border-width": 2.5,
            "border-color": "#444c56",
            "border-opacity": 0.7,

            // Overlay (subtle ring)
            "overlay-padding": 6,
            "overlay-opacity": 0,

            // Shadow / glow
            "shadow-blur": "8" as any,
            "shadow-color": "#000" as any,
            "shadow-offset-x": "0" as any,
            "shadow-offset-y": "2" as any,
            "shadow-opacity": "0.45" as any,

            // Transitions
            "transition-property":
              "border-color, border-width, width, height, opacity, shadow-blur, shadow-opacity" as any,
            "transition-duration": "0.2s" as any,
          },
        },

        // ── Per-type gradient + shape ──
        ...typeStyles,

        // ── Status indicators ──
        {
          selector: 'node[status="active"]',
          style: {
            "border-style": "solid" as any,
          },
        },
        {
          selector: 'node[status="warning"]',
          style: {
            "border-color": "#e3b341",
            "border-style": "dashed" as any,
            "border-width": 3,
          },
        },
        {
          selector: 'node[status="error"]',
          style: {
            "border-color": "#f47067",
            "border-style": "dashed" as any,
            "border-width": 3,
            "shadow-color": "#f47067" as any,
            "shadow-blur": "12" as any,
            "shadow-opacity": "0.5" as any,
          },
        },

        // ── Selected ──
        {
          selector: "node:selected",
          style: {
            "border-color": "#58a6ff",
            "border-width": 4,
            "border-opacity": 1,
            width: "mapData(sizeWeight, 0, 1, 44, 68)" as any,
            height: "mapData(sizeWeight, 0, 1, 44, 68)" as any,
            "shadow-color": "#58a6ff" as any,
            "shadow-blur": "20" as any,
            "shadow-opacity": "0.6" as any,
            "z-index": 999,
          },
        },

        // ── Search highlight ──
        {
          selector: "node.highlighted",
          style: {
            "border-color": "#ffa657",
            "border-width": 3.5,
            "border-opacity": 1,
            "shadow-color": "#ffa657" as any,
            "shadow-blur": "16" as any,
            "shadow-opacity": "0.55" as any,
          },
        },

        // ── Neighbor highlight on hover ──
        {
          selector: "node.neighbor",
          style: {
            "border-color": "#58a6ff",
            "border-width": 3,
            "border-opacity": 1,
            "shadow-color": "#58a6ff" as any,
            "shadow-blur": "12" as any,
            "shadow-opacity": "0.4" as any,
          },
        },

        // ── Dimmed (non-focused) ──
        {
          selector: "node.dimmed",
          style: {
            opacity: 0.15,
          },
        },

        // ── Edges ──
        {
          selector: "edge",
          style: {
            width: 1.8,
            "line-color": "#2d333b",
            "line-opacity": 0.7,
            "target-arrow-color": "#444c56",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.9 as any,
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": "8px",
            "font-weight": "500" as any,
            color: "#555d66",
            "text-rotation": "autorotate" as any,
            "text-margin-y": -10,
            "text-outline-color": "#0d1117",
            "text-outline-width": 1.5,
            "text-outline-opacity": 0.6 as any,
            "text-opacity": 0.8,
            "transition-property":
              "line-color, target-arrow-color, width, opacity, line-opacity",
            "transition-duration": "0.2s" as any,
          },
        },

        // ── Selected edge ──
        {
          selector: "edge:selected",
          style: {
            "line-color": "#58a6ff",
            "line-opacity": 1,
            "target-arrow-color": "#58a6ff",
            width: 3,
            color: "#8b9eb0",
            "text-opacity": 1,
          },
        },

        // ── Neighbor edge ──
        {
          selector: "edge.neighbor",
          style: {
            "line-color": "#388bfd",
            "line-opacity": 0.85,
            "target-arrow-color": "#388bfd",
            width: 2.5,
            color: "#6cb6ff",
            "text-opacity": 1,
            "z-index": 10,
          },
        },

        // ── Dimmed edge ──
        {
          selector: "edge.dimmed",
          style: {
            opacity: 0.08,
          },
        },
      ] as any,
      layout: buildLayoutOptions(layoutName) as any,
      minZoom: 0.05,
      maxZoom: 6,
      wheelSensitivity: 0.25,
      pixelRatio: "auto",
    });

    // Tap node
    cy.on("tap", "node", (evt: EventObject) => {
      onSelectNode(evt.target.id());
    });

    // Tap canvas background
    cy.on("tap", (evt: EventObject) => {
      if (evt.target === cy) {
        onSelectNode(null);
      }
    });

    // Mouseover for neighbor highlight
    cy.on("mouseover", "node", (evt: EventObject) => {
      const node = evt.target;
      const neighborhood = node.closedNeighborhood();
      cy.elements().addClass("dimmed");
      neighborhood.removeClass("dimmed");
      neighborhood.nodes().addClass("neighbor");
      neighborhood.edges().addClass("neighbor");
      node.removeClass("neighbor");
    });

    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("dimmed neighbor");
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update elements when data or filter changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().remove();
    cy.add(buildElements());
    cy.layout(buildLayoutOptions(layoutName) as any).run();
  }, [buildElements, layoutName]);

  // Highlight selected node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedNodeId) {
      const node = cy.getElementById(selectedNodeId);
      if (node.length) {
        node.select();
        cy.animate({ center: { eles: node }, duration: 300 });
      }
    }
  }, [selectedNodeId]);

  // Search highlight
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("highlighted");
    if (searchTerm.length >= 2) {
      const term = searchTerm.toLowerCase();
      cy.nodes().forEach((n) => {
        if (
          n.data("label")?.toLowerCase().includes(term) ||
          n.data("id")?.toLowerCase().includes(term)
        ) {
          n.addClass("highlighted");
        }
      });
    }
  }, [searchTerm]);

  const fit = () => cyRef.current?.fit(undefined, 40);
  const zoomIn = () => {
    const cy = cyRef.current;
    if (cy)
      cy.zoom({
        level: cy.zoom() * 1.4,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
  };
  const zoomOut = () => {
    const cy = cyRef.current;
    if (cy)
      cy.zoom({
        level: cy.zoom() / 1.4,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
  };
  const nextLayout = () => {
    const idx = LAYOUTS.findIndex((l) => l.id === layoutName);
    setLayoutName(LAYOUTS[(idx + 1) % LAYOUTS.length].id);
  };
  const currentLayoutLabel =
    LAYOUTS.find((l) => l.id === layoutName)?.label ?? layoutName;

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <div className="graph-search">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search nodes…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          {searchTerm && (
            <button className="search-clear" onClick={() => setSearchTerm("")}>
              ✕
            </button>
          )}
        </div>
        <div className="graph-controls">
          <button
            className={`ctrl-btn ${hideOrphans ? "ctrl-btn-active" : ""}`}
            onClick={() => setHideOrphans((h) => !h)}
            title={
              hideOrphans
                ? "Show all nodes (including orphans)"
                : "Hide orphaned nodes"
            }
          >
            {hideOrphans ? "◉ Connected" : "○ All nodes"}
          </button>
          <button className="ctrl-btn" onClick={fit} title="Fit to screen">
            ⊞ Fit
          </button>
          <select
            className="ctrl-select"
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value as LayoutName)}
            title="Graph layout"
          >
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button className="ctrl-btn" onClick={zoomIn} title="Zoom in">
            +
          </button>
          <button className="ctrl-btn" onClick={zoomOut} title="Zoom out">
            −
          </button>
        </div>
      </div>
      <div ref={containerRef} className="graph-canvas" />
    </div>
  );
}
