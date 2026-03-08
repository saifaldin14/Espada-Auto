import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { GraphNode, GraphEdge } from "../types";
import { api } from "../api";

/* ─── IQL Result Types ─────────────────────────────────────── */

interface IQLFindResult {
  type: "find";
  nodes: GraphNode[];
  totalCount: number;
  totalCost: number;
}

interface IQLSummarizeGroup {
  key: Record<string, string>;
  value: number;
}

interface IQLSummarizeResult {
  type: "summarize";
  groups: IQLSummarizeGroup[];
  total: number;
}

interface IQLDiffDetail {
  nodeId: string;
  name: string;
  change: "added" | "removed" | "changed";
  fields?: Record<string, { before: unknown; after: unknown }>;
}

interface IQLDiffResult {
  type: "diff";
  added: number;
  removed: number;
  changed: number;
  costDelta: number;
  details: IQLDiffDetail[];
}

interface IQLPathResult {
  type: "path";
  found: boolean;
  path: GraphNode[];
  hops: number;
  edges: GraphEdge[];
}

type IQLResult =
  | IQLFindResult
  | IQLSummarizeResult
  | IQLDiffResult
  | IQLPathResult;

interface QueryResponse {
  query: string;
  result: IQLResult;
}

interface HistoryEntry {
  query: string;
  timestamp: number;
  duration: number;
  success: boolean;
  resultType?: string;
  resultCount?: number;
  error?: string;
}

/* ─── IQL Keywords & Syntax ───────────────────────────────── */

const KEYWORDS = [
  "FIND",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "MATCHES",
  "OF",
  "FROM",
  "TO",
  "AT",
  "DIFF",
  "WITH",
  "NOW",
  "BY",
  "SUMMARIZE",
  "LIMIT",
  "PATH",
  "RESOURCES",
  "DOWNSTREAM",
  "UPSTREAM",
  "TRUE",
  "FALSE",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COUNT",
];

const FUNCTIONS = [
  "tagged",
  "drifted_since",
  "has_edge",
  "created_after",
  "created_before",
];

const FIELDS = [
  "provider",
  "resourceType",
  "region",
  "account",
  "status",
  "name",
  "owner",
  "cost",
  "costMonthly",
  "id",
  "nativeId",
  "depth",
  "tag.",
  "metadata.",
];

const OPERATORS = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "MATCHES"];

const SNIPPETS: { label: string; query: string; description: string }[] = [
  {
    label: "All resources",
    query: "FIND resources",
    description: "List all discovered resources",
  },
  {
    label: "Filter by provider",
    query: "FIND resources WHERE provider = 'aws'",
    description: "Find all AWS resources",
  },
  {
    label: "High cost",
    query: "FIND resources WHERE cost > $100/mo",
    description: "Resources costing over $100/month",
  },
  {
    label: "By region",
    query: "FIND resources WHERE region IN ('us-east-1', 'eu-west-1')",
    description: "Resources in specific regions",
  },
  {
    label: "Name search",
    query: "FIND resources WHERE name LIKE '%web%'",
    description: "Find resources matching a name pattern",
  },
  {
    label: "Regex match",
    query: "FIND resources WHERE name MATCHES 'prod-.*'",
    description: "Regex-based name matching",
  },
  {
    label: "By tag",
    query: "FIND resources WHERE tag.Environment = 'production'",
    description: "Filter by tag value",
  },
  {
    label: "Untagged",
    query: "FIND resources WHERE NOT tagged('Owner')",
    description: "Find untagged resources",
  },
  {
    label: "Drifted",
    query: "FIND resources WHERE drifted_since('2025-01-01')",
    description: "Resources that drifted after date",
  },
  {
    label: "Complex filter",
    query:
      "FIND resources WHERE provider = 'aws' AND cost > $100/mo AND NOT tagged('Environment')",
    description: "Combined conditions",
  },
  {
    label: "With limit",
    query: "FIND resources LIMIT 10",
    description: "Limit result count",
  },
  {
    label: "Downstream deps",
    query: "FIND downstream OF 'node-id'",
    description: "Downstream dependencies of a node",
  },
  {
    label: "Upstream deps",
    query: "FIND upstream OF 'node-id'",
    description: "Upstream dependencies of a node",
  },
  {
    label: "Shortest path",
    query: "FIND PATH FROM 'source-id' TO 'target-id'",
    description: "Find shortest path between nodes",
  },
  {
    label: "Time travel",
    query: "FIND resources AT '2025-01-01'",
    description: "Query at a point in time",
  },
  {
    label: "Diff with now",
    query: "FIND resources AT '2025-01-01' DIFF WITH NOW",
    description: "Compare past with present",
  },
  {
    label: "Cost by provider",
    query: "SUMMARIZE cost BY provider",
    description: "Aggregate costs per provider",
  },
  {
    label: "Count by type",
    query: "SUMMARIZE count BY resourceType",
    description: "Count resources per type",
  },
  {
    label: "Cost breakdown",
    query:
      "SUMMARIZE cost BY provider, resourceType WHERE region IN ('us-east-1')",
    description: "Filtered cost breakdown",
  },
  {
    label: "Avg cost",
    query: "SUMMARIZE AVG(cost) BY resourceType",
    description: "Average cost per resource type",
  },
];

/* ─── Syntax Highlighter ──────────────────────────────────── */

function highlightIQL(query: string): string {
  if (!query) return "";

  const keywordPat = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "gi");
  const funcPat = new RegExp(`\\b(${FUNCTIONS.join("|")})(?=\\s*\\()`, "gi");
  const stringPat = /(["'])(?:(?=(\\?))\2.)*?\1/g;
  const numberPat = /\b\d+(?:\.\d+)?\b/g;
  const costPat = /\$\d+(?:\.\d+)?(?:\/mo)?/g;
  const commentPat = /(?:#|--).*$/gm;
  const operatorPat = /(?:!=|>=|<=|[=><])/g;

  // Tokenize to avoid double-highlighting
  type Token = { start: number; end: number; cls: string; text: string };
  const tokens: Token[] = [];

  const collect = (pat: RegExp, cls: string) => {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(query)) !== null) {
      tokens.push({
        start: m.index,
        end: m.index + m[0].length,
        cls,
        text: m[0],
      });
    }
  };

  collect(commentPat, "iql-comment");
  collect(stringPat, "iql-string");
  collect(costPat, "iql-cost");
  collect(funcPat, "iql-function");
  collect(keywordPat, "iql-keyword");
  collect(numberPat, "iql-number");
  collect(operatorPat, "iql-operator");

  // Sort by start, remove overlaps (first-match wins for comments/strings)
  tokens.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Token[] = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start >= cursor) {
      kept.push(t);
      cursor = t.end;
    }
  }

  // Build highlighted HTML
  let result = "";
  let pos = 0;
  for (const t of kept) {
    if (t.start > pos) result += escapeHtml(query.slice(pos, t.start));
    result += `<span class="${t.cls}">${escapeHtml(t.text)}</span>`;
    pos = t.end;
  }
  if (pos < query.length) result += escapeHtml(query.slice(pos));
  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── Autocomplete Engine ─────────────────────────────────── */

interface Suggestion {
  label: string;
  kind: "keyword" | "function" | "field" | "operator" | "snippet";
  detail?: string;
  insertText: string;
}

function getAutocompleteSuggestions(
  query: string,
  cursorPos: number,
): Suggestion[] {
  const textBefore = query.slice(0, cursorPos);
  const wordMatch = textBefore.match(/[\w.$]*$/);
  const currentWord = wordMatch ? wordMatch[0].toUpperCase() : "";

  if (!currentWord || currentWord.length < 1) return [];

  const suggestions: Suggestion[] = [];

  // Keywords
  for (const kw of KEYWORDS) {
    if (kw.startsWith(currentWord) && kw !== currentWord) {
      suggestions.push({ label: kw, kind: "keyword", insertText: kw });
    }
  }

  // Functions
  for (const fn of FUNCTIONS) {
    if (fn.toUpperCase().startsWith(currentWord)) {
      suggestions.push({
        label: `${fn}()`,
        kind: "function",
        detail: "Built-in function",
        insertText: `${fn}()`,
      });
    }
  }

  // Fields
  for (const f of FIELDS) {
    if (f.toUpperCase().startsWith(currentWord)) {
      suggestions.push({
        label: f,
        kind: "field",
        detail: "Queryable field",
        insertText: f,
      });
    }
  }

  // Operators (after a field)
  const afterField =
    /\b(?:provider|resourceType|region|account|status|name|owner|cost|costMonthly|id|nativeId|depth)\s+$/i.test(
      textBefore,
    );
  if (afterField) {
    for (const op of OPERATORS) {
      suggestions.push({ label: op, kind: "operator", insertText: op + " " });
    }
  }

  return suggestions.slice(0, 12);
}

/* ─── Component Props ─────────────────────────────────────── */

interface Props {
  onSelectNodes?: (nodes: GraphNode[]) => void;
}

/* ─── Main Query Editor Component ─────────────────────────── */

export function QueryEditor({ onSelectNodes }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const stored = localStorage.getItem("iql-history");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [resultTab, setResultTab] = useState<"table" | "json" | "chart">(
    "table",
  );
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // Sync scroll between textarea and highlight overlay
  const syncScroll = useCallback(() => {
    if (editorRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = editorRef.current.scrollTop;
      highlightRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("iql-history", JSON.stringify(history.slice(0, 50)));
    } catch {
      /* quota exceeded */
    }
  }, [history]);

  // Execute query
  const executeQuery = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setExecuting(true);
    setError(null);
    setResult(null);
    setSuggestions([]);
    const startTime = performance.now();

    try {
      const raw = await api.query(q);
      const duration = Math.round(performance.now() - startTime);
      const resp = raw as QueryResponse;
      setResult(resp);

      const r = resp.result as unknown as Record<string, unknown>;
      let resultType = "unknown";
      let resultCount = 0;
      if ("nodes" in r) {
        resultType = "find";
        resultCount = (r.nodes as unknown[])?.length ?? 0;
      } else if ("groups" in r) {
        resultType = "summarize";
        resultCount = (r.groups as unknown[])?.length ?? 0;
      } else if ("details" in r) {
        resultType = "diff";
        resultCount = (r.details as unknown[])?.length ?? 0;
      } else if ("path" in r) {
        resultType = "path";
        resultCount = (r.path as unknown[])?.length ?? 0;
      }

      setHistory((prev) => [
        {
          query: q,
          timestamp: Date.now(),
          duration,
          success: true,
          resultType,
          resultCount,
        },
        ...prev,
      ]);

      // Notify parent of found nodes for graph highlighting
      if (onSelectNodes && "nodes" in r && r.nodes) {
        onSelectNodes(r.nodes as GraphNode[]);
      }
    } catch (err) {
      const duration = Math.round(performance.now() - startTime);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setHistory((prev) => [
        {
          query: q,
          timestamp: Date.now(),
          duration,
          success: false,
          error: msg,
        },
        ...prev,
      ]);
    } finally {
      setExecuting(false);
    }
  }, [query, onSelectNodes]);

  // Handle textarea input
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setQuery(val);
      const pos = e.target.selectionStart;
      const sugs = getAutocompleteSuggestions(val, pos);
      setSuggestions(sugs);
      setSelectedSuggestion(0);
    },
    [],
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd + Enter to execute
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        executeQuery();
        return;
      }

      // Autocomplete navigation
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            Math.min(prev + 1, suggestions.length - 1),
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          if (suggestions[selectedSuggestion]) {
            e.preventDefault();
            applySuggestion(suggestions[selectedSuggestion]);
            return;
          }
        }
        if (e.key === "Escape") {
          setSuggestions([]);
          return;
        }
      }

      // Tab key inserts 2 spaces
      if (e.key === "Tab" && suggestions.length === 0) {
        e.preventDefault();
        const ta = editorRef.current!;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        setQuery(val.substring(0, start) + "  " + val.substring(end));
        setTimeout(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        }, 0);
      }
    },
    [suggestions, selectedSuggestion, executeQuery],
  );

  // Apply autocomplete suggestion
  const applySuggestion = useCallback(
    (s: Suggestion) => {
      const ta = editorRef.current!;
      const pos = ta.selectionStart;
      const text = query;
      const wordMatch = text.slice(0, pos).match(/[\w.$]*$/);
      const wordStart = wordMatch ? pos - wordMatch[0].length : pos;
      const newQuery =
        text.slice(0, wordStart) + s.insertText + text.slice(pos);
      setQuery(newQuery);
      setSuggestions([]);
      setTimeout(() => {
        ta.focus();
        const newPos = wordStart + s.insertText.length;
        ta.selectionStart = ta.selectionEnd = newPos;
      }, 0);
    },
    [query],
  );

  // Load query from history or snippet
  const loadQuery = useCallback((q: string) => {
    setQuery(q);
    setShowHistory(false);
    setShowSnippets(false);
    setTimeout(() => editorRef.current?.focus(), 0);
  }, []);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem("iql-history");
  }, []);

  // Highlighted HTML
  const highlightedHtml = useMemo(() => highlightIQL(query), [query]);

  // Determine result type
  const resultType = result?.result
    ? "nodes" in result.result
      ? "find"
      : "groups" in result.result
        ? "summarize"
        : "details" in result.result
          ? "diff"
          : "path" in result.result
            ? "path"
            : "unknown"
    : null;

  return (
    <div className="query-editor">
      {/* ─── Toolbar ─── */}
      <div className="qe-toolbar">
        <div className="qe-toolbar-left">
          <span className="qe-label">IQL</span>
          <span className="qe-label-sub">Infrastructure Query Language</span>
        </div>
        <div className="qe-toolbar-right">
          <button
            className={`qe-toolbar-btn ${showSnippets ? "active" : ""}`}
            onClick={() => {
              setShowSnippets(!showSnippets);
              setShowHistory(false);
              setShowReference(false);
            }}
            title="Query snippets"
          >
            <span className="qe-btn-icon">✦</span> Snippets
          </button>
          <button
            className={`qe-toolbar-btn ${showHistory ? "active" : ""}`}
            onClick={() => {
              setShowHistory(!showHistory);
              setShowSnippets(false);
              setShowReference(false);
            }}
            title="Query history"
          >
            <span className="qe-btn-icon">⏱</span> History
            {history.length > 0 && (
              <span className="qe-badge">{history.length}</span>
            )}
          </button>
          <button
            className={`qe-toolbar-btn ${showReference ? "active" : ""}`}
            onClick={() => {
              setShowReference(!showReference);
              setShowSnippets(false);
              setShowHistory(false);
            }}
            title="IQL reference"
          >
            <span className="qe-btn-icon">📖</span> Reference
          </button>
        </div>
      </div>

      {/* ─── Snippets Panel ─── */}
      {showSnippets && (
        <div className="qe-panel">
          <div className="qe-panel-header">
            <span>Query Snippets</span>
            <button
              className="qe-panel-close"
              onClick={() => setShowSnippets(false)}
            >
              ✕
            </button>
          </div>
          <div className="qe-snippets-grid">
            {SNIPPETS.map((s, i) => (
              <button
                key={i}
                className="qe-snippet-card"
                onClick={() => loadQuery(s.query)}
              >
                <span className="qe-snippet-label">{s.label}</span>
                <span className="qe-snippet-desc">{s.description}</span>
                <code className="qe-snippet-code">{s.query}</code>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── History Panel ─── */}
      {showHistory && (
        <div className="qe-panel">
          <div className="qe-panel-header">
            <span>Query History</span>
            <div className="qe-panel-actions">
              {history.length > 0 && (
                <button className="qe-text-btn danger" onClick={clearHistory}>
                  Clear all
                </button>
              )}
              <button
                className="qe-panel-close"
                onClick={() => setShowHistory(false)}
              >
                ✕
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="qe-empty-state">No queries executed yet</div>
          ) : (
            <div className="qe-history-list">
              {history.map((h, i) => (
                <button
                  key={i}
                  className="qe-history-item"
                  onClick={() => loadQuery(h.query)}
                >
                  <div className="qe-history-top">
                    <span
                      className={`qe-history-status ${h.success ? "success" : "error"}`}
                    >
                      {h.success ? "✓" : "✕"}
                    </span>
                    <code className="qe-history-query">{h.query}</code>
                  </div>
                  <div className="qe-history-meta">
                    <span>{new Date(h.timestamp).toLocaleTimeString()}</span>
                    <span>{h.duration}ms</span>
                    {h.resultType && <span>{h.resultType}</span>}
                    {h.resultCount !== undefined && (
                      <span>{h.resultCount} results</span>
                    )}
                    {h.error && (
                      <span className="qe-history-error">{h.error}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Reference Panel ─── */}
      {showReference && (
        <div className="qe-panel qe-reference">
          <div className="qe-panel-header">
            <span>IQL Quick Reference</span>
            <button
              className="qe-panel-close"
              onClick={() => setShowReference(false)}
            >
              ✕
            </button>
          </div>
          <div className="qe-ref-content">
            <div className="qe-ref-section">
              <h4>Query Types</h4>
              <div className="qe-ref-grid">
                <div className="qe-ref-item">
                  <code>FIND resources</code>
                  <span>Discover resources with optional filters</span>
                </div>
                <div className="qe-ref-item">
                  <code>FIND downstream OF 'id'</code>
                  <span>Downstream dependency chain</span>
                </div>
                <div className="qe-ref-item">
                  <code>FIND upstream OF 'id'</code>
                  <span>Upstream dependency chain</span>
                </div>
                <div className="qe-ref-item">
                  <code>FIND PATH FROM 'a' TO 'b'</code>
                  <span>Shortest path between nodes</span>
                </div>
                <div className="qe-ref-item">
                  <code>SUMMARIZE metric BY field</code>
                  <span>Aggregate data by grouping</span>
                </div>
              </div>
            </div>

            <div className="qe-ref-section">
              <h4>Clauses</h4>
              <div className="qe-ref-grid">
                <div className="qe-ref-item">
                  <code>WHERE condition</code>
                  <span>Filter results</span>
                </div>
                <div className="qe-ref-item">
                  <code>AT 'timestamp'</code>
                  <span>Time-travel query</span>
                </div>
                <div className="qe-ref-item">
                  <code>DIFF WITH NOW</code>
                  <span>Compare with present</span>
                </div>
                <div className="qe-ref-item">
                  <code>LIMIT n</code>
                  <span>Cap result count</span>
                </div>
              </div>
            </div>

            <div className="qe-ref-section">
              <h4>Fields</h4>
              <div className="qe-ref-tags">
                {FIELDS.map((f) => (
                  <code key={f} className="qe-ref-tag">
                    {f}
                  </code>
                ))}
              </div>
            </div>

            <div className="qe-ref-section">
              <h4>Operators</h4>
              <div className="qe-ref-tags">
                {["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "MATCHES"].map(
                  (op) => (
                    <code key={op} className="qe-ref-tag">
                      {op}
                    </code>
                  ),
                )}
              </div>
            </div>

            <div className="qe-ref-section">
              <h4>Functions</h4>
              <div className="qe-ref-grid">
                <div className="qe-ref-item">
                  <code>tagged('key')</code>
                  <span>Has tag with key</span>
                </div>
                <div className="qe-ref-item">
                  <code>drifted_since('ts')</code>
                  <span>Drifted after timestamp</span>
                </div>
                <div className="qe-ref-item">
                  <code>has_edge('type')</code>
                  <span>Has edge of type</span>
                </div>
                <div className="qe-ref-item">
                  <code>created_after('ts')</code>
                  <span>Created after timestamp</span>
                </div>
                <div className="qe-ref-item">
                  <code>created_before('ts')</code>
                  <span>Created before timestamp</span>
                </div>
              </div>
            </div>

            <div className="qe-ref-section">
              <h4>Aggregates</h4>
              <div className="qe-ref-tags">
                {[
                  "COUNT",
                  "SUM(field)",
                  "AVG(field)",
                  "MIN(field)",
                  "MAX(field)",
                  "cost",
                  "count",
                ].map((a) => (
                  <code key={a} className="qe-ref-tag">
                    {a}
                  </code>
                ))}
              </div>
            </div>

            <div className="qe-ref-section">
              <h4>Special Syntax</h4>
              <div className="qe-ref-grid">
                <div className="qe-ref-item">
                  <code>$100/mo</code>
                  <span>Cost literal</span>
                </div>
                <div className="qe-ref-item">
                  <code># comment</code>
                  <span>Line comment</span>
                </div>
                <div className="qe-ref-item">
                  <code>-- comment</code>
                  <span>SQL-style comment</span>
                </div>
                <div className="qe-ref-item">
                  <code>tag.Environment</code>
                  <span>Tag field access</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Editor Area ─── */}
      <div className="qe-editor-container">
        <div className="qe-line-numbers">
          {(query || " ").split("\n").map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className="qe-editor-wrap">
          <pre
            ref={highlightRef}
            className="qe-highlight-layer"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightedHtml + "\n" }}
          />
          <textarea
            ref={editorRef}
            className="qe-textarea"
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            placeholder="Enter IQL query…  (⌘+Enter to execute)"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            rows={4}
          />

          {/* Autocomplete dropdown */}
          {suggestions.length > 0 && (
            <div className="qe-autocomplete">
              {suggestions.map((s, i) => (
                <button
                  key={s.label}
                  className={`qe-ac-item ${i === selectedSuggestion ? "selected" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(s);
                  }}
                  onMouseEnter={() => setSelectedSuggestion(i)}
                >
                  <span className={`qe-ac-kind ${s.kind}`}>
                    {s.kind === "keyword"
                      ? "K"
                      : s.kind === "function"
                        ? "ƒ"
                        : s.kind === "field"
                          ? "F"
                          : s.kind === "operator"
                            ? "O"
                            : "S"}
                  </span>
                  <span className="qe-ac-label">{s.label}</span>
                  {s.detail && <span className="qe-ac-detail">{s.detail}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Action Bar ─── */}
      <div className="qe-actions">
        <div className="qe-actions-left">
          <span className="qe-hint">⌘+Enter to execute</span>
          <span className="qe-hint">Tab to autocomplete</span>
        </div>
        <div className="qe-actions-right">
          <button
            className="qe-clear-btn"
            onClick={() => {
              setQuery("");
              setResult(null);
              setError(null);
              editorRef.current?.focus();
            }}
            disabled={!query && !result && !error}
          >
            Clear
          </button>
          <button
            className="qe-run-btn"
            onClick={executeQuery}
            disabled={executing || !query.trim()}
          >
            {executing ? (
              <>
                <span className="qe-spinner" />
                Executing…
              </>
            ) : (
              <>
                <span className="qe-run-icon">▶</span>
                Run Query
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── Error Display ─── */}
      {error && (
        <div className="qe-error">
          <div className="qe-error-header">
            <span className="qe-error-icon">✕</span>
            <span>Query Error</span>
          </div>
          <pre className="qe-error-body">{error}</pre>
        </div>
      )}

      {/* ─── Results Area ─── */}
      {result && (
        <div className="qe-results">
          <div className="qe-results-header">
            <div className="qe-results-info">
              <span className="qe-results-type">{resultType}</span>
              {resultType === "find" && (
                <span className="qe-results-count">
                  {(result.result as IQLFindResult).totalCount} resources
                  {(result.result as IQLFindResult).totalCost > 0 &&
                    ` · $${(result.result as IQLFindResult).totalCost.toFixed(2)}/mo`}
                </span>
              )}
              {resultType === "summarize" && (
                <span className="qe-results-count">
                  {(result.result as IQLSummarizeResult).groups.length} groups ·
                  total: {(result.result as IQLSummarizeResult).total}
                </span>
              )}
              {resultType === "diff" && (
                <span className="qe-results-count">
                  +{(result.result as IQLDiffResult).added}−
                  {(result.result as IQLDiffResult).removed}~
                  {(result.result as IQLDiffResult).changed}
                </span>
              )}
              {resultType === "path" && (
                <span className="qe-results-count">
                  {(result.result as IQLPathResult).found
                    ? `${(result.result as IQLPathResult).hops} hops`
                    : "No path found"}
                </span>
              )}
            </div>
            <div className="qe-results-tabs">
              <button
                className={`qe-results-tab ${resultTab === "table" ? "active" : ""}`}
                onClick={() => setResultTab("table")}
              >
                Table
              </button>
              <button
                className={`qe-results-tab ${resultTab === "chart" ? "active" : ""}`}
                onClick={() => setResultTab("chart")}
              >
                Chart
              </button>
              <button
                className={`qe-results-tab ${resultTab === "json" ? "active" : ""}`}
                onClick={() => setResultTab("json")}
              >
                JSON
              </button>
            </div>
          </div>

          {/* Table view */}
          {resultTab === "table" && (
            <div className="qe-results-body">
              {resultType === "find" && (
                <FindResultTable
                  result={result.result as IQLFindResult}
                  expandedRow={expandedRow}
                  onToggleRow={setExpandedRow}
                />
              )}
              {resultType === "summarize" && (
                <SummarizeResultTable
                  result={result.result as IQLSummarizeResult}
                />
              )}
              {resultType === "diff" && (
                <DiffResultTable result={result.result as IQLDiffResult} />
              )}
              {resultType === "path" && (
                <PathResultView result={result.result as IQLPathResult} />
              )}
            </div>
          )}

          {/* Chart view */}
          {resultTab === "chart" && (
            <div className="qe-results-body">
              {resultType === "find" && (
                <FindResultChart result={result.result as IQLFindResult} />
              )}
              {resultType === "summarize" && (
                <SummarizeResultChart
                  result={result.result as IQLSummarizeResult}
                />
              )}
              {resultType === "diff" && (
                <DiffResultChart result={result.result as IQLDiffResult} />
              )}
              {resultType === "path" && (
                <PathResultView result={result.result as IQLPathResult} />
              )}
            </div>
          )}

          {/* JSON view */}
          {resultTab === "json" && (
            <div className="qe-results-body">
              <pre className="qe-json">
                {JSON.stringify(result.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Result Sub-Components ───────────────────────────────── */

function FindResultTable({
  result,
  expandedRow,
  onToggleRow,
}: {
  result: IQLFindResult;
  expandedRow: string | null;
  onToggleRow: (id: string | null) => void;
}) {
  if (!result.nodes || result.nodes.length === 0) {
    return <div className="qe-empty-state">No resources matched the query</div>;
  }

  return (
    <div className="qe-table-wrap">
      <table className="qe-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Provider</th>
            <th>Region</th>
            <th>Status</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {result.nodes.map((n) => (
            <>
              <tr
                key={n.id}
                className={`qe-table-row ${expandedRow === n.id ? "expanded" : ""}`}
                onClick={() => onToggleRow(expandedRow === n.id ? null : n.id)}
              >
                <td className="qe-cell-name">
                  <span className="qe-expand-icon">
                    {expandedRow === n.id ? "▾" : "▸"}
                  </span>
                  {n.name}
                </td>
                <td>
                  <span className="qe-type-badge">{n.resourceType}</span>
                </td>
                <td>
                  <span className="qe-provider-badge">{n.provider}</span>
                </td>
                <td>{n.region}</td>
                <td>
                  <span className={`qe-status ${n.status}`}>{n.status}</span>
                </td>
                <td className="qe-cell-cost">
                  {n.costMonthly > 0 ? `$${n.costMonthly.toFixed(2)}` : "—"}
                </td>
              </tr>
              {expandedRow === n.id && (
                <tr key={`${n.id}-detail`} className="qe-detail-row">
                  <td colSpan={6}>
                    <div className="qe-detail-grid">
                      <div className="qe-detail-field">
                        <span className="qe-detail-label">ID</span>
                        <code>{n.id}</code>
                      </div>
                      <div className="qe-detail-field">
                        <span className="qe-detail-label">Native ID</span>
                        <code>{n.nativeId}</code>
                      </div>
                      <div className="qe-detail-field">
                        <span className="qe-detail-label">Account</span>
                        <code>{n.account}</code>
                      </div>
                      <div className="qe-detail-field">
                        <span className="qe-detail-label">Created</span>
                        <span>{n.createdAt}</span>
                      </div>
                      <div className="qe-detail-field">
                        <span className="qe-detail-label">Last Seen</span>
                        <span>{n.lastSeenAt}</span>
                      </div>
                      {Object.keys(n.tags || {}).length > 0 && (
                        <div className="qe-detail-field qe-detail-wide">
                          <span className="qe-detail-label">Tags</span>
                          <div className="qe-tag-list">
                            {Object.entries(n.tags).map(([k, v]) => (
                              <span key={k} className="qe-tag">
                                {k}={v}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {Object.keys(n.metadata || {}).length > 0 && (
                        <div className="qe-detail-field qe-detail-wide">
                          <span className="qe-detail-label">Metadata</span>
                          <pre className="qe-metadata-json">
                            {JSON.stringify(n.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummarizeResultTable({ result }: { result: IQLSummarizeResult }) {
  if (!result.groups || result.groups.length === 0) {
    return <div className="qe-empty-state">No groups in result</div>;
  }

  const keys = Object.keys(result.groups[0].key);

  return (
    <div className="qe-table-wrap">
      <table className="qe-table">
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k}>{k}</th>
            ))}
            <th>Value</th>
            <th>% of Total</th>
          </tr>
        </thead>
        <tbody>
          {result.groups.map((g, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k}>{g.key[k]}</td>
              ))}
              <td className="qe-cell-value">
                {typeof g.value === "number"
                  ? g.value.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })
                  : g.value}
              </td>
              <td>
                <div className="qe-bar-cell">
                  <div
                    className="qe-bar-fill"
                    style={{
                      width: `${result.total > 0 ? (g.value / result.total) * 100 : 0}%`,
                    }}
                  />
                  <span>
                    {result.total > 0
                      ? ((g.value / result.total) * 100).toFixed(1)
                      : 0}
                    %
                  </span>
                </div>
              </td>
            </tr>
          ))}
          <tr className="qe-total-row">
            <td colSpan={keys.length}>
              <strong>Total</strong>
            </td>
            <td className="qe-cell-value">
              <strong>
                {result.total.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </strong>
            </td>
            <td>100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DiffResultTable({ result }: { result: IQLDiffResult }) {
  if (!result.details || result.details.length === 0) {
    return <div className="qe-empty-state">No differences found</div>;
  }

  return (
    <div className="qe-table-wrap">
      <div className="qe-diff-summary">
        <span className="qe-diff-added">+{result.added} added</span>
        <span className="qe-diff-removed">−{result.removed} removed</span>
        <span className="qe-diff-changed">~{result.changed} changed</span>
        {result.costDelta !== 0 && (
          <span
            className={`qe-diff-cost ${result.costDelta > 0 ? "up" : "down"}`}
          >
            {result.costDelta > 0 ? "+" : ""}
            {result.costDelta.toFixed(2)}/mo
          </span>
        )}
      </div>
      <table className="qe-table">
        <thead>
          <tr>
            <th>Change</th>
            <th>Node</th>
            <th>Name</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {result.details.map((d, i) => (
            <tr key={i} className={`qe-diff-row qe-diff-${d.change}`}>
              <td>
                <span className={`qe-diff-badge ${d.change}`}>{d.change}</span>
              </td>
              <td>
                <code>{d.nodeId}</code>
              </td>
              <td>{d.name}</td>
              <td>
                {d.fields &&
                  Object.entries(d.fields).map(([k, v]) => (
                    <div key={k} className="qe-diff-field">
                      <span className="qe-diff-field-name">{k}:</span>
                      <span className="qe-diff-before">{String(v.before)}</span>
                      <span className="qe-diff-arrow">→</span>
                      <span className="qe-diff-after">{String(v.after)}</span>
                    </div>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PathResultView({ result }: { result: IQLPathResult }) {
  if (!result.found) {
    return (
      <div className="qe-empty-state">
        No path found between the specified nodes
      </div>
    );
  }

  return (
    <div className="qe-path-view">
      <div className="qe-path-info">
        <span className="qe-path-hops">{result.hops} hops</span>
        <span className="qe-path-nodes">{result.path.length} nodes</span>
      </div>
      <div className="qe-path-chain">
        {result.path.map((node, i) => (
          <div key={node.id} className="qe-path-step">
            <div className="qe-path-node">
              <span className="qe-path-node-type">{node.resourceType}</span>
              <span className="qe-path-node-name">{node.name}</span>
              <span className="qe-path-node-provider">{node.provider}</span>
            </div>
            {i < result.path.length - 1 && (
              <div className="qe-path-edge">
                <span className="qe-path-arrow">→</span>
                {result.edges[i] && (
                  <span className="qe-path-edge-type">
                    {result.edges[i].relationshipType}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Chart Sub-Components ────────────────────────────────── */

function FindResultChart({ result }: { result: IQLFindResult }) {
  const byType: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  for (const n of result.nodes || []) {
    byType[n.resourceType] = (byType[n.resourceType] || 0) + 1;
    byProvider[n.provider] = (byProvider[n.provider] || 0) + 1;
  }

  return (
    <div className="qe-chart-grid">
      <div className="qe-chart-box">
        <h4>By Resource Type</h4>
        <HorizontalBarChart data={byType} />
      </div>
      <div className="qe-chart-box">
        <h4>By Provider</h4>
        <HorizontalBarChart data={byProvider} />
      </div>
    </div>
  );
}

function SummarizeResultChart({ result }: { result: IQLSummarizeResult }) {
  const data: Record<string, number> = {};
  for (const g of result.groups || []) {
    const label = Object.values(g.key).join(" / ");
    data[label] = g.value;
  }

  return (
    <div className="qe-chart-grid">
      <div className="qe-chart-box qe-chart-full">
        <h4>Aggregation Results</h4>
        <HorizontalBarChart data={data} showValues />
      </div>
    </div>
  );
}

function DiffResultChart({ result }: { result: IQLDiffResult }) {
  const data: Record<string, number> = {
    Added: result.added,
    Removed: result.removed,
    Changed: result.changed,
  };

  return (
    <div className="qe-chart-grid">
      <div className="qe-chart-box qe-chart-full">
        <h4>Changes Summary</h4>
        <HorizontalBarChart
          data={data}
          colorMap={{
            Added: "#3fb950",
            Removed: "#f85149",
            Changed: "#d29922",
          }}
          showValues
        />
      </div>
    </div>
  );
}

function HorizontalBarChart({
  data,
  colorMap,
  showValues,
}: {
  data: Record<string, number>;
  colorMap?: Record<string, string>;
  showValues?: boolean;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => v), 1);
  const colors = [
    "#58a6ff",
    "#3fb950",
    "#d29922",
    "#bc8cff",
    "#f85149",
    "#f778ba",
    "#79c0ff",
    "#ffa657",
  ];

  return (
    <div className="qe-hbar-chart">
      {entries.map(([label, value], i) => (
        <div key={label} className="qe-hbar-row">
          <span className="qe-hbar-label">{label}</span>
          <div className="qe-hbar-track">
            <div
              className="qe-hbar-fill"
              style={{
                width: `${(value / max) * 100}%`,
                background: colorMap?.[label] || colors[i % colors.length],
              }}
            />
          </div>
          <span className="qe-hbar-value">
            {showValues
              ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : value}
          </span>
        </div>
      ))}
    </div>
  );
}
