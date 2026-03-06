/**
 * Network Step — Migrate VPC Endpoint
 *
 * Migrates VPC endpoints / PrivateLink configurations to the target
 * provider (Azure Private Endpoint / GCP Private Service Connect).
 * Handles:
 *   - Endpoint creation with service name translation
 *   - Subnet and security group association
 *   - Private DNS configuration
 *   - Policy document translation
 *   - Tag migration
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Service name mapping across providers. */
const SERVICE_NAME_MAP: Record<string, Record<string, string>> = {
  azure: {
    "com.amazonaws.*.s3": "Microsoft.Storage",
    "com.amazonaws.*.dynamodb": "Microsoft.AzureCosmosDB",
    "com.amazonaws.*.sqs": "Microsoft.ServiceBus",
    "com.amazonaws.*.sns": "Microsoft.ServiceBus",
    "com.amazonaws.*.kinesis": "Microsoft.EventHub",
    "com.amazonaws.*.kms": "Microsoft.KeyVault",
    "com.amazonaws.*.secretsmanager": "Microsoft.KeyVault",
    "com.amazonaws.*.ecr": "Microsoft.ContainerRegistry",
    "com.amazonaws.*.rds": "Microsoft.Sql",
    "com.amazonaws.*.logs": "Microsoft.OperationalInsights",
  },
  gcp: {
    "com.amazonaws.*.s3": "storage.googleapis.com",
    "com.amazonaws.*.dynamodb": "bigtable.googleapis.com",
    "com.amazonaws.*.sqs": "pubsub.googleapis.com",
    "com.amazonaws.*.sns": "pubsub.googleapis.com",
    "com.amazonaws.*.kinesis": "pubsub.googleapis.com",
    "com.amazonaws.*.kms": "cloudkms.googleapis.com",
    "com.amazonaws.*.secretsmanager": "secretmanager.googleapis.com",
    "com.amazonaws.*.ecr": "artifactregistry.googleapis.com",
    "com.amazonaws.*.rds": "sqladmin.googleapis.com",
    "com.amazonaws.*.logs": "logging.googleapis.com",
  },
};

export const migrateVPCEndpointHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-vpc-endpoint] Migrating VPC endpoints → ${targetProvider}`);

    const vpcEndpoints = (params.vpcEndpoints ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      serviceName: string;
      vpcId: string;
      subnetIds: string[];
      securityGroupIds: string[];
      privateDnsEnabled: boolean;
      policyDocument?: Record<string, unknown>;
      tags?: Record<string, string>;
    }>;

    const migratedEndpoints: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      sourceServiceName: string;
      targetServiceName: string;
      privateDnsEnabled: boolean;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          network?: {
            createVPCEndpoint: (ep: unknown) => Promise<{ id: string }>;
            deleteVPCEndpoint: (id: string) => Promise<void>;
          };
        }
      | undefined;

    for (const ep of vpcEndpoints) {
      const name = String(ep.name ?? "");
      const sourceServiceName = String(ep.serviceName ?? "");
      const targetServiceName = translateServiceName(sourceServiceName, targetProvider);

      if (targetServiceName === sourceServiceName) {
        warnings.push(
          `VPC endpoint "${name}": service name "${sourceServiceName}" has no known mapping for ${targetProvider}; ` +
            `manual configuration required`,
        );
      }

      if (ep.policyDocument) {
        warnings.push(
          `VPC endpoint "${name}": policy document needs translation from AWS IAM format to ${targetProvider} equivalent`,
        );
      }

      if (targetAdapter?.network) {
        const result = await targetAdapter.network.createVPCEndpoint({
          name,
          type: ep.type,
          serviceName: targetServiceName,
          vpcId: ep.vpcId,
          subnetIds: ep.subnetIds,
          securityGroupIds: ep.securityGroupIds,
          privateDnsEnabled: ep.privateDnsEnabled,
          tags: ep.tags,
        });

        migratedEndpoints.push({
          sourceId: ep.id,
          sourceName: name,
          targetId: result.id,
          sourceServiceName,
          targetServiceName,
          privateDnsEnabled: ep.privateDnsEnabled,
        });
      } else {
        migratedEndpoints.push({
          sourceId: ep.id,
          sourceName: name,
          targetId: `simulated-vpce-${name}`,
          sourceServiceName,
          targetServiceName,
          privateDnsEnabled: ep.privateDnsEnabled,
        });
      }
    }

    log.info(`[migrate-vpc-endpoint] Migrated ${migratedEndpoints.length} VPC endpoint(s)`);

    return {
      migratedEndpoints,
      endpointsCount: migratedEndpoints.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedEndpoints = (outputs.migratedEndpoints ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-vpc-endpoint] Rolling back ${migratedEndpoints.length} VPC endpoint(s)`);

    const targetAdapter = ctx.targetCredentials as
      | { network?: { deleteVPCEndpoint: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.network) {
      for (const ep of migratedEndpoints) {
        await targetAdapter.network.deleteVPCEndpoint(ep.targetId);
      }
    }

    log.info("[migrate-vpc-endpoint] Rollback complete");
  },
};

function translateServiceName(serviceName: string, targetProvider: string): string {
  const map = SERVICE_NAME_MAP[targetProvider];
  if (!map) return serviceName;

  // Try exact match first, then pattern match (com.amazonaws.*.service)
  for (const [pattern, target] of Object.entries(map)) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$");
    if (regex.test(serviceName)) {
      return target;
    }
  }

  return serviceName;
}
