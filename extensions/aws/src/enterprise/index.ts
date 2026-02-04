/**
 * Enterprise Module Index
 *
 * Exports all enterprise features for multi-tenancy, billing, authentication,
 * and team collaboration.
 */

// Multi-Tenancy
export * from './tenant/types.js';
export * from './tenant/store.js';
export * from './tenant/manager.js';

// Billing & Metering
export * from './billing/types.js';
export * from './billing/service.js';

// Authentication
export * from './auth/types.js';
export * from './auth/jwt.js';
export * from './auth/saml.js';
export * from './auth/oidc.js';
export * from './auth/scim.js';

// Team Collaboration
export * from './collaboration/index.js';

// =============================================================================
// Enterprise Service Factory
// =============================================================================

import { createTenantStore, type TenantStoreConfig } from './tenant/store.js';
import { createTenantManager, type TenantManagerConfig } from './tenant/manager.js';
import { createBillingService } from './billing/service.js';
import type { BillingServiceConfig } from './billing/types.js';
import { createJWTManager, type JWTManagerConfig } from './auth/jwt.js';
import { createSAMLService, type SAMLServiceConfig } from './auth/saml.js';
import { createOIDCService, type OIDCServiceConfig } from './auth/oidc.js';
import { createSCIMService, type SCIMServiceConfig } from './auth/scim.js';
import { ROLE_PERMISSIONS } from './auth/types.js';
import { createWorkspaceManager, type WorkspaceManagerConfig } from './collaboration/workspace.js';
import { createApprovalService, type ApprovalServiceConfig } from './collaboration/approval.js';
import { createCommentService, type CommentServiceConfig } from './collaboration/comments.js';
import { createNotificationService, type NotificationServiceConfig } from './collaboration/notifications.js';
import { createTemplateService, type TemplateServiceConfig } from './collaboration/templates.js';
import { createSlackIntegrationService, type SlackServiceConfig } from './collaboration/integrations/slack.js';
import { createTeamsIntegrationService, type TeamsServiceConfig } from './collaboration/integrations/teams.js';

export interface EnterpriseConfig {
  tenantStore: TenantStoreConfig;
  tenantManager: Omit<TenantManagerConfig, 'store'>;
  billing: BillingServiceConfig;
  jwt: Pick<JWTManagerConfig, 'accessTokenSecret' | 'refreshTokenSecret'> & Partial<JWTManagerConfig>;
  saml?: Pick<SAMLServiceConfig, 'spEntityId' | 'spCertificate' | 'spPrivateKey' | 'spAcsUrl'> & Partial<SAMLServiceConfig>;
  oidc?: Pick<OIDCServiceConfig, 'defaultRedirectUri'> & Partial<OIDCServiceConfig>;
  scim?: Pick<SCIMServiceConfig, 'baseUrl'> & Partial<SCIMServiceConfig>;
  workspace?: WorkspaceManagerConfig;
  approval?: ApprovalServiceConfig;
  comments?: CommentServiceConfig;
  notifications?: NotificationServiceConfig;
  templates?: TemplateServiceConfig;
  slack?: SlackServiceConfig;
  teams?: TeamsServiceConfig;
}

export interface EnterpriseServices {
  tenantStore: ReturnType<typeof createTenantStore>;
  tenantManager: ReturnType<typeof createTenantManager>;
  billing: ReturnType<typeof createBillingService>;
  jwt: ReturnType<typeof createJWTManager>;
  saml?: ReturnType<typeof createSAMLService>;
  oidc?: ReturnType<typeof createOIDCService>;
  scim?: ReturnType<typeof createSCIMService>;
  workspace: ReturnType<typeof createWorkspaceManager>;
  approval: ReturnType<typeof createApprovalService>;
  comments: ReturnType<typeof createCommentService>;
  notifications: ReturnType<typeof createNotificationService>;
  templates: ReturnType<typeof createTemplateService>;
  slack?: ReturnType<typeof createSlackIntegrationService>;
  teams?: ReturnType<typeof createTeamsIntegrationService>;
}

/** Create all enterprise services with a single configuration */
export function createEnterpriseServices(config: EnterpriseConfig): EnterpriseServices {
  const tenantStore = createTenantStore(config.tenantStore);
  const tenantManager = createTenantManager({ ...config.tenantManager, store: tenantStore } as TenantManagerConfig);
  const billing = createBillingService(config.billing);
  const jwt = createJWTManager(config.jwt);
  const saml = config.saml ? createSAMLService(config.saml) : undefined;
  const oidc = config.oidc ? createOIDCService(config.oidc) : undefined;
  const scim = config.scim ? createSCIMService(config.scim) : undefined;
  
  // Collaboration services
  const workspace = createWorkspaceManager(config.workspace);
  const approval = createApprovalService(config.approval);
  const comments = createCommentService(config.comments);
  const notifications = createNotificationService(config.notifications);
  const templates = createTemplateService(config.templates);
  const slack = config.slack ? createSlackIntegrationService(config.slack) : undefined;
  const teams = config.teams ? createTeamsIntegrationService(config.teams) : undefined;

  return { 
    tenantStore, tenantManager, billing, jwt, saml, oidc, scim,
    workspace, approval, comments, notifications, templates, slack, teams,
  };
}

// =============================================================================
// Middleware Helpers
// =============================================================================

export interface TenantContextRequest {
  headers?: { authorization?: string; 'x-tenant-id'?: string };
  user?: { tenantId: string; userId: string; role: string };
}

export async function extractTenantContext(
  services: EnterpriseServices,
  request: TenantContextRequest,
): Promise<{ tenantId: string; userId: string; role: string; permissions: string[] } | null> {
  if (request.user) {
    const permissions = ROLE_PERMISSIONS[request.user.role as keyof typeof ROLE_PERMISSIONS] ?? [];
    return { ...request.user, permissions };
  }

  const authHeader = request.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const result = await services.jwt.verifyAccessToken(authHeader.slice(7));
    if (result.success && result.data) {
      return {
        tenantId: result.data.tid,
        userId: result.data.sub,
        role: result.data.role,
        permissions: result.data.permissions,
      };
    }
  }

  return null;
}

export function hasPermission(permissions: string[], resource: string, action: string): boolean {
  return permissions.includes('*:*') || permissions.includes(`${resource}:*`) || permissions.includes(`${resource}:${action}`);
}

export function hasAllPermissions(permissions: string[], required: Array<{ resource: string; action: string }>): boolean {
  return required.every(r => hasPermission(permissions, r.resource, r.action));
}

export function hasAnyPermission(permissions: string[], required: Array<{ resource: string; action: string }>): boolean {
  return required.some(r => hasPermission(permissions, r.resource, r.action));
}
