/**
 * Azure Tagging Manager — Resource tag standardization and enforcement
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureTagSet } from "../types.js";
import { withAzureRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

export type TagConfig = {
  requiredTags?: string[];
  optionalTags?: string[];
  defaultTags?: Array<{ key: string; value: string }>;
};

export type TagValidationResult = {
  valid: boolean;
  missingRequired: string[];
  present: string[];
};

export type TagOperation = {
  resourceId: string;
  action: "merge" | "replace" | "delete";
  tags: AzureTagSet;
};

// =============================================================================
// Tagging Manager
// =============================================================================

export class AzureTaggingManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private config: TagConfig;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    config?: TagConfig,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.config = config ?? {};
  }

  /**
   * Validate tags against required tag configuration.
   */
  validateTags(tags: AzureTagSet): TagValidationResult {
    const required = this.config.requiredTags ?? [];
    const missingRequired = required.filter((t) => !(t in tags));

    return {
      valid: missingRequired.length === 0,
      missingRequired,
      present: Object.keys(tags),
    };
  }

  /**
   * Get default tags merged with provided tags.
   */
  getEffectiveTags(userTags?: AzureTagSet): AzureTagSet {
    const defaults: AzureTagSet = {};
    for (const dt of this.config.defaultTags ?? []) {
      defaults[dt.key] = dt.value;
    }
    return { ...defaults, ...userTags };
  }

  /**
   * Update tags on an Azure resource.
   */
  async updateResourceTags(operation: TagOperation): Promise<void> {
    const { credential } = await this.credentialsManager.getCredential();

    const { ResourceManagementClient } = await import("@azure/arm-resources");
    const client = new ResourceManagementClient(credential, this.subscriptionId);

    await withAzureRetry(async () => {
      if (operation.action === "merge") {
        await (client as any).tagsOperations.createOrUpdateAtScope(operation.resourceId, { // SDK typing gap
          properties: { tags: operation.tags },
        });
      } else if (operation.action === "replace") {
        await (client as any).tagsOperations.createOrUpdateAtScope(operation.resourceId, { // SDK typing gap
          properties: { tags: operation.tags },
        });
      } else if (operation.action === "delete") {
        await (client as any).tagsOperations.deleteAtScope(operation.resourceId); // SDK typing gap
      }
    });
  }

  /**
   * Get tags for a resource.
   */
  async getResourceTags(resourceId: string): Promise<AzureTagSet> {
    const { credential } = await this.credentialsManager.getCredential();

    const { ResourceManagementClient } = await import("@azure/arm-resources");
    const client = new ResourceManagementClient(credential, this.subscriptionId);

    return withAzureRetry(async () => {
      const result = await (client as any).tagsOperations.getAtScope(resourceId); // SDK typing gap
      return (result.properties?.tags ?? {}) as AzureTagSet;
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTaggingManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  config?: TagConfig,
): AzureTaggingManager {
  return new AzureTaggingManager(credentialsManager, subscriptionId, config);
}
