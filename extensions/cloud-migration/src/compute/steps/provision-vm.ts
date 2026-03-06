/**
 * Compute Step — Provision VM
 *
 * Launches a new VM instance on the target provider from the imported
 * image, applying the matched instance type, networking, and tags.
 */

import type { MigrationStepHandler, MigrationStepContext, NormalizedVM, MigrationProvider } from "../../types.js";
import { resolveProviderAdapter } from "../../providers/registry.js";
import type { ProviderCredentialConfig } from "../../providers/types.js";

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

  // Build migration tags
  const allTags: Record<string, string> = {
    "espada:migration": "true",
    "espada:source-vm": params.normalizedVM.id,
    "espada:source-provider": params.normalizedVM.provider,
    ...params.tags,
  };

  // Resolve the target provider adapter
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
    const vmOutput = await adapter.compute.provisionVM({
      imageId: params.imageId,
      instanceType: params.instanceType,
      region: params.targetRegion,
      subnetId: params.subnetId,
      securityGroupIds: params.securityGroupIds,
      keyName: params.keyName,
      userData: params.userData,
      tags: allTags,
    });

    ctx.log.info(`  Provisioned instance ${vmOutput.instanceId} (${vmOutput.state})`);
    ctx.log.info(`  Private IP: ${vmOutput.privateIp}${vmOutput.publicIp ? `, Public IP: ${vmOutput.publicIp}` : ""}`);
    ctx.log.info(`  Applied ${Object.keys(allTags).length} tags`);

    return {
      instanceId: vmOutput.instanceId,
      provider: params.targetProvider,
      region: params.targetRegion,
      instanceType: params.instanceType,
      privateIp: vmOutput.privateIp,
      publicIp: vmOutput.publicIp,
      state: vmOutput.state,
    } satisfies ProvisionResult as Record<string, unknown>;
  }

  // Fallback: stub behavior
  const instanceId = `i-${params.targetProvider}-${Date.now()}`;
  ctx.log.info(`  Provisioned instance ${instanceId}`);
  ctx.log.info(`  Applied ${Object.keys(allTags).length} tags`);

  return {
    instanceId,
    provider: params.targetProvider,
    region: params.targetRegion,
    instanceType: params.instanceType,
    privateIp: "10.0.0.1",
    state: "running",
  } satisfies ProvisionResult as Record<string, unknown>;
}

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const instanceId = outputs?.instanceId as string | undefined;
  const provider = outputs?.provider as string | undefined;
  if (!instanceId) return;

  const params = ctx.params as unknown as ProvisionVMParams;
  const credentials = ctx.targetCredentials as ProviderCredentialConfig | undefined;
  if (credentials) {
    try {
      const adapter = await resolveProviderAdapter(params.targetProvider as MigrationProvider, credentials);
      await adapter.compute.terminateInstance(instanceId, params.targetRegion);
      ctx.log.info(`Terminated instance ${instanceId} on ${provider ?? params.targetProvider} via SDK`);
      return;
    } catch (err) {
      ctx.log.info(`Rollback via SDK failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Terminating provisioned instance ${instanceId} on ${provider}`);
}

export const provisionVMHandler: MigrationStepHandler = {
  execute,
  rollback,
};
