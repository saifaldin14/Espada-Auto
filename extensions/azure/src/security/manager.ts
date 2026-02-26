/**
 * Azure Security Manager (Microsoft Defender for Cloud)
 *
 * Manages security assessments, alerts, and recommendations via @azure/arm-security.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { SecureScore, SecurityAssessment, SecurityAlert, SecurityRecommendation, SecuritySeverity } from "./types.js";

export class AzureSecurityManager {
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
    const { SecurityCenter } = await import("@azure/arm-security");
    const { credential } = await this.credentialsManager.getCredential();
    return new SecurityCenter(credential, this.subscriptionId);
  }

  async getSecureScores(): Promise<SecureScore[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: SecureScore[] = [];
      for await (const s of client.secureScores.list()) {
        const score = (s as any).score ?? (s as any).scoreDetails ?? {}; // SDK typing gap: score shape varies across SDK versions
        results.push({
          id: s.id ?? "",
          displayName: s.displayName ?? "",
          currentScore: score.current ?? (s as any).current ?? 0, // SDK typing gap
          maxScore: score.max ?? (s as any).max ?? 0, // SDK typing gap
          percentage: score.percentage ?? 0,
          weight: (s as any).weight ?? 0, // SDK typing gap
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listAssessments(scope?: string): Promise<SecurityAssessment[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const effectiveScope = scope ?? `/subscriptions/${this.subscriptionId}`;
      const results: SecurityAssessment[] = [];
      for await (const a of client.assessments.list(effectiveScope)) {
        results.push({
          id: a.id ?? "",
          name: a.name ?? "",
          displayName: a.displayName ?? "",
          status: a.status?.code ?? "",
          severity: ((a.metadata?.severity ?? "Medium") as string as SecuritySeverity),
          resourceId: a.resourceDetails ? (a.resourceDetails as { id?: string }).id : undefined,
          description: a.metadata?.description,
          remediation: a.metadata?.remediationDescription,
          categories: a.metadata?.categories,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listAlerts(resourceGroup?: string): Promise<SecurityAlert[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: SecurityAlert[] = [];
      const iter = resourceGroup
        ? client.alerts.listByResourceGroup(resourceGroup)
        : client.alerts.listByResourceGroup(""); // fallback
      for await (const alert of client.alerts.list()) {
        results.push({
          id: alert.id ?? "",
          name: alert.name ?? "",
          alertDisplayName: alert.alertDisplayName ?? "",
          alertType: alert.alertType ?? "",
          severity: ((alert.severity ?? "Medium") as string as SecuritySeverity),
          status: alert.status ?? "",
          startTimeUtc: alert.startTimeUtc?.toISOString(),
          endTimeUtc: alert.endTimeUtc?.toISOString(),
          description: alert.description,
          compromisedEntity: alert.compromisedEntity,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listRecommendations(): Promise<SecurityRecommendation[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: SecurityRecommendation[] = [];
      const scope = `/subscriptions/${this.subscriptionId}`;
      for await (const a of client.assessments.list(scope)) {
        if (a.metadata) {
          results.push({
            id: a.id ?? "",
            name: a.name ?? "",
            displayName: a.displayName ?? a.metadata.displayName ?? "",
            severity: ((a.metadata.severity ?? "Medium") as string as SecuritySeverity),
            status: a.status?.code ?? "",
            description: a.metadata.description,
            remediationDescription: a.metadata.remediationDescription,
            categories: a.metadata.categories,
            threats: a.metadata.threats,
          });
        }
      }
      return results;
    }, this.retryOptions);
  }
}

export function createSecurityManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureSecurityManager {
  return new AzureSecurityManager(credentialsManager, subscriptionId, retryOptions);
}
