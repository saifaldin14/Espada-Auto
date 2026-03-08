import type {
  HealthResponse,
  CostResponse,
  DriftResponse,
  StatsResponse,
} from "../types";

interface Props {
  health: HealthResponse | null;
  stats: StatsResponse | null;
  cost: CostResponse | null;
  drift: DriftResponse | null;
}

export function StatsBar({ health, stats, cost, drift }: Props) {
  const items = [
    { label: "Nodes", value: health?.nodes ?? "–", color: "var(--blue)" },
    { label: "Edges", value: health?.edges ?? "–", color: "var(--blue)" },
    {
      label: "Providers",
      value: stats?.nodesByProvider
        ? Object.keys(stats.nodesByProvider).length
        : "–",
      color: "var(--purple)",
    },
    {
      label: "Types",
      value: stats?.nodesByResourceType
        ? Object.keys(stats.nodesByResourceType).length
        : "–",
      color: "var(--purple)",
    },
    {
      label: "Monthly Cost",
      value: cost ? `$${cost.totalMonthly.toFixed(2)}` : "–",
      color: "var(--green)",
    },
    {
      label: "Drift",
      value: drift?.driftedCount ?? "–",
      color: drift && drift.driftedCount > 0 ? "var(--red)" : "var(--green)",
    },
    {
      label: "Storage",
      value: health?.storage ?? "–",
      color: "var(--fg-muted)",
    },
  ];

  return (
    <div className="stats-bar">
      {items.map((item) => (
        <div className="stat-item" key={item.label}>
          <span className="stat-value" style={{ color: item.color }}>
            {item.value}
          </span>
          <span className="stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
