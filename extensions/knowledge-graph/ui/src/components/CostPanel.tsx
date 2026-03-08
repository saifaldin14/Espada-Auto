import type { CostResponse } from "../types";
import { RESOURCE_TYPE_COLORS } from "../types";

interface Props {
  cost: CostResponse | null;
}

export function CostPanel({ cost }: Props) {
  if (!cost) {
    return <div className="panel-loading">Loading cost data…</div>;
  }

  const totalAnnual = cost.totalMonthly * 12;
  const byType = Object.entries(cost.byResourceType || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const byProvider = Object.entries(cost.byProvider || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const byRegion = Object.entries(cost.byRegion || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const topResources = (cost.topResources || []).slice(0, 15);

  const maxByType = byType[0]?.[1] || 1;

  return (
    <div className="cost-panel">
      {/* Summary cards */}
      <div className="cost-summary">
        <div className="cost-card primary">
          <div className="cost-card-value">${cost.totalMonthly.toFixed(2)}</div>
          <div className="cost-card-label">Monthly Cost</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-value">${totalAnnual.toFixed(2)}</div>
          <div className="cost-card-label">Estimated Annual</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-value">{byProvider.length}</div>
          <div className="cost-card-label">Providers</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-value">{byRegion.length}</div>
          <div className="cost-card-label">Regions</div>
        </div>
      </div>

      <div className="cost-grid">
        {/* By Resource Type */}
        <div className="cost-section">
          <h3 className="section-title">Cost by Resource Type</h3>
          <div className="bar-chart">
            {byType.map(([type, amount]) => (
              <div key={type} className="bar-row">
                <div className="bar-label">
                  <span
                    className="type-dot"
                    style={{
                      background: RESOURCE_TYPE_COLORS[type] || "#8b949e",
                    }}
                  />
                  {type}
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(amount / maxByType) * 100}%`,
                      background: RESOURCE_TYPE_COLORS[type] || "#8b949e",
                    }}
                  />
                </div>
                <div className="bar-value">${amount.toFixed(2)}</div>
              </div>
            ))}
            {byType.length === 0 && (
              <div className="empty-state">No cost data available</div>
            )}
          </div>
        </div>

        {/* By Provider */}
        <div className="cost-section">
          <h3 className="section-title">Cost by Provider</h3>
          <div className="cost-breakdown">
            {byProvider.map(([provider, amount]) => (
              <div key={provider} className="breakdown-item">
                <span className="breakdown-label">
                  {provider.toUpperCase()}
                </span>
                <span className="breakdown-value">${amount.toFixed(2)}</span>
                <span className="breakdown-pct">
                  {cost.totalMonthly > 0
                    ? `${((amount / cost.totalMonthly) * 100).toFixed(1)}%`
                    : "–"}
                </span>
              </div>
            ))}
          </div>

          <h3 className="section-title" style={{ marginTop: 24 }}>
            Cost by Region
          </h3>
          <div className="cost-breakdown">
            {byRegion.map(([region, amount]) => (
              <div key={region} className="breakdown-item">
                <span className="breakdown-label">{region}</span>
                <span className="breakdown-value">${amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Resources */}
      {topResources.length > 0 && (
        <div className="cost-section" style={{ marginTop: 16 }}>
          <h3 className="section-title">Top Resources by Cost</h3>
          <table className="resource-table compact">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Type</th>
                <th>Cost/mo</th>
              </tr>
            </thead>
            <tbody>
              {topResources.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <span className="badge-type">{r.type}</span>
                  </td>
                  <td className="cell-cost">${r.costMonthly.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
