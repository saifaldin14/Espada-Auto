import { useEffect, useRef, useCallback, useState } from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import type { GraphNode, GraphEdge } from "../types";
import { RESOURCE_TYPE_COLORS, RESOURCE_TYPE_SHAPES } from "../types";

const LAYOUTS = [
  "cose",
  "breadthfirst",
  "circle",
  "concentric",
  "grid",
] as const;
type LayoutName = (typeof LAYOUTS)[number];

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
  const [layoutName, setLayoutName] = useState<LayoutName>("cose");
  const [searchTerm, setSearchTerm] = useState("");

  // Build elements
  const buildElements = useCallback(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const visibleNodeIds = new Set(
      nodes
        .filter((n) => typeFilter.size === 0 || typeFilter.has(n.resourceType))
        .map((n) => n.id),
    );

    const elems: cytoscape.ElementDefinition[] = [];

    for (const n of nodes) {
      if (!visibleNodeIds.has(n.id)) continue;
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
  }, [nodes, edges, typeFilter]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(),
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": "11px",
            color: "#e6edf3",
            "text-outline-color": "#0d1117",
            "text-outline-width": 2,
            "text-valign": "bottom",
            "text-margin-y": 8,
            width: 44,
            height: 44,
            "border-width": 2,
            "border-color": "#30363d",
            "background-color": "#8b949e",
            "transition-property":
              "border-color, border-width, width, height, opacity",
            "transition-duration": "0.15s" as any,
          },
        },
        ...Object.entries(RESOURCE_TYPE_COLORS).map(([type, color]) => ({
          selector: `node[type="${type}"]`,
          style: {
            "background-color": color,
            shape: (RESOURCE_TYPE_SHAPES[type] || "ellipse") as any,
          },
        })),
        {
          selector: "node:selected",
          style: {
            "border-color": "#58a6ff",
            "border-width": 4,
            width: 52,
            height: 52,
          },
        },
        {
          selector: "node.highlighted",
          style: {
            "border-color": "#ffa657",
            "border-width": 3,
          },
        },
        {
          selector: "node.neighbor",
          style: {
            "border-color": "#58a6ff",
            "border-width": 3,
          },
        },
        {
          selector: "node.dimmed",
          style: {
            opacity: 0.25,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#30363d",
            "target-arrow-color": "#484f58",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": "9px",
            color: "#484f58",
            "text-rotation": "autorotate" as any,
            "text-margin-y": -10,
            "transition-property":
              "line-color, target-arrow-color, width, opacity",
            "transition-duration": "0.15s" as any,
          },
        },
        {
          selector: "edge:selected",
          style: {
            "line-color": "#58a6ff",
            "target-arrow-color": "#58a6ff",
            width: 3,
          },
        },
        {
          selector: "edge.neighbor",
          style: {
            "line-color": "#58a6ff",
            "target-arrow-color": "#58a6ff",
            width: 2.5,
          },
        },
        {
          selector: "edge.dimmed",
          style: {
            opacity: 0.15,
          },
        },
      ],
      layout: {
        name: "cose",
        animate: true,
        animationDuration: 800,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 100,
      },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
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
    cy.layout({
      name: layoutName,
      animate: true,
      animationDuration: 600,
      nodeRepulsion: () => 8000,
      idealEdgeLength: () => 100,
    } as any).run();
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
    const idx = LAYOUTS.indexOf(layoutName);
    setLayoutName(LAYOUTS[(idx + 1) % LAYOUTS.length]);
  };

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
          <button className="ctrl-btn" onClick={fit} title="Fit to screen">
            ⊞ Fit
          </button>
          <button
            className="ctrl-btn"
            onClick={nextLayout}
            title="Change layout"
          >
            ◐ {layoutName}
          </button>
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
