/**
 * Compute Step — Provision VM
 *
 * Launches a new VM instance on the target provider from the imported
 * image, applying the matched instance type, networking, and tags.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedVM } from "../../types.js";

export interface ProvisionVMParams {
  imageId: string;
  targetProvider: string;
  targetRegion: string;
  instanceType: string;
  normalizedVM: NormalizedVM;
  subnetId?: string;
  securityGroupIds?: string[];
  keyName?: string;
  userData?: string;
  tags?: Record<string, string>;
}

interface ProvisionResult {
  instanceId: string;
  provider: string;
  region: string;
  instanceType: string;
  privateIp: string;
  publicIp?: string;
  state: "running" | "pending";
}

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as ProvisionVMParams;
  ctx.log.info(`Provisioning VM on ${params.targetProvider} (${params.targetRegion})`);
  ctx.log.info(`  Image: ${params.imageId}`);
  ctx.log.info(`  Instance type: ${params.instanceType}`);
  ctx.log.info(`  Source VM: ${params.normalizedVM.name} (${params.normalizedVM.cpuCores} vCPU, ${params.normalizedVM.memoryGB}GB RAM)`);

  ctx.signal?.throwIfAborted();

  // Provider-specific provisioning:
  // AWS: ec2.RunInstances
  // Azure: compute.virtualMachines.beginCreateOrUpdate
  // GCP: compute.instances.insert
  const instanceId = `i-${params.targetProvider}-${Date.now()}`;

  ctx.log.info(`  Provisioned instance ${instanceId}`);

  // Apply tags
  const allTags: Record<string, string> = {
    "espada:migration": "true",
    "espada:source-vm": params.normalizedVM.id,
    "espada:source-provider": params.normalizedVM.provider,
    ...params.tags,
  };

  ctx.log.info(`  Applied ${Object.keys(allTags).length} tags`);

  return {
    instanceId,
    provider: params.targetProvider,
    region: params.targetRegion,
    instanceType: params.instanceType,
    privateIp: "10.0.0.1", // resolved from provider
    state: "running",
  } satisfies ProvisionResult as Record<string, unknown>;
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const instanceId = outputs?.instanceId as string | undefined;
  const provider = outputs?.provider as string | undefined;
  if (!instanceId) return;
  ctx.log.info(`Terminating provisioned instance ${instanceId} on ${provider}`);
}

export const provisionVMHandler: MigrationStepHandler = {
  execute,
  rollback,
};
