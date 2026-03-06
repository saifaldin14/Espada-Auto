/**
 * Container Migration Step Handler
 *
 * Migrates container services (ECS/EKS → AKS/GKE/K8s) and container
 * registries (ECR → ACR/GCR/Artifact Registry).
 *
 * This handler:
 *   1. Extracts service definitions from source (task defs, deployments)
 *   2. Translates to target-native format (ECS Task Def → K8s Deployment)
 *   3. Creates equivalent services on target
 *   4. Migrates container images between registries
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Maps ECS/EKS concepts → target equivalents. */
const CONTAINER_PLATFORM_MAP: Record<string, string> = {
  // Source (AWS ECS/EKS) → Target concepts
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

    // Migrate container services
    const targetAdapter = ctx.targetCredentials as
      | { containers?: {
          createService: (s: unknown) => Promise<{ id: string }>;
          copyImage: (src: string, tgt: string, tag: string) => Promise<{ digest: string }>;
        } }
      | undefined;

    for (const svc of services) {
      const sourceType = String(svc.type ?? "ecs");
      const platformKey = `${sourceType}→${getTargetPlatform(targetProvider)}`;
      const targetType = CONTAINER_PLATFORM_MAP[platformKey] ?? "Kubernetes Deployment";

      log.info(`[migrate-containers] Translating ${svc.name} (${sourceType}) → ${targetType}`);

      const serviceDefs = (svc.services ?? []) as Array<Record<string, unknown>>;

      if (targetAdapter?.containers) {
        const result = await targetAdapter.containers.createService({
          name: svc.name,
          type: getTargetPlatform(targetProvider),
          services: serviceDefs.map((sd) => translateServiceDef(sd, targetProvider)),
          nodeGroups: svc.nodeGroups,
        });
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

      // Note platform-specific warnings
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

      if (targetAdapter?.containers) {
        const result = await targetAdapter.containers.copyImage(sourceUri, String(params.targetRegistryUri ?? ""), tag);
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
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedServices = (outputs.migratedServices ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-containers] Rolling back ${migratedServices.length} container services`);

    const targetAdapter = ctx.targetCredentials as
      | { containers?: { deleteService: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.containers) {
      for (const svc of migratedServices) {
        await targetAdapter.containers.deleteService(svc.targetId);
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

function translateServiceDef(def: Record<string, unknown>, targetProvider: string): Record<string, unknown> {
  // Translate ECS task definition → K8s-style
  const translated = { ...def };

  if (targetProvider !== "aws") {
    // Convert ECS CPU units (1024 = 1 vCPU) → K8s millicores
    const cpu = Number(def.cpu ?? 256);
    translated.cpuMillicores = Math.round((cpu / 1024) * 1000);
    // Convert MiB → MiB (same unit, just make explicit)
    translated.memoryMiB = Number(def.memoryMB ?? def.memory ?? 512);
  }

  return translated;
}
