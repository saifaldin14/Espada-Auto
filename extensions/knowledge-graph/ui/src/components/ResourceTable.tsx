import { useState, useMemo } from "react";
import type { GraphNode } from "../types";
import { RESOURCE_TYPE_COLORS } from "../types";

type SortKey =
  | "name"
  | "resourceType"
  | "provider"
  | "region"
  | "status"
  | "costMonthly";
type SortDir = "asc" | "desc";

interface Props {
  nodes: GraphNode[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

export function ResourceTable({ nodes, selectedNodeId, onSelectNode }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");

  const types = useMemo(
    () => [...new Set(nodes.map((n) => n.resourceType))].sort(),
    [nodes],
  );
  const providers = useMemo(
    () => [...new Set(nodes.map((n) => n.provider))].sort(),
    [nodes],
  );

  const filtered = useMemo(() => {
    let list = nodes;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.name.toLowerCase().includes(s) ||
          n.id.toLowerCase().includes(s) ||
          n.nativeId?.toLowerCase().includes(s) ||
          n.region?.toLowerCase().includes(s),
      );
    }
    if (typeFilter !== "all")
      list = list.filter((n) => n.resourceType === typeFilter);
    if (providerFilter !== "all")
      list = list.filter((n) => n.provider === providerFilter);
    return list;
  }, [nodes, search, typeFilter, providerFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: string | number = a[sortKey] ?? "";
      let vb: string | number = b[sortKey] ?? "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="resource-table-view">
      <div className="table-toolbar">
        <div className="table-search">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search resources…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="table-filters">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">All types ({types.length})</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">All providers ({providers.length})</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <span className="table-count">
          {sorted.length} of {nodes.length} resources
        </span>
      </div>

      <div className="table-container">
        <table className="resource-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort("name")} className="sortable">
                Name{sortIndicator("name")}
              </th>
              <th
                onClick={() => toggleSort("resourceType")}
                className="sortable"
              >
                Type{sortIndicator("resourceType")}
              </th>
              <th onClick={() => toggleSort("provider")} className="sortable">
                Provider{sortIndicator("provider")}
              </th>
              <th onClick={() => toggleSort("region")} className="sortable">
                Region{sortIndicator("region")}
              </th>
              <th onClick={() => toggleSort("status")} className="sortable">
                Status{sortIndicator("status")}
              </th>
              <th
                onClick={() => toggleSort("costMonthly")}
                className="sortable"
              >
                Cost/mo{sortIndicator("costMonthly")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((n) => (
              <tr
                key={n.id}
                className={`table-row ${selectedNodeId === n.id ? "selected" : ""}`}
                onClick={() => onSelectNode(n.id)}
              >
                <td>
                  <div className="cell-name">
                    <span
                      className="type-dot"
                      style={{
                        background:
                          RESOURCE_TYPE_COLORS[n.resourceType] || "#8b949e",
                      }}
                    />
                    <span className="name-text">{n.name}</span>
                  </div>
                </td>
                <td>
                  <span className="badge-type">{n.resourceType}</span>
                </td>
                <td>{n.provider}</td>
                <td>
                  <span className="badge-region">{n.region}</span>
                </td>
                <td>
                  <span
                    className={`badge-status ${n.status === "active" ? "status-active" : ""}`}
                  >
                    {n.status || "–"}
                  </span>
                </td>
                <td className="cell-cost">
                  ${(n.costMonthly || 0).toFixed(2)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  No resources match your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
