/**
 * Azure extension configuration schema (TypeBox) and default config.
 */

import { Type, type Static } from "@sinclair/typebox";

export const configSchema = Type.Object({
  defaultSubscription: Type.Optional(Type.String({ description: "Default Azure subscription ID" })),
  defaultRegion: Type.Optional(Type.String({ description: "Default Azure region (e.g. eastus)" })),
  defaultTenantId: Type.Optional(Type.String({ description: "Default Azure AD tenant ID" })),
  credentialMethod: Type.Optional(
    Type.String({
      description: "Credential method: default | cli | service-principal | managed-identity | interactive",
    })
  ),
  devOpsOrganization: Type.Optional(Type.String({ description: "Azure DevOps organization name" })),
  tagConfig: Type.Optional(
    Type.Object({
      requiredTags: Type.Optional(Type.Array(Type.String())),
      optionalTags: Type.Optional(Type.Array(Type.String())),
    })
  ),
  defaultTags: Type.Optional(
    Type.Array(Type.Object({ key: Type.String(), value: Type.String() }))
  ),
  retryConfig: Type.Optional(
    Type.Object({
      maxAttempts: Type.Optional(Type.Number()),
      minDelayMs: Type.Optional(Type.Number()),
      maxDelayMs: Type.Optional(Type.Number()),
    })
  ),
  diagnostics: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      verbose: Type.Optional(Type.Boolean()),
    })
  ),
});

export type AzureExtensionConfig = Static<typeof configSchema>;

export function getDefaultConfig(): AzureExtensionConfig {
  return {
    defaultRegion: "eastus",
    credentialMethod: "default",
    retryConfig: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 30000 },
    diagnostics: { enabled: false, verbose: false },
  };
}
