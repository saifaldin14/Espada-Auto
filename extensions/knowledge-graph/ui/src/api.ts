import type {
  HealthResponse,
  TopologyResponse,
  CostResponse,
  DriftResponse,
  StatsResponse,
  ComplianceResult,
} from "./types";

const BASE = "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export const api = {
  health: () => get<HealthResponse>("/health"),
  topology: () => get<TopologyResponse>("/v1/graph/topology"),
  stats: () => get<StatsResponse>("/v1/graph/stats"),
  cost: () => get<CostResponse>("/v1/cost"),
  drift: () => get<DriftResponse>("/v1/drift"),
  compliance: (framework: string) =>
    get<ComplianceResult>(`/v1/compliance/${framework}`),
  exportGraph: (format: "json" | "dot" | "mermaid") =>
    get<unknown>(`/v1/export/${format}`),
};
