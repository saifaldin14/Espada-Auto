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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}: ${res.statusText}`);
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
  query: (iql: string) =>
    post<{ query: string; result: unknown }>("/v1/query", { query: iql }),
};
