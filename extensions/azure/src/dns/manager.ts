/**
 * Azure DNS Manager
 *
 * Manages DNS zones and record sets via @azure/arm-dns.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { DNSZone, DNSRecord, RecordType } from "./types.js";

export class AzureDNSManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  private async getClient() {
    const { DnsManagementClient } = await import("@azure/arm-dns");
    const { credential } = await this.credentialsManager.getCredential();
    return new DnsManagementClient(credential, this.subscriptionId);
  }

  async listZones(resourceGroup?: string): Promise<DNSZone[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: DNSZone[] = [];
      const iter = resourceGroup
        ? client.zones.listByResourceGroup(resourceGroup)
        : client.zones.list();
      for await (const z of iter) {
        results.push({
          id: z.id ?? "",
          name: z.name ?? "",
          resourceGroup: z.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: z.location ?? "",
          zoneType: (z.zoneType as "Public" | "Private") ?? "Public",
          numberOfRecordSets: z.numberOfRecordSets,
          maxNumberOfRecordSets: z.maxNumberOfRecordSets,
          nameServers: z.nameServers,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getZone(resourceGroup: string, zoneName: string): Promise<DNSZone> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const z = await client.zones.get(resourceGroup, zoneName);
      return {
        id: z.id ?? "",
        name: z.name ?? "",
        resourceGroup,
        location: z.location ?? "",
        zoneType: (z.zoneType as "Public" | "Private") ?? "Public",
        numberOfRecordSets: z.numberOfRecordSets,
        maxNumberOfRecordSets: z.maxNumberOfRecordSets,
        nameServers: z.nameServers,
      };
    }, this.retryOptions);
  }

  async listRecordSets(resourceGroup: string, zoneName: string): Promise<DNSRecord[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: DNSRecord[] = [];
      for await (const rs of client.recordSets.listByDnsZone(resourceGroup, zoneName)) {
        const recordType = rs.type?.split("/").pop() as RecordType;
        results.push({
          id: rs.id ?? "",
          name: rs.name ?? "",
          type: recordType,
          ttl: rs.ttl,
          fqdn: rs.fqdn,
          aRecords: rs.aRecords?.map((r) => ({ ipv4Address: r.ipv4Address ?? "" })),
          aaaaRecords: rs.aaaaRecords?.map((r) => ({ ipv6Address: r.ipv6Address ?? "" })),
          cnameRecord: rs.cnameRecord ? { cname: rs.cnameRecord.cname ?? "" } : undefined,
          mxRecords: rs.mxRecords?.map((r) => ({
            preference: r.preference ?? 0,
            exchange: r.exchange ?? "",
          })),
          txtRecords: rs.txtRecords?.map((r) => ({ value: r.value ?? [] })),
          nsRecords: rs.nsRecords?.map((r) => ({ nsdname: r.nsdname ?? "" })),
        });
      }
      return results;
    }, this.retryOptions);
  }

  async createRecordSet(
    resourceGroup: string,
    zoneName: string,
    recordName: string,
    recordType: RecordType,
    ttl: number,
    records: Record<string, unknown>
  ): Promise<DNSRecord> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const result = await client.recordSets.createOrUpdate(
        resourceGroup,
        zoneName,
        recordName,
        recordType,
        { ttl, ...records }
      );
      return {
        id: result.id ?? "",
        name: result.name ?? "",
        type: recordType,
        ttl: result.ttl,
        fqdn: result.fqdn,
      };
    }, this.retryOptions);
  }

  async deleteRecordSet(
    resourceGroup: string,
    zoneName: string,
    recordName: string,
    recordType: RecordType
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.recordSets.delete(resourceGroup, zoneName, recordName, recordType);
    }, this.retryOptions);
  }

  /**
   * Create or update a DNS zone.
   */
  async createZone(
    resourceGroup: string,
    zoneName: string,
    options?: { location?: string; zoneType?: "Public" | "Private"; tags?: Record<string, string> }
  ): Promise<DNSZone> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const z = await client.zones.createOrUpdate(resourceGroup, zoneName, {
        location: options?.location ?? "global",
        zoneType: options?.zoneType ?? "Public",
        tags: options?.tags,
      });
      return {
        id: z.id ?? "",
        name: z.name ?? "",
        resourceGroup,
        location: z.location ?? "",
        zoneType: (z.zoneType as "Public" | "Private") ?? "Public",
        numberOfRecordSets: z.numberOfRecordSets,
        maxNumberOfRecordSets: z.maxNumberOfRecordSets,
        nameServers: z.nameServers,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a DNS zone.
   */
  async deleteZone(resourceGroup: string, zoneName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.zones.beginDeleteAndWait(resourceGroup, zoneName);
    }, this.retryOptions);
  }
}

export function createDNSManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureDNSManager {
  return new AzureDNSManager(credentialsManager, subscriptionId, retryOptions);
}
