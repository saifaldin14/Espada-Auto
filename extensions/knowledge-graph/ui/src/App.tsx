import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import type {
  ViewId,
  HealthResponse,
  TopologyResponse,
  CostResponse,
  DriftResponse,
  StatsResponse,
  GraphNode,
} from "./types";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { GraphView } from "./components/GraphView";
import { ResourceTable } from "./components/ResourceTable";
import { CostPanel } from "./components/CostPanel";
import { DriftPanel } from "./components/DriftPanel";
import { CompliancePanel } from "./components/CompliancePanel";
import { NodeDetail } from "./components/NodeDetail";
import { Legend } from "./components/Legend";
import { QueryEditor } from "./components/QueryEditor";

export function App() {
  const [view, setView] = useState<ViewId>("graph");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [topo, setTopo] = useState<TopologyResponse | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, t, c, d, s] = await Promise.all([
        api.health(),
        api.topology(),
        api.cost(),
        api.drift(),
        api.stats(),
      ]);
      setHealth(h);
      setTopo(t);
      setCost(c);
      setDrift(d);
      setStats(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("[KG] Failed to fetch data:", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const selectedNode: GraphNode | null =
    topo?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const allTypes = topo?.nodes.map((n) => n.resourceType) ?? [];

  const toggleType = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const showSidebar = view === "graph" || view === "resources";

  return (
    <div className="app">
      <Header
        activeView={view}
        onViewChange={setView}
        health={health}
        onRefresh={fetchAll}
      />
      <StatsBar health={health} stats={stats} cost={cost} drift={drift} />

      {loading && !health && (
        <div className="global-loading">
          <div className="spinner" />
          <span>Connecting to Knowledge Graph API…</span>
        </div>
      )}

      {error && !health && (
        <div className="global-error">
          <span className="error-icon">⚠</span>
          <span>Failed to connect: {error}</span>
          <button className="btn-retry" onClick={fetchAll}>
            Retry
          </button>
        </div>
      )}

      {health && (
        <main className="main-layout">
          <div className="content-area">
            {view === "graph" && topo && (
              <div className="graph-layout">
                <Legend
                  types={allTypes}
                  activeFilter={typeFilter}
                  onToggle={toggleType}
                  onClear={() => setTypeFilter(new Set())}
                />
                <GraphView
                  nodes={topo.nodes}
                  edges={topo.edges}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  typeFilter={typeFilter}
                />
              </div>
            )}

            {view === "resources" && topo && (
              <ResourceTable
                nodes={topo.nodes}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
            )}

            {view === "cost" && <CostPanel cost={cost} />}

            {view === "query" && <QueryEditor />}

            {view === "drift" && <DriftPanel drift={drift} />}

            {view === "compliance" && <CompliancePanel />}
          </div>

          {showSidebar && (
            <NodeDetail
              node={selectedNode}
              allEdges={topo?.edges ?? []}
              allNodes={topo?.nodes ?? []}
              onClose={() => setSelectedNodeId(null)}
              onNavigate={(id) => setSelectedNodeId(id)}
            />
          )}
        </main>
      )}
    </div>
  );
}
