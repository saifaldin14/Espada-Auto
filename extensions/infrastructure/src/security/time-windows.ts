/**
 * Infrastructure Operation Time Windows
 */

import type { TimeWindow, TimeWindowCheckResult, Environment, RiskLevel } from "./types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

export type TimeWindowConfig = { defaultTimezone: string; enableMaintenanceWindows: boolean; enableChangeFreeze: boolean; gracePeriodMinutes: number; };
export const defaultTimeWindowConfig: TimeWindowConfig = { defaultTimezone: "UTC", enableMaintenanceWindows: true, enableChangeFreeze: true, gracePeriodMinutes: 5 };

export interface TimeWindowStorage {
  save(window: TimeWindow): Promise<void>;
  get(id: string): Promise<TimeWindow | null>;
  list(options?: { environment?: Environment; enabled?: boolean }): Promise<TimeWindow[]>;
  delete(id: string): Promise<void>;
}

export class InMemoryTimeWindowStorage implements TimeWindowStorage {
  private windows: Map<string, TimeWindow> = new Map();

  async save(window: TimeWindow): Promise<void> { this.windows.set(window.id, window); }
  async get(id: string): Promise<TimeWindow | null> { return this.windows.get(id) ?? null; }
  async list(options?: { environment?: Environment; enabled?: boolean }): Promise<TimeWindow[]> {
    let results = Array.from(this.windows.values());
    if (options?.environment) results = results.filter(w => w.environments.includes(options.environment!));
    if (options?.enabled !== undefined) results = results.filter(w => w.enabled === options.enabled);
    return results;
  }
  async delete(id: string): Promise<void> { this.windows.delete(id); }
}

export const DEFAULT_TIME_WINDOWS: TimeWindow[] = [
  {
    id: "business-hours",
    name: "Business Hours",
    description: "Normal business hours - all operations allowed",
    schedule: { type: "recurring", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" },
    environments: ["development", "staging"],
    enabled: true,
  },
  {
    id: "prod-maintenance",
    name: "Production Maintenance Window",
    description: "Weekly maintenance window for production changes",
    schedule: { type: "recurring", timezone: "UTC", daysOfWeek: [2, 4], startTime: "02:00", endTime: "06:00" },
    environments: ["production"],
    riskLevels: ["low", "medium", "high"],
    enabled: true,
  },
  {
    id: "weekend-freeze",
    name: "Weekend Freeze",
    description: "No production changes on weekends",
    schedule: { type: "blackout", timezone: "UTC", daysOfWeek: [0, 6], startTime: "00:00", endTime: "23:59" },
    environments: ["production"],
    enabled: true,
  },
];

export class InfrastructureTimeWindowManager {
  private config: TimeWindowConfig;
  private storage: TimeWindowStorage;
  private logger: InfrastructureLogger;

  constructor(options: { config?: Partial<TimeWindowConfig>; storage?: TimeWindowStorage; logger: InfrastructureLogger }) {
    this.config = { ...defaultTimeWindowConfig, ...options.config };
    this.storage = options.storage ?? new InMemoryTimeWindowStorage();
    this.logger = options.logger;
  }

  async initialize(): Promise<void> {
    for (const window of DEFAULT_TIME_WINDOWS) await this.storage.save(window);
    this.logger.info("Time windows initialized");
  }

  async checkTimeWindow(options: { environment: Environment; riskLevel: RiskLevel; timestamp?: Date; }): Promise<TimeWindowCheckResult> {
    const now = options.timestamp ?? new Date();
    const windows = await this.storage.list({ environment: options.environment, enabled: true });

    // Check for blackout windows first
    const blackouts = windows.filter(w => w.schedule.type === "blackout" && this.isWithinWindow(w, now));
    if (blackouts.length > 0) {
      const nextAllowed = this.findNextAllowedTime(blackouts[0], now);
      return { allowed: false, currentWindow: blackouts[0], reason: `Blackout window: ${blackouts[0].name}`, nextAllowedWindow: nextAllowed ? { window: blackouts[0], startsAt: nextAllowed } : undefined };
    }

    // Check for allowed recurring windows
    const allowed = windows.filter(w => w.schedule.type === "recurring" && this.isWithinWindow(w, now));
    if (allowed.length > 0) {
      // Check risk level if specified
      for (const window of allowed) {
        if (window.riskLevels && !window.riskLevels.includes(options.riskLevel)) {
          return { allowed: false, currentWindow: window, reason: `Risk level ${options.riskLevel} not allowed in ${window.name}` };
        }
      }
      return { allowed: true, currentWindow: allowed[0], reason: "Within allowed time window" };
    }

    // If no windows match, allow by default for non-production
    if (options.environment !== "production") {
      return { allowed: true, reason: "No restrictions for this environment" };
    }

    return { allowed: false, reason: "Outside allowed time windows for production" };
  }

  async createTimeWindow(window: Omit<TimeWindow, "id">): Promise<TimeWindow> {
    const fullWindow: TimeWindow = { ...window, id: `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    await this.storage.save(fullWindow);
    this.logger.info("Time window created", { id: fullWindow.id, name: fullWindow.name });
    return fullWindow;
  }

  async updateTimeWindow(id: string, updates: Partial<Omit<TimeWindow, "id">>): Promise<TimeWindow | null> {
    const window = await this.storage.get(id);
    if (!window) return null;
    const updated = { ...window, ...updates };
    await this.storage.save(updated);
    return updated;
  }

  async deleteTimeWindow(id: string): Promise<boolean> {
    const window = await this.storage.get(id);
    if (!window) return false;
    await this.storage.delete(id);
    return true;
  }

  async createChangeFreeze(options: { name: string; reason: string; startDate: Date; endDate: Date; environments: Environment[]; }): Promise<TimeWindow> {
    return this.createTimeWindow({
      name: options.name,
      description: options.reason,
      schedule: { type: "blackout", timezone: this.config.defaultTimezone, startDate: options.startDate, endDate: options.endDate },
      environments: options.environments,
      enabled: true,
    });
  }

  async getTimeWindow(id: string): Promise<TimeWindow | null> { return this.storage.get(id); }
  async listTimeWindows(options?: { environment?: Environment; enabled?: boolean }): Promise<TimeWindow[]> { return this.storage.list(options); }

  private isWithinWindow(window: TimeWindow, time: Date): boolean {
    const schedule = window.schedule;

    if (schedule.startDate && schedule.endDate) {
      return time >= schedule.startDate && time <= schedule.endDate;
    }

    if (schedule.daysOfWeek) {
      const dayOfWeek = time.getUTCDay();
      if (!schedule.daysOfWeek.includes(dayOfWeek)) return false;
    }

    if (schedule.startTime && schedule.endTime) {
      const [startHour, startMin] = schedule.startTime.split(":").map(Number);
      const [endHour, endMin] = schedule.endTime.split(":").map(Number);
      const currentMinutes = time.getUTCHours() * 60 + time.getUTCMinutes();
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    return true;
  }

  private findNextAllowedTime(window: TimeWindow, from: Date): Date | undefined {
    const schedule = window.schedule;

    if (schedule.endDate) {
      return new Date(schedule.endDate.getTime() + this.config.gracePeriodMinutes * 60 * 1000);
    }

    if (schedule.daysOfWeek && schedule.endTime) {
      const result = new Date(from);
      for (let i = 0; i < 8; i++) {
        result.setUTCDate(result.getUTCDate() + 1);
        if (!schedule.daysOfWeek.includes(result.getUTCDay())) {
          result.setUTCHours(0, 0, 0, 0);
          return result;
        }
      }
    }

    return undefined;
  }
}

export function createTimeWindowManager(options: { config?: Partial<TimeWindowConfig>; storage?: TimeWindowStorage; logger: InfrastructureLogger }): InfrastructureTimeWindowManager {
  return new InfrastructureTimeWindowManager(options);
}
