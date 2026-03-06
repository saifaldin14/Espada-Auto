/**
 * Container Migration Step Handler
 *
 * Migrates container services (ECS/EKS → AKS/GKE/K8s) and container
 * registries (ECR → ACR/GCR/Artifact Registry).
 *
 * Uses resolveProviderAdapter() → adapter.containers to call real cloud APIs.
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationProvider } from "../../types.js";
import type { NormalizedContainerService } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

/** Maps ECS/EKS concepts → target equivalents. */
const CONTAINER_PLATFORM_MAP: Record<string, string> = {
  "ecs→aks": "Azure Container Instances / AKS Deployment",
  "ecs→gke": "GKE Deployment / Cloud Run",
  "ecs→kubernetes": "Kubernetes Deployment",
  "eks→aks": "AKS Managed Cluster",
  "eks→gke": "GKE Autopilot Cluster",
  "eks→kubernetes": "Self-managed Kubernetes",
};

export const migrateContainersHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    log.info(`[migrate-containers] Migrating container services from ${sourceProvider} → ${targetProvider}`);

    const services = (params.services ?? []) as Array<Record<string, unknown>>;
    const registryImages = (params.registryImages ?? []) as Array<Record<string, unknown>>;

    const migratedServices: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      targetType: string;
      taskDefinitions: number;
    }> = [];

    const migratedImages: Array<{
      sourceUri: string;
      targetUri: string;
      digest: string;
    }> = [];

    const warnings: string[] = [];

    const targetCreds = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    const targetAdapter = targetCreds
      ? await resolveProviderAdapter(targetProvider as MigrationProvider, targetCreds)
      : undefined;

    for (const svc of services) {
      const sourceType = String(svc.type ?? "ecs");
      const platformKey = `${sourceType}→${getTargetPlatform(targetProvider)}`;
      const targetType = CONTAINER_PLATFORM_MAP[platformKey] ?? "Kubernetes Deployment";

      log.info(`[migrate-containers] Translating ${svc.name} (${sourceType}) → ${targetType}`);

      const serviceDefs = (svc.services ?? []) as Array<Record<string, unknown>>;

      if (targetAdapter) {
        const normalizedService: NormalizedContainerService = {
          id: String(svc.id ?? ""),
          name: String(svc.name ?? ""),
          provider: targetProvider,
          type: getTargetPlatform(targetProvider) as NormalizedContainerService["type"],
          region: String(svc.region ?? ""),
          clusterArn: svc.clusterArn as string | undefined,
          services: serviceDefs.map((sd) => translateServiceDef(sd, targetProvider)),
          nodeGroups: (svc.nodeGroups ?? []) as NormalizedContainerService["nodeGroups"],
          tags: (svc.tags ?? {}) as Record<string, string>,
        };

        const result = await targetAdapter.containers.createService(normalizedService);
        migratedServices.push({
          sourceId: String(svc.id),
          sourceName: String(svc.name),
          targetId: result.id,
          targetType,
          taskDefinitions: serviceDefs.length,
        });
      } else {
        migratedServices.push({
          sourceId: String(svc.id),
          sourceName: String(svc.name),
          targetId: `simulated-${svc.name}`,
          targetType,
          taskDefinitions: serviceDefs.length,
        });
      }

      if (sourceType === "ecs" && targetProvider !== "aws") {
        warnings.push(
          `ECS service "${svc.name}": Fargate launch type requires Kubernetes equivalent; ` +
          `review resource limits and service mesh configuration`,
        );
      }
    }

    // Migrate container images
    for (const img of registryImages) {
      const sourceUri = String(img.uri ?? img.sourceUri ?? "");
      const tag = String(img.tag ?? "latest");

      if (targetAdapter) {
        const result = await targetAdapter.containers.copyImage(
          sourceUri,
          String(params.targetRegistryUri ?? ""),
          tag,
        );
        migratedImages.push({ sourceUri, targetUri: `${params.targetRegistryUri}:${tag}`, digest: result.digest });
      } else {
        migratedImages.push({ sourceUri, targetUri: `target-registry/${tag}`, digest: "simulated" });
      }
    }

    log.info(
      `[migrate-containers] Migrated ${migratedServices.length} services, ${migratedImages.length} images`,
    );

    return {
      migratedServices,
      migratedImages,
      servicesCount: migratedServices.length,
      imagesCount: migratedImages.length,
      warnings,
      targetProvider,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const targetProvider = (outputs.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const migratedServices = (outputs.migratedServices ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-containers] Rolling back ${migratedServices.length} container services`);

    const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
    if (credentials) {
      const adapter = await resolveProviderAdapter(targetProvider as MigrationProvider, credentials);
      for (const svc of migratedServices) {
        await adapter.containers.deleteService(svc.targetId).catch(() => {});
      }
    }

    log.info("[migrate-containers] Rollback complete");
  },
};

function getTargetPlatform(provider: string): string {
  switch (provider) {
    case "azure": return "aks";
    case "gcp": return "gke";
    case "on-premises":
    case "vmware":
    case "nutanix":
      return "kubernetes";
    default: return "ecs";
  }
}

function translateServiceDef(def: Record<string, unknown>, targetProvider: string): any {
  const translated = { ...def };

  if (targetProvider !== "aws") {
    const cpu = Number(def.cpu ?? 256);
    translated.cpuMillicores = Math.round((cpu / 1024) * 1000);
    translated.memoryMiB = Number(def.memoryMB ?? def.memory ?? 512);
  }

  return translated;
}
