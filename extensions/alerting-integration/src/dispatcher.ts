// ─── Channel Dispatcher ────────────────────────────────────────────────
//
// Formats normalised alerts into human-readable messages and dispatches
// them to registered messaging channels.
// ───────────────────────────────────────────────────────────────────────

import type {
  NormalisedAlert,
  AlertSeverity,
  DispatchChannel,
  DispatchRecord,
  DispatchStatus,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  ID generator                                                        */
/* ------------------------------------------------------------------ */

import { randomUUID } from "node:crypto";

function generateDispatchId(): string {
  return `dispatch-${randomUUID()}`;
}

/** @deprecated No-op — IDs now use crypto.randomUUID(). Kept for test compat. */
export function resetDispatchCounter(): void {
  /* no-op */
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Severity helpers                                                    */
/* ------------------------------------------------------------------ */

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
  info: "ℹ️",
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

/* ------------------------------------------------------------------ */
/*  Message formatting                                                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve `{{field}}` placeholders in a template string using alert data.
 */
export function resolveTemplate(
  template: string,
  alert: NormalisedAlert,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in alert) {
      const val = alert[key as keyof NormalisedAlert];
      if (val == null) return "";
      if (typeof val === "string") return val;
      return JSON.stringify(val);
    }
    return `{{${key}}}`;
  });
}

/**
 * Build the default human-readable alert message.
 */
export function formatAlertMessage(alert: NormalisedAlert): string {
  const emoji = SEVERITY_EMOJI[alert.severity];
  const severity = SEVERITY_LABEL[alert.severity];
  const statusLabel = alert.status.toUpperCase();

  const lines: string[] = [
    `${emoji} **[${severity}] ${alert.title}** — ${statusLabel}`,
    "",
    `**Provider:** ${alert.provider} | **Service:** ${alert.service}`,
    `**Environment:** ${alert.environment}`,
  ];

  if (alert.description) {
    lines.push(`**Description:** ${alert.description}`);
  }

  if (alert.sourceUrl) {
    lines.push(`**Link:** ${alert.sourceUrl}`);
  }

  if (alert.tags.length > 0) {
    lines.push(`**Tags:** ${alert.tags.join(", ")}`);
  }

  lines.push(`**Raised:** ${alert.raisedAt}`);
  lines.push(`**Alert ID:** ${alert.id} (ext: ${alert.externalId})`);

  return lines.join("\n");
}

/**
 * Build the message for a given alert, optionally using a custom template.
 */
export function buildMessage(
  alert: NormalisedAlert,
  template?: string,
): string {
  if (template) {
    return resolveTemplate(template, alert);
  }
  return formatAlertMessage(alert);
}

/* ------------------------------------------------------------------ */
/*  Dispatch executor                                                   */
/* ------------------------------------------------------------------ */

/**
 * Callback invoked to actually deliver the message to a channel.
 * Return success/error so DispatchRecord can track the outcome.
 */
export type ChannelSender = (
  channel: DispatchChannel,
  message: string,
) => Promise<{ success: boolean; error?: string }>;

/**
 * Default sender — always succeeds (used for dry-run / simulation).
 */
export const defaultSender: ChannelSender = async () => ({ success: true });

/**
 * Dispatch a single alert to a single channel.
 */
export async function dispatchToChannel(
  alert: NormalisedAlert,
  channel: DispatchChannel,
  ruleId: string,
  sender: ChannelSender,
  template?: string,
): Promise<DispatchRecord> {
  const message = buildMessage(alert, template);
  const id = generateDispatchId();

  try {
    const result = await sender(channel, message);
    const status: DispatchStatus = result.success ? "sent" : "failed";
    return {
      id,
      alertId: alert.id,
      channelId: channel.id,
      ruleId,
      status,
      message,
      dispatchedAt: now(),
      error: result.error,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      id,
      alertId: alert.id,
      channelId: channel.id,
      ruleId,
      status: "failed",
      message,
      dispatchedAt: now(),
      error: errorMsg,
    };
  }
}

/**
 * Dispatch an alert to multiple channels in parallel.
 */
export async function dispatchToChannels(
  alert: NormalisedAlert,
  channels: DispatchChannel[],
  ruleId: string,
  sender: ChannelSender,
  template?: string,
): Promise<DispatchRecord[]> {
  const results = await Promise.all(
    channels.map((ch) => dispatchToChannel(alert, ch, ruleId, sender, template)),
  );
  return results;
}
