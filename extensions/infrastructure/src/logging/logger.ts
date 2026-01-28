/**
 * Infrastructure Logging Subsystem
 *
 * This module provides infrastructure-specific logging capabilities
 * with support for structured logging, log levels, and multiple destinations.
 */

import type { LoggingConfig, LogDestination } from "../types.js";

// =============================================================================
// Logger Types
// =============================================================================

/**
 * Log levels for infrastructure logging
 */
export type InfrastructureLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Log entry structure
 */
export type InfrastructureLogEntry = {
  timestamp: Date;
  level: InfrastructureLogLevel;
  subsystem: string;
  message: string;
  metadata?: Record<string, unknown>;
  providerId?: string;
  sessionId?: string;
  commandId?: string;
  resourceId?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

/**
 * Log formatter function type
 */
export type LogFormatter = (entry: InfrastructureLogEntry) => string;

/**
 * Log transport interface
 */
export interface LogTransport {
  name: string;
  write(entry: InfrastructureLogEntry): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

// =============================================================================
// Infrastructure Logger Interface
// =============================================================================

/**
 * Infrastructure logger interface
 */
export interface InfrastructureLogger {
  readonly subsystem: string;

  trace(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal(message: string, meta?: Record<string, unknown>): void;

  child(name: string): InfrastructureLogger;
  withContext(context: LogContext): InfrastructureLogger;
  setLevel(level: InfrastructureLogLevel): void;
  getLevel(): InfrastructureLogLevel;
  isLevelEnabled(level: InfrastructureLogLevel): boolean;
}

/**
 * Log context for contextual logging
 */
export type LogContext = {
  providerId?: string;
  sessionId?: string;
  commandId?: string;
  resourceId?: string;
  [key: string]: unknown;
};

// =============================================================================
// Log Level Utilities
// =============================================================================

const LOG_LEVEL_PRIORITY: Record<InfrastructureLogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * Compare log levels
 */
export function compareLogLevels(
  a: InfrastructureLogLevel,
  b: InfrastructureLogLevel,
): -1 | 0 | 1 {
  const pa = LOG_LEVEL_PRIORITY[a];
  const pb = LOG_LEVEL_PRIORITY[b];
  if (pa < pb) return -1;
  if (pa > pb) return 1;
  return 0;
}

/**
 * Check if a level should be logged given a minimum level
 */
export function shouldLog(level: InfrastructureLogLevel, minLevel: InfrastructureLogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}

// =============================================================================
// Default Log Formatter
// =============================================================================

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

const LEVEL_COLORS: Record<InfrastructureLogLevel, string> = {
  trace: COLORS.dim,
  debug: COLORS.cyan,
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
  fatal: COLORS.magenta,
};

/**
 * Default log formatter with color support
 */
export function createDefaultFormatter(options?: {
  colors?: boolean;
  timestamps?: boolean;
  includeMetadata?: boolean;
}): LogFormatter {
  const {
    colors = process.stdout.isTTY ?? false,
    timestamps = true,
    includeMetadata = true,
  } = options ?? {};

  return (entry: InfrastructureLogEntry): string => {
    const parts: string[] = [];

    // Timestamp
    if (timestamps) {
      const ts = entry.timestamp.toISOString();
      parts.push(colors ? `${COLORS.dim}${ts}${COLORS.reset}` : ts);
    }

    // Level
    const levelStr = entry.level.toUpperCase().padEnd(5);
    if (colors) {
      parts.push(`${LEVEL_COLORS[entry.level]}${levelStr}${COLORS.reset}`);
    } else {
      parts.push(levelStr);
    }

    // Subsystem
    if (colors) {
      parts.push(`${COLORS.blue}[${entry.subsystem}]${COLORS.reset}`);
    } else {
      parts.push(`[${entry.subsystem}]`);
    }

    // Message
    parts.push(entry.message);

    // Context (provider, session, etc.)
    const contextParts: string[] = [];
    if (entry.providerId) contextParts.push(`provider=${entry.providerId}`);
    if (entry.sessionId) contextParts.push(`session=${entry.sessionId}`);
    if (entry.commandId) contextParts.push(`command=${entry.commandId}`);
    if (entry.resourceId) contextParts.push(`resource=${entry.resourceId}`);
    if (entry.duration !== undefined) contextParts.push(`duration=${entry.duration}ms`);

    if (contextParts.length > 0) {
      const ctx = contextParts.join(" ");
      parts.push(colors ? `${COLORS.dim}(${ctx})${COLORS.reset}` : `(${ctx})`);
    }

    // Metadata
    if (includeMetadata && entry.metadata && Object.keys(entry.metadata).length > 0) {
      const metaStr = JSON.stringify(entry.metadata);
      parts.push(colors ? `${COLORS.dim}${metaStr}${COLORS.reset}` : metaStr);
    }

    // Error
    if (entry.error) {
      parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
      if (entry.error.stack) {
        parts.push(`\n${entry.error.stack}`);
      }
    }

    return parts.join(" ");
  };
}

// =============================================================================
// Console Transport
// =============================================================================

/**
 * Console log transport
 */
export class ConsoleTransport implements LogTransport {
  name = "console";
  private formatter: LogFormatter;
  private minLevel: InfrastructureLogLevel;

  constructor(options?: { formatter?: LogFormatter; minLevel?: InfrastructureLogLevel }) {
    this.formatter = options?.formatter ?? createDefaultFormatter();
    this.minLevel = options?.minLevel ?? "info";
  }

  write(entry: InfrastructureLogEntry): void {
    if (!shouldLog(entry.level, this.minLevel)) return;

    const formatted = this.formatter(entry);
    if (entry.level === "error" || entry.level === "fatal") {
      console.error(formatted);
    } else if (entry.level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }
}

// =============================================================================
// File Transport
// =============================================================================

/**
 * File log transport (Node.js environment)
 */
export class FileTransport implements LogTransport {
  name = "file";
  private formatter: LogFormatter;
  private minLevel: InfrastructureLogLevel;
  private buffer: string[] = [];
  private bufferSize: number;
  private filePath: string;
  private writeStream: { write: (s: string) => void; end: () => void } | null = null;

  constructor(options: {
    filePath: string;
    formatter?: LogFormatter;
    minLevel?: InfrastructureLogLevel;
    bufferSize?: number;
  }) {
    this.filePath = options.filePath;
    this.formatter =
      options.formatter ??
      createDefaultFormatter({
        colors: false,
        timestamps: true,
        includeMetadata: true,
      });
    this.minLevel = options.minLevel ?? "info";
    this.bufferSize = options.bufferSize ?? 100;
  }

  async initialize(): Promise<void> {
    // Dynamic import for Node.js fs module
    const fs = await import("node:fs");
    this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  write(entry: InfrastructureLogEntry): void {
    if (!shouldLog(entry.level, this.minLevel)) return;

    const formatted = this.formatter(entry);
    this.buffer.push(formatted);

    if (this.buffer.length >= this.bufferSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (!this.writeStream) await this.initialize();

    const content = this.buffer.join("\n") + "\n";
    this.buffer = [];
    this.writeStream!.write(content);
  }

  async close(): Promise<void> {
    await this.flush();
    this.writeStream?.end();
    this.writeStream = null;
  }
}

// =============================================================================
// Infrastructure Logger Implementation
// =============================================================================

/**
 * Infrastructure logger implementation
 */
export class InfrastructureLoggerImpl implements InfrastructureLogger {
  readonly subsystem: string;
  private level: InfrastructureLogLevel;
  private transports: LogTransport[];
  private context: LogContext;
  private redactPatterns: RegExp[];

  constructor(options: {
    subsystem: string;
    level?: InfrastructureLogLevel;
    transports?: LogTransport[];
    context?: LogContext;
    redactPatterns?: string[];
  }) {
    this.subsystem = options.subsystem;
    this.level = options.level ?? "info";
    this.transports = options.transports ?? [new ConsoleTransport()];
    this.context = options.context ?? {};
    this.redactPatterns = (options.redactPatterns ?? []).map((p) => new RegExp(p, "gi"));
  }

  trace(message: string, meta?: Record<string, unknown>): void {
    this.log("trace", message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.log("fatal", message, meta);
  }

  child(name: string): InfrastructureLogger {
    return new InfrastructureLoggerImpl({
      subsystem: `${this.subsystem}/${name}`,
      level: this.level,
      transports: this.transports,
      context: this.context,
      redactPatterns: this.redactPatterns.map((r) => r.source),
    });
  }

  withContext(context: LogContext): InfrastructureLogger {
    return new InfrastructureLoggerImpl({
      subsystem: this.subsystem,
      level: this.level,
      transports: this.transports,
      context: { ...this.context, ...context },
      redactPatterns: this.redactPatterns.map((r) => r.source),
    });
  }

  setLevel(level: InfrastructureLogLevel): void {
    this.level = level;
  }

  getLevel(): InfrastructureLogLevel {
    return this.level;
  }

  isLevelEnabled(level: InfrastructureLogLevel): boolean {
    return shouldLog(level, this.level);
  }

  private log(level: InfrastructureLogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog(level, this.level)) return;

    const entry: InfrastructureLogEntry = {
      timestamp: new Date(),
      level,
      subsystem: this.subsystem,
      message: this.redact(message),
      metadata: meta ? this.redactObject(meta) : undefined,
      providerId: this.context.providerId as string | undefined,
      sessionId: this.context.sessionId as string | undefined,
      commandId: this.context.commandId as string | undefined,
      resourceId: this.context.resourceId as string | undefined,
    };

    for (const transport of this.transports) {
      try {
        void transport.write(entry);
      } catch {
        // Silently ignore transport errors
      }
    }
  }

  private redact(value: string): string {
    let result = value;
    for (const pattern of this.redactPatterns) {
      result = result.replace(pattern, "[REDACTED]");
    }
    return result;
  }

  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = this.redact(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

// =============================================================================
// Logger Factory
// =============================================================================

/**
 * Create an infrastructure logger from configuration
 */
export function createInfrastructureLogger(
  subsystem: string,
  config?: LoggingConfig,
): InfrastructureLogger {
  const transports: LogTransport[] = [];

  if (config?.destinations) {
    for (const dest of config.destinations) {
      const transport = createTransportFromConfig(dest);
      if (transport) transports.push(transport);
    }
  }

  if (transports.length === 0) {
    transports.push(new ConsoleTransport({ minLevel: config?.level ?? "info" }));
  }

  return new InfrastructureLoggerImpl({
    subsystem: `infrastructure/${subsystem}`,
    level: config?.level ?? "info",
    transports,
    redactPatterns: config?.redactPatterns,
  });
}

/**
 * Create a transport from configuration
 */
function createTransportFromConfig(dest: LogDestination): LogTransport | null {
  switch (dest.type) {
    case "console":
      return new ConsoleTransport({
        minLevel: (dest.filter?.minLevel as InfrastructureLogLevel) ?? "info",
      });
    case "file":
      return new FileTransport({
        filePath: (dest.config.path as string) ?? "infrastructure.log",
        minLevel: (dest.filter?.minLevel as InfrastructureLogLevel) ?? "info",
      });
    default:
      return null;
  }
}

/**
 * Global infrastructure logger instance
 */
let globalLogger: InfrastructureLogger | null = null;

/**
 * Get or create the global infrastructure logger
 */
export function getInfrastructureLogger(subsystem?: string): InfrastructureLogger {
  if (!globalLogger) {
    globalLogger = createInfrastructureLogger("core");
  }
  return subsystem ? globalLogger.child(subsystem) : globalLogger;
}

/**
 * Set the global infrastructure logger
 */
export function setGlobalInfrastructureLogger(logger: InfrastructureLogger): void {
  globalLogger = logger;
}
