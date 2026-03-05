/**
 * Network Pipeline — Types
 *
 * Types specific to the network/security migration pipeline:
 * security groups, firewall rules, VPC/VNet, subnets, DNS, VPN.
 */

import type { MigrationProvider, NormalizedSecurityRule, NormalizedDNSRecord } from "../types.js";

// =============================================================================
// Network Topology
// =============================================================================

export interface NormalizedVPC {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  cidrBlocks: string[];
  subnets: NormalizedSubnet[];
  routeTables: NormalizedRouteTable[];
  internetGateway: boolean;
  natGateway: boolean;
  tags: Record<string, string>;
}

export interface NormalizedSubnet {
  id: string;
  name: string;
  cidrBlock: string;
  availabilityZone: string;
  public: boolean;
  routeTableId?: string;
  tags: Record<string, string>;
}

export interface NormalizedRouteTable {
  id: string;
  name: string;
  routes: Array<{
    destination: string;
    target: string;
    type: "local" | "igw" | "nat" | "vpn" | "peering" | "transit";
  }>;
}

// =============================================================================
// Security Rule Translation
// =============================================================================

export interface SecurityGroupMapping {
  sourceGroupId: string;
  sourceGroupName: string;
  sourceProvider: MigrationProvider;
  targetGroupId?: string;
  targetGroupName: string;
  targetProvider: MigrationProvider;
  rules: SecurityRuleMapping[];
  warnings: string[];
}

export interface SecurityRuleMapping {
  sourceRule: NormalizedSecurityRule;
  targetRule: NormalizedSecurityRule;
  translationNotes: string[];
  lossOfFidelity: boolean;
}

// =============================================================================
// DNS Migration
// =============================================================================

export interface DNSZone {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "public" | "private";
  records: NormalizedDNSRecord[];
  nameServers: string[];
}

export interface DNSMigrationPlan {
  sourceZone: DNSZone;
  targetProvider: MigrationProvider;
  recordsToCreate: NormalizedDNSRecord[];
  recordsToUpdate: Array<{
    record: NormalizedDNSRecord;
    oldValue: string;
    newValue: string;
    reason: string;
  }>;
  recordsToSkip: Array<{
    record: NormalizedDNSRecord;
    reason: string;
  }>;
  nameServerChange: boolean;
}

// =============================================================================
// VPN / Connectivity
// =============================================================================

export interface VPNConnection {
  id: string;
  provider: MigrationProvider;
  type: "site-to-site" | "point-to-site" | "direct-connect" | "express-route" | "cloud-vpn";
  localGatewayIp: string;
  remoteGatewayIp: string;
  tunnels: Array<{
    id: string;
    insideCidr: string;
    preSharedKey: string;
    status: "up" | "down";
  }>;
  routingType: "static" | "bgp";
  bgpAsn?: number;
}

// =============================================================================
// Network Migration Result
// =============================================================================

export interface NetworkMigrationResult {
  vpcsCreated: number;
  subnetsCreated: number;
  securityGroupsCreated: number;
  rulesTranslated: number;
  rulesWithWarnings: number;
  dnsRecordsMigrated: number;
  connectivityVerified: boolean;
  warnings: string[];
}

// Re-export
export type { NormalizedSecurityRule, NormalizedDNSRecord };
