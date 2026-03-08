import { useState } from "react";
import type { ComplianceResult } from "../types";
import { api } from "../api";

const FRAMEWORKS = [
  { id: "cis-aws", label: "CIS AWS Foundations", icon: "🏛" },
  { id: "soc2", label: "SOC 2", icon: "📋" },
  { id: "hipaa", label: "HIPAA", icon: "🏥" },
  { id: "pci-dss", label: "PCI DSS", icon: "💳" },
  { id: "nist-800-53", label: "NIST 800-53", icon: "🔒" },
  { id: "gdpr", label: "GDPR", icon: "🇪🇺" },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#f85149",
  high: "#d29922",
  medium: "#ffa657",
  low: "#58a6ff",
  info: "#8b949e",
};

export function CompliancePanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAssessment = async (framework: string) => {
    setSelected(framework);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.compliance(framework);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="compliance-panel">
      <div className="compliance-frameworks">
        <h3 className="section-title">Select a Compliance Framework</h3>
        <div className="framework-grid">
          {FRAMEWORKS.map((f) => (
            <button
              key={f.id}
              className={`framework-card ${selected === f.id ? "active" : ""}`}
              onClick={() => runAssessment(f.id)}
            >
              <span className="framework-icon">{f.icon}</span>
              <span className="framework-label">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="panel-loading">
          <div className="spinner" /> Running {selected} assessment…
        </div>
      )}

      {error && (
        <div className="panel-error">
          <span className="error-icon">✕</span> {error}
        </div>
      )}

      {result && (
        <div className="compliance-results">
          <div className="compliance-summary-cards">
            <div className="comp-card comp-total">
              <div className="comp-card-value">{result.totalControls}</div>
              <div className="comp-card-label">Total Controls</div>
            </div>
            <div className="comp-card comp-pass">
              <div className="comp-card-value">{result.passed}</div>
              <div className="comp-card-label">Passed</div>
            </div>
            <div className="comp-card comp-fail">
              <div className="comp-card-value">{result.failed}</div>
              <div className="comp-card-label">Failed</div>
            </div>
            <div className="comp-card comp-skip">
              <div className="comp-card-value">{result.skipped}</div>
              <div className="comp-card-label">Skipped</div>
            </div>
          </div>

          {/* Score bar */}
          <div className="compliance-score">
            <div className="score-bar">
              <div
                className="score-fill pass"
                style={{
                  width: `${(result.passed / Math.max(result.totalControls, 1)) * 100}%`,
                }}
              />
              <div
                className="score-fill fail"
                style={{
                  width: `${(result.failed / Math.max(result.totalControls, 1)) * 100}%`,
                }}
              />
            </div>
            <span className="score-text">
              {(
                (result.passed / Math.max(result.totalControls, 1)) *
                100
              ).toFixed(0)}
              % pass rate
            </span>
          </div>

          {/* Findings */}
          {result.findings && result.findings.length > 0 && (
            <div className="findings-section">
              <h3 className="section-title">
                Findings ({result.findings.length})
              </h3>
              <div className="findings-list">
                {result.findings.map((f, i) => (
                  <div
                    key={`${f.controlId}-${i}`}
                    className={`finding-card finding-${f.status}`}
                  >
                    <div className="finding-header">
                      <span
                        className="finding-severity"
                        style={{
                          background: SEVERITY_COLORS[f.severity] || "#8b949e",
                        }}
                      >
                        {f.severity}
                      </span>
                      <span className={`finding-status status-${f.status}`}>
                        {f.status === "pass"
                          ? "✓"
                          : f.status === "fail"
                            ? "✕"
                            : "–"}{" "}
                        {f.status}
                      </span>
                      <code className="finding-id">{f.controlId}</code>
                    </div>
                    <div className="finding-title">{f.title}</div>
                    <div className="finding-message">{f.message}</div>
                    {f.resourceIds?.length > 0 && (
                      <div className="finding-resources">
                        {f.resourceIds.length} resource
                        {f.resourceIds.length > 1 ? "s" : ""} affected
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
