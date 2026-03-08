import { RESOURCE_TYPE_COLORS } from "../types";

interface Props {
  types: string[];
  activeFilter: Set<string>;
  onToggle: (type: string) => void;
  onClear: () => void;
}

export function Legend({ types, activeFilter, onToggle, onClear }: Props) {
  if (types.length === 0) return null;

  const counts = types.reduce(
    (acc, t) => {
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const uniqueTypes = [...new Set(types)].sort();

  return (
    <div className="legend-panel">
      <div className="legend-header">
        <h4 className="legend-title">Resource Types</h4>
        {activeFilter.size > 0 && (
          <button className="legend-clear" onClick={onClear}>
            Clear filter
          </button>
        )}
      </div>
      <div className="legend-items">
        {uniqueTypes.map((t) => {
          const active = activeFilter.size === 0 || activeFilter.has(t);
          return (
            <button
              key={t}
              className={`legend-item ${active ? "" : "inactive"}`}
              onClick={() => onToggle(t)}
            >
              <span
                className="legend-dot"
                style={{ background: RESOURCE_TYPE_COLORS[t] || "#8b949e" }}
              />
              <span className="legend-label">{t}</span>
              <span className="legend-count">{counts[t]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
