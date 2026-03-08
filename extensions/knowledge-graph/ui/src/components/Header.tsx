import type { HealthResponse, ViewId } from "../types";

const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: "graph", label: "Graph", icon: "⬡" },
  { id: "resources", label: "Resources", icon: "☰" },
  { id: "query", label: "Query", icon: ">_" },
  { id: "cost", label: "Cost", icon: "$" },
  { id: "drift", label: "Drift", icon: "⚡" },
  { id: "compliance", label: "Compliance", icon: "✓" },
];

interface Props {
  activeView: ViewId;
  onViewChange: (v: ViewId) => void;
  health: HealthResponse | null;
  onRefresh: () => void;
}

export function Header({ activeView, onViewChange, health, onRefresh }: Props) {
  const connected = health?.status === "ok";

  return (
    <header className="header">
      <div className="header-left">
        <span className="header-logo">🔮</span>
        <h1 className="header-title">Espada</h1>
        <span className="header-subtitle">Infrastructure Knowledge Graph</span>
        <span
          className={`status-dot ${connected ? "connected" : "disconnected"}`}
        />
        <span className="status-text">
          {connected ? `v${health!.version}` : "Connecting…"}
        </span>
      </div>

      <nav className="header-nav">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`nav-tab ${activeView === v.id ? "active" : ""}`}
            onClick={() => onViewChange(v.id)}
          >
            <span className="nav-icon">{v.icon}</span>
            {v.label}
          </button>
        ))}
      </nav>

      <div className="header-right">
        <button className="btn-icon" onClick={onRefresh} title="Refresh data">
          ⟳
        </button>
      </div>
    </header>
  );
}
