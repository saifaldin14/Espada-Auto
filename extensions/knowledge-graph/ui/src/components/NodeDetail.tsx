import type { GraphNode, GraphEdge } from "../types";
import { RESOURCE_TYPE_COLORS } from "../types";

interface Props {
  node: GraphNode | null;
  allEdges: GraphEdge[];
  allNodes: GraphNode[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}

export function NodeDetail({
  node,
  allEdges,
  allNodes,
  onClose,
  onNavigate,
}: Props) {
  if (!node) {
    return (
      <div className="detail-panel empty">
        <div className="detail-empty">
          <div className="detail-empty-icon">⬡</div>
          <p>Select a node to inspect its details</p>
          <p className="text-muted">Click on a graph node or table row</p>
        </div>
      </div>
    );
  }

  const color = RESOURCE_TYPE_COLORS[node.resourceType] || "#8b949e";

  // Find connected nodes
  const connectedEdges = allEdges.filter(
    (e) => e.sourceNodeId === node.id || e.targetNodeId === node.id,
  );
  const connectedNodes = connectedEdges.map((e) => {
    const otherId =
      e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId;
    const otherNode = allNodes.find((n) => n.id === otherId);
    const direction = e.sourceNodeId === node.id ? "outgoing" : "incoming";
    return { edge: e, node: otherNode, direction };
  });

  const meta =
    node.metadata && typeof node.metadata === "object"
      ? Object.entries(node.metadata)
      : [];
  const tags =
    node.tags && typeof node.tags === "object" ? Object.entries(node.tags) : [];

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-title-row">
          <span className="detail-dot" style={{ background: color }} />
          <h3 className="detail-name">{node.name}</h3>
        </div>
        <button className="detail-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-section">
          <Field
            label="Type"
            value={<span className="badge-type">{node.resourceType}</span>}
          />
          <Field label="Provider" value={node.provider} />
          <Field label="Region" value={node.region} />
          <Field label="Account" value={node.account} />
          <Field
            label="Status"
            value={
              <span
                className={`badge-status ${node.status === "active" ? "status-active" : ""}`}
              >
                {node.status || "–"}
              </span>
            }
          />
          <Field
            label="Cost / month"
            value={`$${(node.costMonthly || 0).toFixed(2)}`}
          />
          <Field
            label="Native ID"
            value={<code className="native-id">{node.nativeId || "–"}</code>}
          />
          <Field
            label="ID"
            value={<code className="native-id">{node.id}</code>}
          />
          <Field
            label="First Seen"
            value={
              node.createdAt ? new Date(node.createdAt).toLocaleString() : "–"
            }
          />
          <Field
            label="Last Seen"
            value={
              node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "–"
            }
          />
        </div>

        {/* Connected Nodes */}
        {connectedNodes.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              Connections ({connectedNodes.length})
            </h4>
            <div className="connection-list">
              {connectedNodes.map(({ edge, node: other, direction }) => (
                <button
                  key={edge.id}
                  className="connection-item"
                  onClick={() => other && onNavigate(other.id)}
                >
                  <span className="conn-direction">
                    {direction === "outgoing" ? "→" : "←"}
                  </span>
                  <span
                    className="conn-dot"
                    style={{
                      background:
                        RESOURCE_TYPE_COLORS[other?.resourceType || ""] ||
                        "#8b949e",
                    }}
                  />
                  <span className="conn-name">{other?.name || "Unknown"}</span>
                  <span className="conn-rel">{edge.relationshipType}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section-title">Tags</h4>
            <div className="tag-list">
              {tags.map(([k, v]) => (
                <div key={k} className="tag-item">
                  <span className="tag-key">{k}</span>
                  <span className="tag-value">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {meta.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section-title">Metadata</h4>
            <pre className="metadata-json">
              {JSON.stringify(node.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="detail-field">
      <span className="detail-field-label">{label}</span>
      <span className="detail-field-value">{value}</span>
    </div>
  );
}
