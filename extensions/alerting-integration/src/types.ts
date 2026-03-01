// ─── Alerting Integration Types ────────────────────────────────────────
//
// Normalised alert model that unifies PagerDuty, OpsGenie and CloudWatch
// Alarms into a single shape, plus routing rules and dispatch records.
// ───────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*  Alert source providers                                             */
/* ------------------------------------------------------------------ */

/** Supported external alerting providers. */
export type AlertProvider = "pagerduty" | "opsgenie" | "cloudwatch";

/** Alert severity — normalised across all providers. */
export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

/** Alert status — normalised lifecycle of an alert. */
export type AlertStatus =
  | "triggered"
  | "acknowledged"
  | "resolved"
  | "suppressed";

/* ------------------------------------------------------------------ */
/*  Normalised alert                                                    */
/* ------------------------------------------------------------------ */

/**
 * Provider-agnostic representation of an alert event.
 * Every webhook parser converts its native payload into this shape.
 */
export type NormalisedAlert = {
  /** Globally unique ID generated on ingest. */
  id: string;
  /** ID from the originating provider (incident ID / alarm name). */
  externalId: string;
  /** Which provider this came from. */
  provider: AlertProvider;
  /** Normalised severity. */
  severity: AlertSeverity;
  /** Normalised status. */
  status: AlertStatus;
  /** Human-readable one-liner. */
  title: string;
  /** Longer description / body. */
  description: string;
  /** Affected service / resource / component name. */
  service: string;
  /** Environment hint (production, staging, etc.). */
  environment: string;
  /** ISO-8601 timestamp the alert was raised at the source. */
  raisedAt: string;
  /** ISO-8601 timestamp we received the webhook. */
  receivedAt: string;
  /** Source URL of the alert in the provider's dashboard. */
  sourceUrl: string;
  /** Arbitrary key-value details from the raw payload. */
  details: Record<string, unknown>;
  /** Raw webhook payload for audit / debug. */
  rawPayload: unknown;
  /** Optional tags / labels carried from the provider. */
  tags: string[];
};

/* ------------------------------------------------------------------ */
/*  Routing rules                                                       */
/* ------------------------------------------------------------------ */

/** Condition operators for matching alerts to routes. */
export type MatchOperator = "equals" | "contains" | "regex" | "any";

/** A single match condition evaluated against a normalised alert field. */
export type MatchCondition = {
  /** Field of NormalisedAlert to test. */
  field: keyof NormalisedAlert;
  /** Comparison operator. */
  operator: MatchOperator;
  /** Value to compare against (ignored for "any"). */
  value: string;
};

/**
 * A routing rule that maps alerts matching a set of conditions to one
 * or more dispatch channels.
 */
export type RoutingRule = {
  /** Unique rule ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Rule priority — lower numbers evaluate first. */
  priority: number;
  /** If true this rule is active. */
  enabled: boolean;
  /** ALL conditions must match (AND logic). */
  conditions: MatchCondition[];
  /** Channel targets to dispatch to (IDs in DispatchChannel). */
  channelIds: string[];
  /** Optional message template (supports {{field}} placeholders). */
  template?: string;
  /** Whether to stop evaluating further rules on match. */
  stopOnMatch: boolean;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Dispatch channels & records                                         */
/* ------------------------------------------------------------------ */

/**
 * A registered dispatch target — an Espada messaging channel that will
 * receive alert notifications.
 */
export type DispatchChannel = {
  /** Unique channel ID for routing references. */
  id: string;
  /** Human-readable label (e.g. "#ops-critical"). */
  name: string;
  /** Channel type — matches Espada channel names. */
  type: DispatchChannelType;
  /** Channel-specific config (e.g. webhook URL, chat ID, room). */
  config: Record<string, unknown>;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
};

export type DispatchChannelType =
  | "slack"
  | "discord"
  | "msteams"
  | "telegram"
  | "matrix"
  | "webhook"
  | "custom";

/** Outcome of a single dispatch attempt. */
export type DispatchStatus = "pending" | "sent" | "failed" | "suppressed";

/**
 * Record of a single dispatch of an alert to a channel.
 */
export type DispatchRecord = {
  /** Unique dispatch ID. */
  id: string;
  /** NormalisedAlert.id reference. */
  alertId: string;
  /** DispatchChannel.id reference. */
  channelId: string;
  /** RoutingRule.id that triggered this dispatch (or "manual"). */
  ruleId: string;
  /** Result of the dispatch attempt. */
  status: DispatchStatus;
  /** Formatted message that was (or would be) sent. */
  message: string;
  /** ISO-8601 timestamp. */
  dispatchedAt: string;
  /** Error message if status is "failed". */
  error?: string;
};

/* ------------------------------------------------------------------ */
/*  Webhook ingest input                                                */
/* ------------------------------------------------------------------ */

/** Raw ingest payload passed to the webhook receiver. */
export type WebhookIngestInput = {
  /** Provider hint (auto-detected if omitted). */
  provider?: AlertProvider;
  /** Raw JSON body from the webhook. */
  body: unknown;
  /** HTTP headers (useful for signature validation). */
  headers?: Record<string, string>;
};

/* ------------------------------------------------------------------ */
/*  Dashboard / stats                                                   */
/* ------------------------------------------------------------------ */

/** Alert statistics for the dashboard. */
export type AlertDashboard = {
  totalAlerts: number;
  byProvider: Record<AlertProvider, number>;
  bySeverity: Record<AlertSeverity, number>;
  byStatus: Record<AlertStatus, number>;
  totalDispatches: number;
  dispatchSuccessRate: number;
  recentAlerts: NormalisedAlert[];
  activeRoutes: number;
  registeredChannels: number;
};

/* ------------------------------------------------------------------ */
/*  Filter                                                              */
/* ------------------------------------------------------------------ */

/** Filtering criteria for alert queries. */
export type AlertFilter = {
  provider?: AlertProvider;
  severity?: AlertSeverity;
  status?: AlertStatus;
  service?: string;
  since?: string;
};
