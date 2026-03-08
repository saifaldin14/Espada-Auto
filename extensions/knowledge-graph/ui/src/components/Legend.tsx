import {
  RESOURCE_TYPE_COLORS,
  RESOURCE_TYPE_SHAPES,
  RESOURCE_TYPE_ICONS,
} from "../types";

interface Props {
  types: string[];
  activeFilter: Set<string>;
  onToggle: (type: string) => void;
  onClear: () => void;
}

/** Map Cytoscape shape names to CSS border-radius / clip-path for the legend swatch */
function shapeStyle(shape: string): React.CSSProperties {
  switch (shape) {
    case "round-rectangle":
      return { borderRadius: "3px", width: 14, height: 10 };
    case "ellipse":
      return { borderRadius: "50%", width: 12, height: 12 };
    case "diamond":
    case "round-diamond":
      return {
        borderRadius: "2px",
        width: 12,
        height: 12,
        transform: "rotate(45deg) scale(0.75)",
      };
    case "hexagon":
    case "round-hexagon":
      return {
        clipPath:
          "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
        borderRadius: 0,
        width: 14,
        height: 12,
      };
    case "barrel":
      return { borderRadius: "40%/50%", width: 14, height: 10 };
    case "round-triangle":
      return {
        clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
        borderRadius: 0,
        width: 12,
        height: 12,
      };
    case "round-pentagon":
      return {
        clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
        borderRadius: 0,
        width: 13,
        height: 12,
      };
    default:
      return { borderRadius: "50%", width: 12, height: 12 };
  }
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
          const color = RESOURCE_TYPE_COLORS[t] || "#768390";
          const shape = RESOURCE_TYPE_SHAPES[t] || "ellipse";
          const icon = RESOURCE_TYPE_ICONS[t] || "\u2699";
          return (
            <button
              key={t}
              className={`legend-item ${active ? "" : "inactive"}`}
              onClick={() => onToggle(t)}
            >
              <span
                className="legend-shape"
                style={{
                  ...shapeStyle(shape),
                  background: color,
                  boxShadow: `0 0 6px ${color}55`,
                }}
              />
              <span className="legend-icon">{icon}</span>
              <span className="legend-label">{t}</span>
              <span className="legend-count">{counts[t]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
