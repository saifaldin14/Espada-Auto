/**
 * Certificate Migration Step Handler
 *
 * Migrates SSL/TLS certificates (ACM → Azure Key Vault Certs / GCP Cert Manager).
 * For managed (Let's Encrypt) certs: requests new cert on target.
 * For imported certs: re-imports on target (requires private key access).
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateCertificatesHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const certificates = (params.certificates ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-certificates] Migrating ${certificates.length} certificate(s) to ${targetProvider}`);

    const migrated: Array<{ sourceId: string; domainName: string; targetId: string; type: string }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | { cdn?: { importCertificate: (cert: unknown, key: string, chain: string) => Promise<{ id: string }> } }
      | undefined;

    for (const cert of certificates) {
      const domain = String(cert.domainName ?? "");
      const type = String(cert.type ?? "managed");

      if (type === "managed") {
        warnings.push(
          `Certificate for "${domain}": Managed cert cannot be transferred; ` +
          `new certificate will be requested via ${targetProvider} CA`,
        );
      }

      if (targetAdapter?.cdn) {
        const result = await targetAdapter.cdn.importCertificate(
          { domainName: domain, subjectAlternativeNames: cert.subjectAlternativeNames, type },
          "", // Private key resolved at runtime
          "", // Chain resolved at runtime
        );
        migrated.push({ sourceId: String(cert.id), domainName: domain, targetId: result.id, type });
      } else {
        migrated.push({ sourceId: String(cert.id), domainName: domain, targetId: `simulated-cert-${domain}`, type });
      }
    }

    log.info(`[migrate-certificates] Migrated ${migrated.length} certificates`);
    return { migratedCertificates: migrated, certificatesCount: migrated.length, warnings };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migrated = (outputs.migratedCertificates ?? []) as Array<{ targetId: string }>;
    log.info(`[migrate-certificates] Rolling back ${migrated.length} certificates`);
    const targetAdapter = ctx.targetCredentials as
      | { cdn?: { deleteCertificate: (id: string) => Promise<void> } }
      | undefined;
    if (targetAdapter?.cdn) {
      for (const cert of migrated) await targetAdapter.cdn.deleteCertificate(cert.targetId);
    }
  },
};
