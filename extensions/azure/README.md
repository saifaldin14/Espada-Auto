# @espada/azure — Azure Core Services Extension

A comprehensive Azure infrastructure management plugin for [Espada](https://github.com/espada-platform/espada), modelled after the AWS extension. Provides CLI commands, gateway methods, and agent tools for managing Azure resources.

## Features

- **30+ Azure service modules** covering compute, data, networking, security, operations, messaging, AI, and governance
- **Multiple authentication methods** — DefaultAzureCredential, CLI, Service Principal, Managed Identity, Interactive Browser
- **Enterprise-grade** — management groups, Lighthouse, multi-tenant, compliance frameworks
- **Built-in retry logic** with exponential backoff for all Azure SDK calls
- **Diagnostics & progress tracking** infrastructure
- **Client pooling** with TTL-based eviction
- **Agent tools** for AI-powered Azure management
- **Gateway methods** for programmatic access from the Espada gateway

## Installation

The extension is part of the Espada workspace. From the repo root:

```bash
pnpm install
```

## Configuration

Set via `espada config set` or the plugin config object:

| Key | Description | Default |
|-----|-------------|---------|
| `defaultSubscription` | Azure subscription ID | — |
| `defaultRegion` | Azure region | `eastus` |
| `defaultTenantId` | Azure AD tenant ID | — |
| `credentialMethod` | Auth method (`default`, `cli`, `service-principal`, `managed-identity`, `interactive`) | `default` |
| `devOpsOrganization` | Azure DevOps org name | — |
| `retryConfig.maxAttempts` | Max retry attempts | `3` |
| `retryConfig.minDelayMs` | Min retry delay (ms) | `100` |
| `retryConfig.maxDelayMs` | Max retry delay (ms) | `30000` |
| `diagnostics.enabled` | Enable diagnostics events | `false` |
| `tagConfig.requiredTags` | Required tags for resources | — |
| `defaultTags` | Tags applied to all created resources | — |

## CLI Commands

All commands are under `espada azure` (or `az`):

```
espada azure status                          # Show connection status
espada azure vm list [--resource-group <rg>]  # List VMs
espada azure vm start <rg> <name>             # Start a VM
espada azure vm stop <rg> <name>              # Stop a VM
espada azure vm restart <rg> <name>           # Restart a VM
espada azure storage list [--resource-group]  # List storage accounts
espada azure storage blobs <rg> <acct> <cont> # List blobs
espada azure rg list                          # List resource groups
espada azure functions list [--resource-group] # List function apps
espada azure aks list [--resource-group]       # List AKS clusters
espada azure keyvault list [--resource-group]  # List key vaults
espada azure sql list [--resource-group]       # List SQL servers
espada azure cost query [--timeframe ...]      # Query costs
espada azure subscription list                 # List subscriptions
```

## Agent Tools

The extension registers the following tools for AI agent use:

| Tool | Description |
|------|-------------|
| `azure_list_vms` | List virtual machines |
| `azure_start_vm` | Start a VM |
| `azure_stop_vm` | Stop a VM |
| `azure_list_storage_accounts` | List storage accounts |
| `azure_list_blobs` | List blobs in a container |
| `azure_list_resource_groups` | List resource groups |
| `azure_list_functions` | List function apps |
| `azure_list_aks_clusters` | List AKS clusters |
| `azure_list_sql_servers` | List SQL servers |
| `azure_list_keyvaults` | List key vaults |
| `azure_query_costs` | Query cost data |
| `azure_list_subscriptions` | List subscriptions |
| `azure_get_metrics` | Get Azure Monitor metrics |
| `azure_list_security_alerts` | List Defender alerts |
| `azure_compliance_report` | Generate compliance report |
| `azure_deploy_arm_template` | Deploy ARM template |
| `azure_list_ai_deployments` | List AI/OpenAI deployments |

## Gateway Methods

Available via `api.registerGatewayMethod`:

`azure.status`, `azure.vm.list`, `azure.vm.start`, `azure.vm.stop`, `azure.storage.list`, `azure.rg.list`, `azure.functions.list`, `azure.aks.list`, `azure.sql.list`, `azure.keyvault.list`, `azure.cost.query`, `azure.subscriptions.list`, `azure.monitor.metrics`, `azure.security.scores`, `azure.compliance.report`

## Module Reference

### Core

| Module | File | Description |
|--------|------|-------------|
| Types | `src/types.ts` | Core type definitions (regions, retry options, pagination) |
| Retry | `src/retry.ts` | `withAzureRetry()` exponential-backoff + error formatting |
| Diagnostics | `src/diagnostics.ts` | Event-based diagnostics & instrumented client wrapper |
| Progress | `src/progress.ts` | Progress reporters for long-running operations |

### Credentials & Infrastructure

| Module | Directory | Description |
|--------|-----------|-------------|
| Credentials | `src/credentials/` | `AzureCredentialsManager` — 5 auth methods, token caching |
| CLI Wrapper | `src/cli/` | `AzureCLIWrapper` — wraps `az` CLI for fallback operations |
| Client Pool | `src/client-pool/` | `AzureClientPool` — cached SDK clients with TTL eviction |
| Context | `src/context/` | `AzureContextManager` — tenant/subscription context |
| Discovery | `src/discovery/` | `AzureServiceDiscovery` — resource provider enumeration |
| Tagging | `src/tagging/` | `AzureTaggingManager` — resource tagging operations |
| Activity Log | `src/activitylog/` | `AzureActivityLogManager` — activity/audit logs |

### Compute

| Module | Manager | Key Methods |
|--------|---------|-------------|
| VMs | `AzureVMManager` | `listInstances`, `startInstance`, `stopInstance`, `restartInstance`, `deallocateInstance`, `resizeInstance`, `listSizes`, `getMetrics` |
| Functions | `AzureFunctionsManager` | `listFunctionApps`, `getFunctionApp`, `listFunctions`, `restartFunctionApp`, `getAppSettings` |
| Containers | `AzureContainerManager` | `listClusters`, `getCluster`, `listNodePools`, `listContainerInstances`, `listRegistries` |

### Data

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Storage | `AzureStorageManager` | `listStorageAccounts`, `listContainers`, `listBlobs`, `generateSasUrl`, `getMetrics` |
| SQL | `AzureSQLManager` | `listServers`, `listDatabases`, `listFirewallRules`, `listElasticPools` |
| Cosmos DB | `AzureCosmosDBManager` | `listAccounts`, `getAccount`, `listDatabases`, `listCollections` |
| Redis | `AzureRedisManager` | `listCaches`, `getCache`, `listFirewallRules`, `getKeys`, `regenerateKey` |

### Networking

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Network | `AzureNetworkManager` | `listVnets`, `listSubnets`, `listNSGs`, `listLoadBalancers`, `listPublicIPs` |
| DNS | `AzureDNSManager` | `listZones`, `getZone`, `listRecordSets`, `createRecordSet`, `deleteRecordSet` |
| CDN | `AzureCDNManager` | `listProfiles`, `listEndpoints`, `listCustomDomains`, `purgeContent` |

### Security & Identity

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Key Vault | `AzureKeyVaultManager` | `listVaults`, `listSecrets`, `getSecret`, `setSecret`, `listKeys` |
| IAM | `AzureIAMManager` | `listRoleDefinitions`, `listRoleAssignments`, `createRoleAssignment`, `deleteRoleAssignment` |
| Security | `AzureSecurityManager` | `getSecureScores`, `listAssessments`, `listAlerts`, `listRecommendations` |
| Policy | `AzurePolicyManager` | `listDefinitions`, `listAssignments`, `createAssignment`, `getComplianceState` |

### Operations

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Monitor | `AzureMonitorManager` | `listMetrics`, `listAlertRules`, `listLogAnalyticsWorkspaces`, `listDiagnosticSettings` |
| Cost | `AzureCostManager` | `queryCosts`, `getForecast`, `listBudgets` |
| Backup | `AzureBackupManager` | `listVaults`, `listBackupPolicies`, `listBackupItems`, `listBackupJobs` |
| Automation | `AzureAutomationManager` | `listAccounts`, `listRunbooks`, `startRunbook`, `listJobs`, `listSchedules` |

### Messaging

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Service Bus | `AzureServiceBusManager` | `listNamespaces`, `listQueues`, `listTopics`, `listSubscriptions`, `createQueue`, `deleteQueue` |
| Event Grid | `AzureEventGridManager` | `listTopics`, `listEventSubscriptions`, `listDomains`, `listSystemTopics` |

### AI

| Module | Manager | Key Methods |
|--------|---------|-------------|
| AI Services | `AzureAIManager` | `listAccounts`, `getAccount`, `listDeployments`, `listModels`, `getKeys` |

### Platform

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Resources | `AzureResourceManager` | `listResourceGroups`, `createResourceGroup`, `deleteResourceGroup`, `listDeployments`, `createDeployment`, `validateDeployment`, `listResources` |
| Subscriptions | `AzureSubscriptionManager` | `listSubscriptions`, `getSubscription`, `listTenants`, `listLocations` |
| Logic Apps | `AzureLogicAppsManager` | `listWorkflows`, `getWorkflow`, `listRuns`, `listTriggers`, `enableWorkflow`, `disableWorkflow` |
| API Management | `AzureAPIManagementManager` | `listServices`, `listAPIs`, `listProducts`, `listSubscriptions` |
| DevOps | `AzureDevOpsManager` | `listProjects`, `listPipelines`, `listRuns`, `triggerPipeline`, `listRepositories` |

### Governance

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Guardrails | `AzureGuardrailsManager` | `addRule`, `removeRule`, `validateOperation`, `setProtection`, `isOperationAllowed` |
| Compliance | `AzureComplianceManager` | `listFrameworks`, `getComplianceStatus`, `listViolations`, `generateReport` (CIS, NIST, PCI-DSS, HIPAA, ISO 27001, SOC 2) |

### Enterprise

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Enterprise | `AzureEnterpriseManager` | `listManagementGroups`, `getManagementGroup`, `listTenants`, `listSubscriptionsForTenant`, `listLighthouseDelegations`, `getEnrollmentInfo` |

## Architecture

```
extensions/azure/
├── index.ts                   # Plugin entry point (register CLI/tools/gateway/service lifecycle)
├── package.json               # Dependencies (~40 Azure SDK packages)
├── tsconfig.json
├── vitest.config.ts
├── espada.plugin.json         # Plugin metadata & capabilities
├── src/
│   ├── index.ts               # Barrel exports
│   ├── types.ts               # Core types
│   ├── retry.ts               # Retry logic with exponential backoff
│   ├── diagnostics.ts         # Diagnostics event system
│   ├── progress.ts            # Progress tracking
│   ├── credentials/           # Authentication (5 methods)
│   ├── cli/                   # Azure CLI wrapper
│   ├── client-pool/           # SDK client caching
│   ├── context/               # Tenant/subscription context
│   ├── discovery/             # Resource provider discovery
│   ├── tagging/               # Resource tagging
│   ├── activitylog/           # Activity/audit logs
│   ├── vms/                   # Virtual Machine management
│   ├── functions/             # Azure Functions
│   ├── containers/            # AKS + Container Instances + ACR
│   ├── storage/               # Blob/Queue/Table/File storage
│   ├── sql/                   # Azure SQL
│   ├── cosmosdb/              # Cosmos DB
│   ├── network/               # VNets, NSGs, LBs, PIPs
│   ├── keyvault/              # Key Vault
│   ├── monitor/               # Azure Monitor + Log Analytics
│   ├── iam/                   # RBAC + Service Principals
│   ├── cost/                  # Cost Management + Budgets
│   ├── servicebus/            # Service Bus
│   ├── eventgrid/             # Event Grid
│   ├── dns/                   # Azure DNS
│   ├── redis/                 # Azure Cache for Redis
│   ├── cdn/                   # Azure CDN
│   ├── security/              # Microsoft Defender for Cloud
│   ├── policy/                # Azure Policy
│   ├── backup/                # Azure Backup + Recovery Services
│   ├── ai/                    # Azure OpenAI / Cognitive Services
│   ├── devops/                # Azure DevOps (REST API)
│   ├── apimanagement/         # API Management
│   ├── logic/                 # Logic Apps
│   ├── resources/             # Resource Groups + ARM Deployments
│   ├── subscriptions/         # Subscription + Tenant management
│   ├── guardrails/            # Operation guardrails (in-memory rules)
│   ├── compliance/            # Compliance frameworks (6 built-in)
│   ├── automation/            # Azure Automation runbooks
│   └── enterprise/            # Multi-tenant + Management Groups + Lighthouse
```

## What's Complete

- [x] Plugin entry point with CLI commands, gateway methods, agent tools, and service lifecycle
- [x] 5 authentication methods via `AzureCredentialsManager`
- [x] 31 service modules with full type definitions
- [x] Core utilities (retry, diagnostics, progress tracking, client pooling)
- [x] Infrastructure support (CLI wrapper, context, discovery, tagging, activity log)
- [x] Barrel exports for all modules
- [x] Unit tests for core utilities (retry, diagnostics, progress, credentials)
- [x] Config schema with TypeBox
- [x] Enterprise module (management groups, Lighthouse, multi-tenant)

## What Still Needs Work

- [ ] **Unit tests for service modules** — Each manager needs `*.test.ts` with mocked Azure SDK clients
- [ ] **Integration / E2E tests** — Tests against real Azure subscriptions (`LIVE=1`)
- [ ] **Additional CLI commands** — Only major services have CLI wiring; remaining services (DNS, Redis, CDN, Policy, Backup, etc.) need CLI subcommands
- [ ] **Additional agent tools** — More tools for networking, DNS, Redis, CDN, backup, automation, etc.
- [ ] **Additional gateway methods** — More methods for services not yet exposed via gateway
- [ ] **DevOps PAT management** — Secure storage/retrieval of Azure DevOps personal access tokens
- [ ] **IDIO orchestration** — Intelligent orchestrator for multi-step Azure operations (e.g., "deploy a web app with SQL backend and CDN")
- [ ] **Docs page** — `docs/plugins/azure.md` for Mintlify docs site
- [ ] **GitHub labeler** — Update `.github/labeler.yml` for the `azure` extension path
- [ ] **Changelog entry** — Add entry to `CHANGELOG.md` when merging
- [ ] **Real-world validation** — Test all managers against live Azure subscriptions
- [ ] **Error handling refinement** — Service-specific error messages and recovery suggestions
- [ ] **Pagination support** — Not all list methods handle large result sets with continuation tokens
- [ ] **Tag enforcement** — Wire `tagConfig.requiredTags` into create operations automatically
- [ ] **Cost alerting** — Proactive cost anomaly detection and notification via gateway

## Dependencies

The extension uses ~40 Azure SDK packages. Key ones:

- `@azure/identity` — Authentication
- `@azure/arm-compute` — VMs
- `@azure/arm-storage` — Storage accounts
- `@azure/arm-network` — Networking
- `@azure/arm-keyvault` — Key Vault management
- `@azure/arm-resources` — Resource groups / ARM deployments
- `@azure/arm-monitor` — Monitoring / Log Analytics
- `@azure/arm-costmanagement` — Cost queries
- `@azure/arm-containerservice` — AKS
- `@azure/arm-sql` — SQL servers
- `@azure/arm-cosmosdb` — Cosmos DB
- `@azure/arm-cognitiveservices` — AI / OpenAI
- `@azure/arm-security` — Defender for Cloud
- `@azure/arm-policy` — Azure Policy
- `@azure/arm-managementgroups` — Management Groups (Enterprise)

See [`package.json`](./package.json) for the full list.

## License

Same as the parent Espada repository.
