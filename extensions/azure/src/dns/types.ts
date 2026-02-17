/**
 * Azure DNS — Type Definitions
 */

export type RecordType = "A" | "AAAA" | "CNAME" | "MX" | "NS" | "PTR" | "SOA" | "SRV" | "TXT" | "CAA";

export type DNSZone = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  zoneType: "Public" | "Private";
  numberOfRecordSets?: number;
  maxNumberOfRecordSets?: number;
  nameServers?: string[];
};

export type DNSRecord = {
  id: string;
  name: string;
  type: RecordType;
  ttl?: number;
  fqdn?: string;
  aRecords?: Array<{ ipv4Address: string }>;
  aaaaRecords?: Array<{ ipv6Address: string }>;
  cnameRecord?: { cname: string };
  mxRecords?: Array<{ preference: number; exchange: string }>;
  txtRecords?: Array<{ value: string[] }>;
  srvRecords?: Array<{ priority: number; weight: number; port: number; target: string }>;
  nsRecords?: Array<{ nsdname: string }>;
};

export type PrivateDNSZone = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  numberOfRecordSets?: number;
  maxNumberOfRecordSets?: number;
  numberOfVirtualNetworkLinks?: number;
  provisioningState?: string;
};
