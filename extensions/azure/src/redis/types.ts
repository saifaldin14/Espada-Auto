/**
 * Azure Cache for Redis — Type Definitions
 */

export type RedisSkuName = "Basic" | "Standard" | "Premium" | "Enterprise";

export type RedisCache = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  hostName?: string;
  port?: number;
  sslPort?: number;
  sku: { name: RedisSkuName; family: string; capacity: number };
  provisioningState?: string;
  redisVersion?: string;
  enableNonSslPort?: boolean;
  minimumTlsVersion?: string;
  linkedServers?: string[];
};

export type RedisFirewallRule = {
  id: string;
  name: string;
  startIP: string;
  endIP: string;
};

export type RedisAccessKeys = {
  primaryKey: string;
  secondaryKey: string;
};

export type RedisPatchSchedule = {
  dayOfWeek: string;
  startHourUtc: number;
  maintenanceWindow?: string;
};
