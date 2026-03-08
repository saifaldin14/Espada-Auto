import type { DriftResponse } from "../types";

interface Props {
  drift: DriftResponse | null;
}

export function DriftPanel({ drift }: Props) {
  if (!drift) {
    return <div className="panel-loading">Loading drift data…</div>;
  }

  return (
    <div className="drift-panel">
      <div className="drift-summary">
        <div
          className={`drift-hero ${drift.driftedCount > 0 ? "has-drift" : "no-drift"}`}
        >
          <div className="drift-hero-icon">
            {drift.driftedCount > 0 ? "⚠" : "✓"}
          </div>
          <div className="drift-hero-count">{drift.driftedCount}</div>
          <div className="drift-hero-label">
            {drift.driftedCount === 0
              ? "No configuration drift detected"
              : `resource${drift.driftedCount > 1 ? "s" : ""} with drift`}
          </div>
        </div>
      </div>

      {drift.items && drift.items.length > 0 ? (
        <div className="drift-list">
          {drift.items.map((item, i) => (
            <div
              key={`${item.nodeId}-${item.field}-${i}`}
              className="drift-card"
            >
              <div className="drift-card-header">
                <span className="drift-resource-name">{item.nodeName}</span>
                <span className="badge-type">{item.resourceType}</span>
                <span className="badge-region">{item.provider}</span>
              </div>
              <div className="drift-card-body">
                <div className="drift-field">
                  <span className="drift-field-label">Field</span>
                  <code className="drift-field-value">{item.field}</code>
                </div>
                <div className="drift-diff">
                  <div className="drift-expected">
                    <span className="drift-diff-label">Expected</span>
                    <code>{item.expected}</code>
                  </div>
                  <span className="drift-arrow">→</span>
                  <div className="drift-actual">
                    <span className="drift-diff-label">Actual</span>
                    <code>{item.actual}</code>
                  </div>
                </div>
                <div className="drift-time">
                  Last checked:{" "}
                  {item.lastCheckedAt
                    ? new Date(item.lastCheckedAt).toLocaleString()
                    : "–"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : drift.driftedCount === 0 ? (
        <div className="drift-empty">
          <div className="drift-empty-icon">🎯</div>
          <p>All resources match their expected configuration.</p>
          <p className="text-muted">
            Drift detection compares live cloud state against saved baselines.
          </p>
        </div>
      ) : null}
    </div>
  );
}
