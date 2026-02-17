/**
 * Azure Compliance Manager
 *
 * Aggregates compliance data from Azure Policy and presents compliance reports.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  ComplianceFramework,
  ComplianceViolation,
  ComplianceStatus,
  ComplianceReport,
} from "./types.js";

// Built-in framework definitions
const BUILTIN_FRAMEWORKS: ComplianceFramework[] = [
  { id: "cis-azure-1.4", name: "CIS Azure 1.4", description: "CIS Microsoft Azure Foundations Benchmark v1.4", version: "1.4", controls: 100, category: "Security" },
  { id: "nist-800-53", name: "NIST 800-53", description: "NIST SP 800-53 Rev 5", version: "5", controls: 200, category: "Federal" },
  { id: "pci-dss-3.2.1", name: "PCI DSS 3.2.1", description: "Payment Card Industry Data Security Standard", version: "3.2.1", controls: 78, category: "Industry" },
  { id: "hipaa", name: "HIPAA", description: "Health Insurance Portability and Accountability Act", version: "1.0", controls: 45, category: "Healthcare" },
  { id: "iso-27001", name: "ISO 27001", description: "ISO/IEC 27001:2013", version: "2013", controls: 114, category: "International" },
  { id: "soc-2", name: "SOC 2", description: "SOC 2 Type II", version: "2.0", controls: 64, category: "Audit" },
];

export class AzureComplianceManager {
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

  listFrameworks(): ComplianceFramework[] {
    return [...BUILTIN_FRAMEWORKS];
  }

  async getComplianceStatus(frameworkId?: string): Promise<ComplianceStatus[]> {
    return withAzureRetry(async () => {
      const { PolicyInsightsClient } = await import("@azure/arm-policyinsights");
      const { credential } = await this.credentialsManager.getCredential();
      const client = new PolicyInsightsClient(credential, this.subscriptionId);

      // Aggregate compliance from policy states
      let compliant = 0;
      let nonCompliant = 0;
      for await (const state of client.policyStates.listQueryResultsForSubscription(
        "latest",
        this.subscriptionId
      )) {
        if (state.complianceState === "Compliant") compliant++;
        else if (state.complianceState === "NonCompliant") nonCompliant++;
      }

      const total = compliant + nonCompliant;
      const frameworks = frameworkId
        ? BUILTIN_FRAMEWORKS.filter((f) => f.id === frameworkId)
        : BUILTIN_FRAMEWORKS;

      return frameworks.map((f) => ({
        framework: f.name,
        totalControls: f.controls,
        compliantControls: total > 0 ? Math.round((compliant / total) * f.controls) : 0,
        nonCompliantControls: total > 0 ? Math.round((nonCompliant / total) * f.controls) : 0,
        percentage: total > 0 ? Math.round((compliant / total) * 100) : 0,
        lastEvaluated: new Date().toISOString(),
      }));
    }, this.retryOptions);
  }

  async listViolations(resourceGroup?: string): Promise<ComplianceViolation[]> {
    return withAzureRetry(async () => {
      const { PolicyInsightsClient } = await import("@azure/arm-policyinsights");
      const { credential } = await this.credentialsManager.getCredential();
      const client = new PolicyInsightsClient(credential, this.subscriptionId);

      const violations: ComplianceViolation[] = [];
      for await (const state of client.policyStates.listQueryResultsForSubscription(
        "latest",
        this.subscriptionId
      )) {
        if (state.complianceState !== "NonCompliant") continue;
        const rg = state.resourceGroup ?? "";
        if (resourceGroup && rg !== resourceGroup) continue;
        violations.push({
          id: state.policyAssignmentId ?? "",
          resourceId: state.resourceId ?? "",
          resourceType: state.resourceType ?? "",
          resourceGroup: rg,
          framework: "Azure Policy",
          control: state.policyDefinitionName ?? "",
          severity: "medium",
          message: `Non-compliant with policy: ${state.policyDefinitionName ?? "unknown"}`,
          timestamp: state.timestamp?.toISOString() ?? new Date().toISOString(),
        });
      }
      return violations;
    }, this.retryOptions);
  }

  async generateReport(): Promise<ComplianceReport> {
    const [statuses, violations] = await Promise.all([
      this.getComplianceStatus(),
      this.listViolations(),
    ]);
    const totalControls = statuses.reduce((s, st) => s + st.totalControls, 0);
    const compliantControls = statuses.reduce((s, st) => s + st.compliantControls, 0);
    return {
      id: `report-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      subscription: this.subscriptionId,
      frameworks: statuses,
      violations,
      summary: {
        total: totalControls,
        compliant: compliantControls,
        nonCompliant: totalControls - compliantControls,
        percentage: totalControls > 0 ? Math.round((compliantControls / totalControls) * 100) : 0,
      },
    };
  }
}

export function createComplianceManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureComplianceManager {
  return new AzureComplianceManager(credentialsManager, subscriptionId, retryOptions);
}
