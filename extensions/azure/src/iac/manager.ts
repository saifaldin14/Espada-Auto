/**
 * Azure IaC Manager
 *
 * Generates Infrastructure-as-Code templates (Terraform, Bicep, ARM)
 * from planned resources, detects drift, and exports state.
 */

import type {
  IaCFormat,
  IaCGenerationOptions,
  IaCGenerationResult,
  ResourceDefinition,
  DriftDetectionResult,
  DriftChange,
  IaCStateExport,
} from "./types.js";
import type { PlannedResource } from "../intent/types.js";

// =============================================================================
// IaC Manager
// =============================================================================

export class AzureIaCManager {
  /**
   * Generate IaC from planned resources.
   */
  generate(resources: PlannedResource[], options: IaCGenerationOptions): IaCGenerationResult {
    switch (options.format) {
      case "terraform":
        return this.generateTerraform(resources, options);
      case "bicep":
        return this.generateBicep(resources, options);
      case "arm":
        return this.generateArm(resources, options);
    }
  }

  /**
   * Generate IaC from resource definitions (live resources).
   */
  generateFromDefinitions(definitions: ResourceDefinition[], options: IaCGenerationOptions): IaCGenerationResult {
    const planned: PlannedResource[] = definitions.map((d) => ({
      id: d.name,
      type: d.type,
      name: d.name,
      region: d.region,
      resourceGroup: d.resourceGroup,
      properties: d.properties,
      dependsOn: d.dependsOn,
      tier: "imported",
      estimatedMonthlyCostUsd: 0,
      tags: d.tags,
    }));
    return this.generate(planned, options);
  }

  /**
   * Detect drift between desired IaC state and actual resource state.
   */
  detectDrift(desired: ResourceDefinition, actual: ResourceDefinition): DriftDetectionResult {
    const changes: DriftChange[] = [];

    this.compareProperties(desired.properties, actual.properties, "", changes);

    // Check tags
    for (const [key, value] of Object.entries(desired.tags)) {
      if (actual.tags[key] !== value) {
        changes.push({
          property: `tags.${key}`,
          expectedValue: value,
          actualValue: actual.tags[key] ?? "(missing)",
          severity: "low",
        });
      }
    }

    return {
      resourceId: actual.name,
      resourceName: actual.name,
      resourceType: actual.type,
      driftDetected: changes.length > 0,
      changes,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Export current state for import into IaC tools.
   */
  exportState(resources: ResourceDefinition[], format: IaCFormat): IaCStateExport {
    return {
      format,
      resources: resources.map((r) => ({
        type: r.type,
        name: r.name,
        properties: r.properties,
      })),
      exportedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Terraform Generation
  // ---------------------------------------------------------------------------

  private generateTerraform(resources: PlannedResource[], options: IaCGenerationOptions): IaCGenerationResult {
    const lines: string[] = [];
    const warnings: string[] = [];

    if (options.includeProvider !== false) {
      lines.push("terraform {");
      lines.push("  required_providers {");
      lines.push("    azurerm = {");
      lines.push('      source  = "hashicorp/azurerm"');
      lines.push('      version = "~> 3.0"');
      lines.push("    }");
      lines.push("  }");
      lines.push("}");
      lines.push("");
      lines.push('provider "azurerm" {');
      lines.push("  features {}");
      lines.push("}");
      lines.push("");
    }

    if (options.includeVariables !== false) {
      lines.push('variable "environment" {');
      lines.push("  type    = string");
      lines.push('  default = "production"');
      lines.push("}");
      lines.push("");
      lines.push('variable "region" {');
      lines.push("  type    = string");
      lines.push(`  default = "${options.region ?? "eastus"}"`);
      lines.push("}");
      lines.push("");
    }

    for (const resource of resources) {
      const tfType = this.azureTypeToTerraform(resource.type);
      if (!tfType) {
        warnings.push(`Unsupported resource type for Terraform: ${resource.type}`);
        continue;
      }

      const tfName = this.sanitizeTfName(resource.name);
      lines.push(`resource "${tfType}" "${tfName}" {`);
      lines.push(`  name                = "${resource.name}"`);

      if (resource.type === "Microsoft.Resources/resourceGroups") {
        lines.push(`  location            = var.region`);
      } else {
        const rgRef = resources.find((r) => r.type === "Microsoft.Resources/resourceGroups");
        if (rgRef) {
          lines.push(`  resource_group_name = azurerm_resource_group.${this.sanitizeTfName(rgRef.name)}.name`);
          lines.push(`  location            = azurerm_resource_group.${this.sanitizeTfName(rgRef.name)}.location`);
        } else {
          lines.push(`  resource_group_name = "${resource.resourceGroup}"`);
          lines.push(`  location            = var.region`);
        }
      }

      this.addTerraformProperties(lines, resource, resources);

      if (Object.keys(resource.tags).length > 0) {
        lines.push("");
        lines.push("  tags = {");
        for (const [key, value] of Object.entries(resource.tags)) {
          lines.push(`    ${key} = "${value}"`);
        }
        lines.push("  }");
      }

      lines.push("}");
      lines.push("");
    }

    if (options.includeOutputs !== false) {
      const computeResources = resources.filter((r) =>
        r.type.includes("Web/sites") || r.type.includes("containerApps") || r.type.includes("managedClusters"),
      );
      for (const r of computeResources) {
        const tfType = this.azureTypeToTerraform(r.type);
        if (!tfType) continue;
        const tfName = this.sanitizeTfName(r.name);
        lines.push(`output "${tfName}_id" {`);
        lines.push(`  value = ${tfType}.${tfName}.id`);
        lines.push("}");
        lines.push("");
      }
    }

    return {
      format: "terraform",
      content: lines.join("\n"),
      fileName: options.moduleName ? `${options.moduleName}.tf` : "main.tf",
      resourceCount: resources.length,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Bicep Generation
  // ---------------------------------------------------------------------------

  private generateBicep(resources: PlannedResource[], options: IaCGenerationOptions): IaCGenerationResult {
    const lines: string[] = [];
    const warnings: string[] = [];

    if (options.includeVariables !== false) {
      lines.push(`param location string = '${options.region ?? "eastus"}'`);
      lines.push(`param environment string = 'production'`);
      lines.push("");
    }

    // Emit targetScope at the top if any resource group resources exist
    const hasResourceGroupResources = resources.some((r) => r.type === "Microsoft.Resources/resourceGroups");
    if (hasResourceGroupResources) {
      lines.unshift(`targetScope = 'subscription'`, "");
    }

    for (const resource of resources) {
      if (resource.type === "Microsoft.Resources/resourceGroups") {
        lines.push(`resource rg '${resource.type}@2023-07-01' = {`);
        lines.push(`  name: '${resource.name}'`);
        lines.push(`  location: location`);
        if (Object.keys(resource.tags).length > 0) {
          lines.push("  tags: {");
          for (const [key, value] of Object.entries(resource.tags)) {
            lines.push(`    ${key}: '${value}'`);
          }
          lines.push("  }");
        }
        lines.push("}");
        lines.push("");
        continue;
      }

      const apiVersion = this.getAzureApiVersion(resource.type);
      const bicepName = this.sanitizeBicepName(resource.name);
      lines.push(`resource ${bicepName} '${resource.type}@${apiVersion}' = {`);
      lines.push(`  name: '${resource.name}'`);
      lines.push(`  location: location`);

      this.addBicepProperties(lines, resource);

      if (Object.keys(resource.tags).length > 0) {
        lines.push("  tags: {");
        for (const [key, value] of Object.entries(resource.tags)) {
          lines.push(`    ${key}: '${value}'`);
        }
        lines.push("  }");
      }

      // Dependencies
      const depRefs = resource.dependsOn
        .map((d) => resources.find((r) => r.id === d))
        .filter(Boolean)
        .filter((r) => r!.type !== "Microsoft.Resources/resourceGroups");
      if (depRefs.length > 0) {
        lines.push(`  dependsOn: [`);
        for (const dep of depRefs) {
          lines.push(`    ${this.sanitizeBicepName(dep!.name)}`);
        }
        lines.push("  ]");
      }

      lines.push("}");
      lines.push("");
    }

    if (options.includeOutputs !== false) {
      const computeResources = resources.filter((r) =>
        r.type.includes("Web/sites") || r.type.includes("containerApps"),
      );
      for (const r of computeResources) {
        const bicepName = this.sanitizeBicepName(r.name);
        lines.push(`output ${bicepName}Id string = ${bicepName}.id`);
      }
    }

    return {
      format: "bicep",
      content: lines.join("\n"),
      fileName: options.moduleName ? `${options.moduleName}.bicep` : "main.bicep",
      resourceCount: resources.length,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // ARM Template Generation
  // ---------------------------------------------------------------------------

  private generateArm(resources: PlannedResource[], options: IaCGenerationOptions): IaCGenerationResult {
    const warnings: string[] = [];

    const armTemplate: Record<string, unknown> = {
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
    };

    if (options.includeVariables !== false) {
      armTemplate.parameters = {
        location: { type: "string", defaultValue: options.region ?? "eastus" },
        environment: { type: "string", defaultValue: "production" },
      };
    }

    const armResources: unknown[] = [];
    for (const resource of resources.filter((r) => r.type !== "Microsoft.Resources/resourceGroups")) {
      const apiVersion = this.getAzureApiVersion(resource.type);
      const armResource: Record<string, unknown> = {
        type: resource.type,
        apiVersion,
        name: resource.name,
        location: "[parameters('location')]",
        tags: resource.tags,
        properties: this.cleanProperties(resource.properties),
      };

      const depRefs = resource.dependsOn
        .map((d) => resources.find((r) => r.id === d))
        .filter(Boolean)
        .filter((r) => r!.type !== "Microsoft.Resources/resourceGroups");
      if (depRefs.length > 0) {
        armResource.dependsOn = depRefs.map((r) => `[resourceId('${r!.type}', '${r!.name}')]`);
      }

      armResources.push(armResource);
    }

    armTemplate.resources = armResources;

    if (options.includeOutputs !== false) {
      const outputs: Record<string, unknown> = {};
      const computeResources = resources.filter((r) =>
        r.type.includes("Web/sites") || r.type.includes("containerApps"),
      );
      for (const r of computeResources) {
        const safeName = r.name.replace(/[^a-zA-Z0-9]/g, "");
        outputs[`${safeName}Id`] = {
          type: "string",
          value: `[resourceId('${r.type}', '${r.name}')]`,
        };
      }
      armTemplate.outputs = outputs;
    }

    return {
      format: "arm",
      content: JSON.stringify(armTemplate, null, 2),
      fileName: options.moduleName ? `${options.moduleName}.json` : "azuredeploy.json",
      resourceCount: resources.length,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private azureTypeToTerraform(azureType: string): string | null {
    const map: Record<string, string> = {
      "Microsoft.Resources/resourceGroups": "azurerm_resource_group",
      "Microsoft.Network/virtualNetworks": "azurerm_virtual_network",
      "Microsoft.Network/networkSecurityGroups": "azurerm_network_security_group",
      "Microsoft.KeyVault/vaults": "azurerm_key_vault",
      "Microsoft.Sql/servers": "azurerm_mssql_server",
      "Microsoft.DBforPostgreSQL/flexibleServers": "azurerm_postgresql_flexible_server",
      "Microsoft.DBforMySQL/flexibleServers": "azurerm_mysql_flexible_server",
      "Microsoft.DocumentDB/databaseAccounts": "azurerm_cosmosdb_account",
      "Microsoft.Cache/Redis": "azurerm_redis_cache",
      "Microsoft.Storage/storageAccounts": "azurerm_storage_account",
      "Microsoft.Web/serverfarms": "azurerm_service_plan",
      "Microsoft.Web/sites": "azurerm_linux_web_app",
      "Microsoft.App/managedEnvironments": "azurerm_container_app_environment",
      "Microsoft.App/containerApps": "azurerm_container_app",
      "Microsoft.ContainerService/managedClusters": "azurerm_kubernetes_cluster",
      "Microsoft.Insights/components": "azurerm_application_insights",
      "Microsoft.RecoveryServices/vaults": "azurerm_recovery_services_vault",
      "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies": "azurerm_web_application_firewall_policy",
      "Microsoft.Compute/virtualMachines": "azurerm_virtual_machine",
    };
    return map[azureType] ?? null;
  }

  private sanitizeTfName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private sanitizeBicepName(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "");
  }

  private getAzureApiVersion(type: string): string {
    const versions: Record<string, string> = {
      "Microsoft.Resources/resourceGroups": "2023-07-01",
      "Microsoft.Network/virtualNetworks": "2023-11-01",
      "Microsoft.Network/networkSecurityGroups": "2023-11-01",
      "Microsoft.KeyVault/vaults": "2023-07-01",
      "Microsoft.Sql/servers": "2023-08-01-preview",
      "Microsoft.DBforPostgreSQL/flexibleServers": "2023-12-01-preview",
      "Microsoft.DBforMySQL/flexibleServers": "2023-12-30",
      "Microsoft.DocumentDB/databaseAccounts": "2024-02-15-preview",
      "Microsoft.Cache/Redis": "2023-08-01",
      "Microsoft.Storage/storageAccounts": "2023-05-01",
      "Microsoft.Web/serverfarms": "2023-12-01",
      "Microsoft.Web/sites": "2023-12-01",
      "Microsoft.App/managedEnvironments": "2024-03-01",
      "Microsoft.App/containerApps": "2024-03-01",
      "Microsoft.ContainerService/managedClusters": "2024-02-01",
      "Microsoft.Insights/components": "2020-02-02",
      "Microsoft.RecoveryServices/vaults": "2024-01-01",
      "Microsoft.Compute/virtualMachines": "2024-03-01",
    };
    return versions[type] ?? "2023-01-01";
  }

  private addTerraformProperties(lines: string[], resource: PlannedResource, _allResources: PlannedResource[]): void {
    const props = resource.properties as Record<string, unknown>;

    switch (resource.type) {
      case "Microsoft.Network/virtualNetworks": {
        const addrSpace = props.addressSpace as { addressPrefixes?: string[] } | undefined;
        if (addrSpace?.addressPrefixes) {
          lines.push(`  address_space       = ${JSON.stringify(addrSpace.addressPrefixes)}`);
        }
        const subnets = props.subnets as Array<{ name: string; addressPrefix: string }> | undefined;
        if (subnets) {
          for (const subnet of subnets) {
            lines.push("");
            lines.push("  subnet {");
            lines.push(`    name           = "${subnet.name}"`);
            lines.push(`    address_prefix = "${subnet.addressPrefix}"`);
            lines.push("  }");
          }
        }
        break;
      }
      case "Microsoft.KeyVault/vaults": {
        lines.push(`  tenant_id                 = data.azurerm_client_config.current.tenant_id`);
        lines.push(`  sku_name                  = "standard"`);
        lines.push(`  soft_delete_retention_days = 7`);
        lines.push(`  purge_protection_enabled  = ${props.enablePurgeProtection ?? false}`);
        lines.push(`  enable_rbac_authorization = ${props.enableRbacAuthorization ?? true}`);
        break;
      }
      case "Microsoft.Web/serverfarms": {
        const sku = props.sku as { name?: string; tier?: string } | undefined;
        lines.push(`  os_type             = "${props.reserved ? "Linux" : "Windows"}"`);
        lines.push(`  sku_name            = "${sku?.name ?? "S1"}"`);
        break;
      }
      case "Microsoft.Web/sites": {
        if (props.kind === "functionapp") {
          lines.push(`  # Function App — use azurerm_linux_function_app resource type`);
        }
        lines.push(`  https_only          = true`);
        lines.push("");
        lines.push("  site_config {");
        lines.push(`    always_on          = true`);
        lines.push(`    minimum_tls_version = "1.2"`);
        lines.push("  }");
        break;
      }
      case "Microsoft.App/containerApps": {
        const ingress = props.ingress as { external?: boolean; targetPort?: number } | undefined;
        lines.push("");
        lines.push("  ingress {");
        lines.push(`    external_enabled = ${ingress?.external ?? true}`);
        lines.push(`    target_port      = ${ingress?.targetPort ?? 8080}`);
        lines.push("    traffic_weight {");
        lines.push("      percentage      = 100");
        lines.push("      latest_revision = true");
        lines.push("    }");
        lines.push("  }");
        lines.push("");
        lines.push("  template {");
        lines.push("    container {");
        lines.push(`      name   = "${resource.name}"`);
        lines.push(`      image  = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"`);
        lines.push("      cpu    = 0.5");
        lines.push("      memory = \"1Gi\"");
        lines.push("    }");
        lines.push("  }");
        break;
      }
      case "Microsoft.Storage/storageAccounts": {
        const sku = props.sku as { name?: string } | undefined;
        lines.push(`  account_tier              = "Standard"`);
        lines.push(`  account_replication_type  = "${(sku?.name ?? "Standard_LRS").includes("GRS") ? "GRS" : "LRS"}"`);
        lines.push(`  min_tls_version           = "TLS1_2"`);
        lines.push(`  https_traffic_only_enabled = true`);
        break;
      }
      case "Microsoft.Cache/Redis": {
        const sku = props.sku as { name?: string; family?: string; capacity?: number } | undefined;
        lines.push(`  capacity            = ${sku?.capacity ?? 0}`);
        lines.push(`  family              = "${sku?.family ?? "C"}"`);
        lines.push(`  sku_name            = "${sku?.name ?? "Standard"}"`);
        lines.push(`  enable_non_ssl_port = false`);
        lines.push(`  minimum_tls_version = "1.2"`);
        break;
      }
      default: {
        // Generic property dump as comments
        for (const [key, value] of Object.entries(props)) {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            lines.push(`  # ${key} = ${JSON.stringify(value)}`);
          }
        }
      }
    }
  }

  private addBicepProperties(lines: string[], resource: PlannedResource): void {
    const props = resource.properties as Record<string, unknown>;

    switch (resource.type) {
      case "Microsoft.KeyVault/vaults":
        lines.push("  properties: {");
        lines.push(`    tenantId: subscription().tenantId`);
        lines.push("    sku: { family: 'A', name: 'standard' }");
        lines.push(`    enableSoftDelete: true`);
        lines.push(`    enablePurgeProtection: ${props.enablePurgeProtection ?? false}`);
        lines.push(`    enableRbacAuthorization: ${props.enableRbacAuthorization ?? true}`);
        lines.push("  }");
        break;
      case "Microsoft.Web/sites":
        lines.push("  properties: {");
        lines.push(`    httpsOnly: true`);
        lines.push("    siteConfig: {");
        lines.push("      alwaysOn: true");
        lines.push("      minTlsVersion: '1.2'");
        lines.push("    }");
        lines.push("  }");
        break;
      default:
        if (Object.keys(props).length > 0) {
          lines.push(`  properties: ${JSON.stringify(this.cleanProperties(props), null, 4).split("\n").map((l, i) => i === 0 ? l : `  ${l}`).join("\n")}`);
        }
    }
  }

  private cleanProperties(props: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private compareProperties(
    desired: Record<string, unknown>,
    actual: Record<string, unknown>,
    prefix: string,
    changes: DriftChange[],
  ): void {
    for (const [key, expectedValue] of Object.entries(desired)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const actualValue = actual[key];

      if (actualValue === undefined) {
        changes.push({ property: path, expectedValue, actualValue: "(missing)", severity: "medium" });
      } else if (typeof expectedValue === "object" && expectedValue !== null && typeof actualValue === "object" && actualValue !== null) {
        this.compareProperties(
          expectedValue as Record<string, unknown>,
          actualValue as Record<string, unknown>,
          path,
          changes,
        );
      } else if (JSON.stringify(expectedValue) !== JSON.stringify(actualValue)) {
        changes.push({
          property: path,
          expectedValue,
          actualValue,
          severity: this.classifyDriftSeverity(key),
        });
      }
    }
  }

  private classifyDriftSeverity(property: string): "low" | "medium" | "high" {
    const highSeverity = ["sku", "tier", "version", "enablePurgeProtection", "enableRbacAuthorization", "securityRules"];
    const lowSeverity = ["tags", "label", "description"];
    if (highSeverity.some((h) => property.includes(h))) return "high";
    if (lowSeverity.some((l) => property.includes(l))) return "low";
    return "medium";
  }
}

/** Create an IaC manager. */
export function createIaCManager(): AzureIaCManager {
  return new AzureIaCManager();
}
