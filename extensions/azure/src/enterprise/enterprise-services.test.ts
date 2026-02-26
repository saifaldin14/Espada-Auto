import { describe, it, expect } from "vitest";
import {
  AzureTenantManager,
  AzureBillingService,
  AzureAuthManager,
  AzureCollaborationManager,
  AzureGitOpsManager,
  createEnterpriseServices,
} from "./enterprise-services.js";

function makeTenantConfig(tenantId: string, displayName: string) {
  return {
    tenantId,
    displayName,
    isolationLevel: "full" as const,
    subscriptions: ["sub-1"],
    policies: [],
    quotas: [],
    createdAt: new Date().toISOString(),
  };
}

describe("Enterprise Services", () => {
  describe("createEnterpriseServices factory", () => {
    it("creates all enterprise service instances", () => {
      const services = createEnterpriseServices("tenant-123");
      expect(services.tenantManager).toBeInstanceOf(AzureTenantManager);
      expect(services.billingService).toBeInstanceOf(AzureBillingService);
      expect(services.authManager).toBeInstanceOf(AzureAuthManager);
      expect(services.collaborationManager).toBeInstanceOf(AzureCollaborationManager);
      expect(services.gitOpsManager).toBeInstanceOf(AzureGitOpsManager);
    });
  });

  describe("AzureTenantManager", () => {
    it("switches tenant", () => {
      const mgr = new AzureTenantManager("default-tenant");
      // Must register tenant first; switching to unregistered returns null
      mgr.registerTenant(makeTenantConfig("new-tenant", "New Tenant"));
      const result = mgr.switchTenant("new-tenant");
      expect(result).not.toBeNull();
      expect(result!.activeTenantId).toBe("new-tenant");
      expect(result!.previousTenantId).toBe("default-tenant");
    });

    it("returns null when switching to unregistered tenant", () => {
      const mgr = new AzureTenantManager("default-tenant");
      const result = mgr.switchTenant("nonexistent");
      expect(result).toBeNull();
    });

    it("registers and lists tenants", () => {
      const mgr = new AzureTenantManager("default-tenant");
      mgr.registerTenant(makeTenantConfig("t1", "Tenant 1"));
      mgr.registerTenant(makeTenantConfig("t2", "Tenant 2"));
      const tenants = mgr.listTenants();
      expect(tenants.length).toBe(2);
    });

    it("sets tenant policy", () => {
      const mgr = new AzureTenantManager("default-tenant");
      mgr.registerTenant(makeTenantConfig("t1", "Tenant 1"));
      const result = mgr.setTenantPolicy("t1", {
        id: "policy-1",
        name: "Resource Limit",
        scope: "/subscriptions/sub-1",
        enforcementMode: "enabled",
        policyDefinitionId: "def-1",
      });
      expect(result).toBe(true);
    });

    it("gets tenant quotas", () => {
      const mgr = new AzureTenantManager("default-tenant");
      mgr.registerTenant(makeTenantConfig("t1", "Tenant 1"));
      const quotas = mgr.getTenantQuotas("t1");
      expect(quotas).toBeDefined();
      expect(Array.isArray(quotas)).toBe(true);
    });
  });

  describe("AzureBillingService", () => {
    it("gets billing account", async () => {
      const svc = new AzureBillingService();
      const account = await svc.getBillingAccount("sub-1");
      expect(account).toBeDefined();
      expect(account.id).toBeTruthy();
      expect(account.billingProfiles[0]?.currency).toBe("USD");
    });

    it("manages budgets", () => {
      const svc = new AzureBillingService();
      const budgetConfig = {
        name: "monthly-limit",
        amount: 1000,
        timeGrain: "Monthly" as const,
        startDate: "2024-01-01",
        notifications: [],
      };
      svc.setBudget("monthly-limit", budgetConfig);

      const fetched = svc.getBudget("monthly-limit");
      expect(fetched).toBeDefined();
      expect(fetched!.amount).toBe(1000);

      const budgets = svc.listBudgets();
      expect(budgets.length).toBe(1);

      svc.deleteBudget("monthly-limit");
      expect(svc.listBudgets()).toHaveLength(0);
    });

    it("gets cost forecast", async () => {
      const svc = new AzureBillingService();
      const forecast = await svc.getCostForecast("sub-1");
      expect(forecast).toBeDefined();
      expect(forecast.subscriptionId).toBe("sub-1");
      expect(forecast.currency).toBe("USD");
      expect(forecast.forecastedAt).toBeTruthy();
    });

    it("gets usage records", async () => {
      const svc = new AzureBillingService();
      const records = await svc.getUsageRecords("sub-1", "2024-01-01", "2024-01-31");
      expect(Array.isArray(records)).toBe(true);
    });
  });

  describe("AzureAuthManager", () => {
    it("configures SAML", () => {
      const mgr = new AzureAuthManager();
      // configureSaml returns void
      mgr.configureSaml({
        entityId: "https://idp.example.com",
        signOnUrl: "https://idp.example.com/sso",
        certificate: "cert-data",
        nameIdFormat: "email",
        attributeMappings: {},
        enabled: true,
      });
      const config = mgr.getAuthConfig();
      expect(config.saml).toBeDefined();
    });

    it("configures OIDC", () => {
      const mgr = new AzureAuthManager();
      mgr.configureOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "secret",
        scopes: ["openid", "profile"],
        redirectUri: "https://app.example.com/callback",
        responseType: "code",
        enabled: true,
      });
      const config = mgr.getAuthConfig();
      expect(config.oidc).toBeDefined();
    });

    it("configures SCIM", () => {
      const mgr = new AzureAuthManager();
      mgr.configureScim({
        endpoint: "https://scim.example.com",
        token: "token-123",
        syncInterval: 300,
        provisioningMode: "push",
        userMappings: {},
        groupMappings: {},
        enabled: true,
      });
      const config = mgr.getAuthConfig();
      expect(config.scim).toBeDefined();
    });

    it("toggles MFA", () => {
      const mgr = new AzureAuthManager();
      mgr.enableMfa(["totp", "sms"]);
      const config = mgr.getAuthConfig();
      expect(config.mfa.enabled).toBe(true);
      expect(config.mfa.methods).toContain("totp");
      mgr.disableMfa();
      const config2 = mgr.getAuthConfig();
      expect(config2.mfa.enabled).toBe(false);
    });

    it("adds conditional access policy", () => {
      const mgr = new AzureAuthManager();
      // addConditionalAccessPolicy returns void
      mgr.addConditionalAccessPolicy({
        id: "cap-1",
        name: "Block from unknown locations",
        state: "enabled",
        conditions: { locations: ["unknown"] },
        grantControls: ["mfa"],
      });
      const config = mgr.getAuthConfig();
      expect(config.conditionalAccess.length).toBe(1);
      expect(config.conditionalAccess[0]?.name).toBe("Block from unknown locations");
    });
  });

  describe("AzureCollaborationManager", () => {
    it("creates workspace", () => {
      const mgr = new AzureCollaborationManager();
      const ws = mgr.createWorkspace({
        name: "platform-team",
        description: "Platform team workspace",
        ownerId: "user-1",
        members: [],
        subscriptions: [],
        resourceGroups: [],
        tags: {},
      });
      expect(ws.id).toBeTruthy();
      expect(ws.name).toBe("platform-team");
    });

    it("adds workspace member", () => {
      const mgr = new AzureCollaborationManager();
      const ws = mgr.createWorkspace({
        name: "team",
        description: "Test",
        ownerId: "user-1",
        members: [],
        subscriptions: [],
        resourceGroups: [],
        tags: {},
      });
      const result = mgr.addWorkspaceMember(ws.id, {
        userId: "user-2",
        email: "user@example.com",
        role: "contributor",
        addedAt: new Date().toISOString(),
      });
      expect(result).toBe(true);
    });

    it("creates and processes approval flow", () => {
      const mgr = new AzureCollaborationManager();
      const flow = mgr.createApprovalFlow({
        name: "deployment-approval",
        resourceScope: "/subscriptions/sub-1",
        stages: [{ order: 1, approvers: ["mgr-1"], requiredApprovals: 1 }],
        enabled: true,
      });
      expect(flow.id).toBeTruthy();

      const request = mgr.submitApprovalRequest(flow.id, "dev-1", "deploy", "app-1");
      expect(request).not.toBeNull();
      expect(request!.id).toBeTruthy();
      expect(request!.status).toBe("pending");

      const processed = mgr.processApproval(request!.id, "mgr-1", "approved", "Looks good");
      expect(processed).toBeDefined();
      expect(processed!.status).toBe("approved");
    });

    it("adds comment", () => {
      const mgr = new AzureCollaborationManager();
      const comment = mgr.addComment("resource-1", "user-1", "This looks good");
      expect(comment.id).toBeTruthy();
      expect(comment.content).toBe("This looks good");
    });

    it("gets notifications", () => {
      const mgr = new AzureCollaborationManager();
      const notifs = mgr.getNotifications("user-1");
      expect(Array.isArray(notifs)).toBe(true);
    });
  });

  describe("AzureGitOpsManager", () => {
    const gitOpsConfig = {
      repositoryUrl: "https://github.com/org/infra",
      branch: "main",
      path: "/environments/prod",
      syncInterval: 300,
      autoSync: true,
      prune: false,
      selfHeal: true,
      sourceType: "git" as const,
    };

    it("configures repository", () => {
      const mgr = new AzureGitOpsManager();
      // configureRepository returns void
      mgr.configureRepository("prod-infra", gitOpsConfig);
      const config = mgr.getConfiguration("prod-infra");
      expect(config).toBeDefined();
      expect(config!.repositoryUrl).toBe("https://github.com/org/infra");
    });

    it("triggers sync", () => {
      const mgr = new AzureGitOpsManager();
      mgr.configureRepository("prod-infra", gitOpsConfig);
      const sync = mgr.triggerSync("prod-infra");
      expect(sync).not.toBeNull();
      expect(sync!.id).toBeTruthy();
      expect(sync!.status).toBeTruthy();
    });

    it("gets sync status", () => {
      const mgr = new AzureGitOpsManager();
      mgr.configureRepository("prod-infra", gitOpsConfig);
      mgr.triggerSync("prod-infra");
      const status = mgr.getSyncStatus("prod-infra");
      expect(status).toBeDefined();
    });

    it("gets sync history", () => {
      const mgr = new AzureGitOpsManager();
      mgr.configureRepository("prod-infra", gitOpsConfig);
      mgr.triggerSync("prod-infra");
      const history = mgr.getSyncHistory("prod-infra");
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });
  });
});
