# @espada/azure — Azure Core Services Extension

A comprehensive Azure infrastructure management plugin for [Espada](https://github.com/espada-platform/espada), modelled after the AWS extension. Provides CLI commands, gateway methods, and agent tools for managing Azure resources.

## Features

- **30+ Azure service modules** covering compute, data, networking, security, operations, messaging, AI, and governance
- **IDIO orchestration engine** — DAG-based planner for multi-step Azure deployments (e.g., "deploy a web app with SQL backend and CDN")
- **Advisor** — project analyzer + recommendation engine that maps detected stacks to Azure services and blueprints ("set up a server for this app")
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
# Core
espada azure status                                    # Show connection status
espada azure subscription list                         # List subscriptions
espada azure rg list                                   # List resource groups

# Compute
espada azure vm list [--resource-group <rg>]            # List VMs
espada azure vm start <rg> <name>                       # Start a VM
espada azure vm stop <rg> <name>                        # Stop a VM
espada azure vm restart <rg> <name>                     # Restart a VM
espada azure functions list [--resource-group]          # List function apps
espada azure aks list [--resource-group]                 # List AKS clusters

# Data
espada azure storage list [--resource-group]            # List storage accounts
espada azure storage containers <rg> <acct>             # List containers
espada azure sql list [--resource-group]                 # List SQL servers
espada azure cosmosdb list [--resource-group]            # List Cosmos DB accounts
espada azure cosmosdb databases <rg> <acct>              # List databases in account
espada azure redis list [--resource-group]               # List Redis caches
espada azure redis info <rg> <cacheName>                 # Get Redis cache details

# Networking
espada azure network vnet list [--resource-group]        # List VNets
espada azure network nsg list [--resource-group]         # List NSGs
espada azure network lb list [--resource-group]          # List load balancers
espada azure network pip list [--resource-group]         # List public IPs
espada azure dns zones [--resource-group]                # List DNS zones
espada azure dns records <rg> <zone>                     # List DNS records
espada azure cdn profiles [--resource-group]             # List CDN profiles
espada azure cdn endpoints <rg> <profile>                # List CDN endpoints

# Security & Identity
espada azure keyvault list [--resource-group]            # List key vaults
espada azure security scores                             # Show secure scores
espada azure security alerts [--resource-group]          # List security alerts
espada azure security recommendations                    # List recommendations
espada azure iam roles [--scope <scope>]                 # List role definitions
espada azure iam assignments [--scope <scope>]           # List role assignments
espada azure policy definitions                          # List policy definitions
espada azure policy assignments [--scope <scope>]        # List policy assignments
espada azure policy compliance [--scope <scope>]         # Show compliance state

# Operations
espada azure cost query [--timeframe ...]                # Query costs
espada azure backup vaults [--resource-group]            # List Recovery vaults
espada azure backup items <rg> <vault>                   # List backup items
espada azure backup jobs <rg> <vault>                    # List backup jobs
espada azure automation accounts [--resource-group]      # List Automation accounts
espada azure automation runbooks <rg> <acct>             # List runbooks
espada azure automation jobs <rg> <acct>                 # List automation jobs

# Messaging
espada azure servicebus list [--resource-group]          # List SB namespaces
espada azure servicebus queues <rg> <ns>                 # List queues
espada azure servicebus topics <rg> <ns>                 # List topics
espada azure eventgrid topics [--resource-group]         # List EG topics
espada azure eventgrid domains [--resource-group]        # List EG domains

# Platform
espada azure logic list [--resource-group]               # List Logic App workflows
espada azure logic runs <rg> <workflow>                  # List workflow runs
espada azure logic enable <rg> <workflow>                # Enable workflow
espada azure logic disable <rg> <workflow>               # Disable workflow
espada azure apim list [--resource-group]                # List APIM services
espada azure apim apis <rg> <service>                    # List APIs
espada azure devops projects                             # List DevOps projects
espada azure devops pipelines <project>                  # List pipelines
espada azure devops repos <project>                      # List repositories
espada azure devops pat list [--org <org>]               # List stored PATs
espada azure devops pat store --token <t> --label <l>    # Store a PAT securely
espada azure devops pat delete <id>                      # Delete a stored PAT
espada azure devops pat validate [id]                    # Validate PAT(s)
espada azure devops pat rotate <id> --token <new>        # Rotate a PAT
espada azure devops pat check-expiry                     # Check PAT expiry
```

## Agent Tools

The extension registers **81 tools** for AI agent use:

### Compute & Core
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

### Networking
| Tool | Description |
|------|-------------|
| `azure_list_vnets` | List virtual networks |
| `azure_list_nsgs` | List network security groups |
| `azure_list_load_balancers` | List load balancers |
| `azure_list_public_ips` | List public IP addresses |
| `azure_list_subnets` | List subnets in a VNet |
| `azure_list_nsg_rules` | List rules in an NSG |

### DNS
| Tool | Description |
|------|-------------|
| `azure_list_dns_zones` | List DNS zones |
| `azure_list_dns_records` | List DNS record sets in a zone |

### Redis
| Tool | Description |
|------|-------------|
| `azure_list_redis_caches` | List Redis caches |
| `azure_get_redis_cache` | Get Redis cache details |

### CDN
| Tool | Description |
|------|-------------|
| `azure_list_cdn_profiles` | List CDN profiles |
| `azure_list_cdn_endpoints` | List CDN endpoints |
| `azure_purge_cdn` | Purge CDN endpoint content |

### Backup
| Tool | Description |
|------|-------------|
| `azure_list_backup_vaults` | List Recovery Services vaults |
| `azure_list_backup_items` | List backup items |
| `azure_list_backup_jobs` | List backup jobs |

### Automation
| Tool | Description |
|------|-------------|
| `azure_list_automation_accounts` | List Automation accounts |
| `azure_list_runbooks` | List runbooks |
| `azure_start_runbook` | Start a runbook |

### Service Bus
| Tool | Description |
|------|-------------|
| `azure_list_servicebus_namespaces` | List SB namespaces |
| `azure_list_servicebus_queues` | List SB queues |
| `azure_list_servicebus_topics` | List SB topics |

### Event Grid
| Tool | Description |
|------|-------------|
| `azure_list_eventgrid_topics` | List EG topics |
| `azure_list_eventgrid_domains` | List EG domains |
| `azure_list_event_subscriptions` | List event subscriptions |

### CosmosDB
| Tool | Description |
|------|-------------|
| `azure_list_cosmosdb_accounts` | List Cosmos DB accounts |
| `azure_list_cosmosdb_databases` | List databases in an account |

### IAM
| Tool | Description |
|------|-------------|
| `azure_list_role_definitions` | List RBAC role definitions |
| `azure_list_role_assignments` | List RBAC role assignments |

### Policy
| Tool | Description |
|------|-------------|
| `azure_list_policy_definitions` | List policy definitions |
| `azure_list_policy_assignments` | List policy assignments |
| `azure_policy_compliance` | Get policy compliance state |

### Logic Apps
| Tool | Description |
|------|-------------|
| `azure_list_logic_apps` | List Logic App workflows |
| `azure_list_logic_runs` | List workflow runs |
| `azure_enable_logic_app` | Enable a workflow |
| `azure_disable_logic_app` | Disable a workflow |

### API Management
| Tool | Description |
|------|-------------|
| `azure_list_apim_services` | List APIM services |
| `azure_list_apim_apis` | List APIs in an APIM instance |

### DevOps
| Tool | Description |
|------|-------------|
| `azure_list_devops_projects` | List DevOps projects |
| `azure_list_devops_pipelines` | List pipelines |
| `azure_trigger_devops_pipeline` | Trigger a pipeline run |
| `azure_list_devops_repos` | List repositories |

### DevOps PAT Management
| Tool | Description |
|------|-------------|
| `azure_list_pats` | List stored PATs (metadata only, no secrets) |
| `azure_store_pat` | Securely store a PAT with AES-256-GCM encryption |
| `azure_delete_pat` | Delete a stored PAT by ID |
| `azure_validate_pat` | Validate a PAT against the DevOps API |
| `azure_rotate_pat` | Rotate a stored PAT with a new token value |
| `azure_get_pat_token` | Retrieve the best available PAT for an organization |
| `azure_check_pat_expiry` | Check for expired or expiring-soon PATs |

### Security (Additional)
| Tool | Description |
|------|-------------|
| `azure_list_security_recommendations` | List Defender recommendations |
| `azure_get_secure_scores` | Get Defender secure scores |

### Activity Log & AI
| Tool | Description |
|------|-------------|
| `azure_get_activity_log` | Get activity log events |
| `azure_list_ai_accounts` | List Cognitive / OpenAI accounts |
| `azure_list_ai_models` | List available AI models |

### Enterprise & Tagging
| Tool | Description |
|------|-------------|
| `azure_list_management_groups` | List management groups |
| `azure_get_resource_tags` | Get resource tags |
| `azure_update_resource_tags` | Update resource tags |
| `azure_validate_tags` | Validate tags against policy |

### IDIO Orchestration
| Tool | Description |
|------|-------------|
| `azure_list_blueprints` | List available deployment blueprints |
| `azure_get_blueprint` | Get blueprint details and generated plan |
| `azure_generate_plan` | Generate an execution plan from a blueprint |
| `azure_validate_plan` | Validate a plan's DAG structure and parameters |
| `azure_execute_plan` | Execute a validated plan (with dry-run support) |
| `azure_run_blueprint` | One-shot: generate, validate, and execute a blueprint |

### Advisor
| Tool | Description |
|------|-------------|
| `azure_analyze_project` | Scan a project directory to detect language, framework, dependencies, and signals |
| `azure_recommend_services` | Analyze a project and recommend Azure services + blueprint match |
| `azure_analyze_and_deploy` | End-to-end: analyze → recommend → blueprint → plan → execute |

## Gateway Methods

Available via `api.registerGatewayMethod` (**70 methods**):

**Core:** `azure.status`, `azure.vm.list`, `azure.vm.start`, `azure.vm.stop`, `azure.storage.list`, `azure.rg.list`, `azure.functions.list`, `azure.aks.list`, `azure.sql.list`, `azure.keyvault.list`, `azure.cost.query`, `azure.subscriptions.list`, `azure.monitor.metrics`, `azure.security.scores`, `azure.compliance.report`

**Networking:** `azure.network.vnets`, `azure.network.nsgs`, `azure.network.lbs`, `azure.network.pips`

**DNS:** `azure.dns.zones`, `azure.dns.records`

**Redis:** `azure.redis.list`, `azure.redis.get`

**CDN:** `azure.cdn.profiles`, `azure.cdn.endpoints`

**CosmosDB:** `azure.cosmosdb.list`, `azure.cosmosdb.databases`

**Service Bus:** `azure.servicebus.list`, `azure.servicebus.queues`, `azure.servicebus.topics`

**Event Grid:** `azure.eventgrid.topics`, `azure.eventgrid.domains`

**IAM:** `azure.iam.roles`, `azure.iam.assignments`

**Policy:** `azure.policy.definitions`, `azure.policy.assignments`, `azure.policy.compliance`

**Backup:** `azure.backup.vaults`, `azure.backup.items`, `azure.backup.jobs`

**Automation:** `azure.automation.accounts`, `azure.automation.runbooks`, `azure.automation.jobs`

**Logic Apps:** `azure.logic.list`, `azure.logic.runs`

**API Management:** `azure.apim.list`, `azure.apim.apis`

**DevOps:** `azure.devops.projects`, `azure.devops.pipelines`, `azure.devops.repos`

**DevOps PAT:** `azure.devops.pat.list`, `azure.devops.pat.store`, `azure.devops.pat.delete`, `azure.devops.pat.validate`, `azure.devops.pat.token`, `azure.devops.pat.checkExpiry`

**AI:** `azure.ai.accounts`, `azure.ai.deployments`, `azure.ai.models`

**Activity Log:** `azure.activitylog.events`

**Security:** `azure.security.alerts`, `azure.security.recommendations`

**Orchestration:** `azure.orchestration.listBlueprints`, `azure.orchestration.getBlueprint`, `azure.orchestration.generatePlan`, `azure.orchestration.executePlan`, `azure.orchestration.runBlueprint`

**Advisor:** `azure.advisor.analyze`, `azure.advisor.recommend`, `azure.advisor.analyzeAndDeploy`

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
| DevOps PAT | `DevOpsPATManager` | `storePAT`, `listPATs`, `getPAT`, `decryptPAT`, `deletePAT`, `rotatePAT`, `validatePAT`, `validateAll`, `checkExpiry`, `purgeExpired`, `getTokenForOrganization`, `findByLabel`, `clearAll` |

### Governance

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Guardrails | `AzureGuardrailsManager` | `addRule`, `removeRule`, `validateOperation`, `setProtection`, `isOperationAllowed` |
| Compliance | `AzureComplianceManager` | `listFrameworks`, `getComplianceStatus`, `listViolations`, `generateReport` (CIS, NIST, PCI-DSS, HIPAA, ISO 27001, SOC 2) |

### Enterprise

| Module | Manager | Key Methods |
|--------|---------|-------------|
| Enterprise | `AzureEnterpriseManager` | `listManagementGroups`, `getManagementGroup`, `listTenants`, `listSubscriptionsForTenant`, `listLighthouseDelegations`, `getEnrollmentInfo` |

### Orchestration

| Module | Class / Export | Key Exports |
|--------|---------------|-------------|
| Registry | `StepRegistry` | `registerStepType`, `getStepDefinition`, `getStepHandler`, `listStepTypes` |
| Planner | `PlanValidator` | `validatePlan`, `topologicalSort`, `resolveStepParams`, `evaluateCondition` |
| Engine | `Orchestrator` | `orchestrate(plan, options?, listener?)`, event streaming, rollback |
| Blueprints | `BlueprintLibrary` | `getBlueprint`, `listBlueprints`, `generatePlanFromBlueprint` |
| Steps | `BuiltinSteps` | 14 step type definitions + handlers, `registerBuiltinSteps()` |

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
│   ├── devops/                # Azure DevOps (REST API + PAT management)
│   ├── apimanagement/         # API Management
│   ├── logic/                 # Logic Apps
│   ├── resources/             # Resource Groups + ARM Deployments
│   ├── subscriptions/         # Subscription + Tenant management
│   ├── guardrails/            # Operation guardrails (in-memory rules)
│   ├── compliance/            # Compliance frameworks (6 built-in)
│   ├── automation/            # Azure Automation runbooks
│   ├── enterprise/            # Multi-tenant + Management Groups + Lighthouse
│   ├── orchestration/         # IDIO — DAG planner, engine, blueprints, step registry
│   └── advisor/               # Project analyzer, recommendation engine, deploy advisor```

## IDIO — Intelligent Deployment & Infrastructure Orchestration

IDIO is a DAG-based orchestration engine that chains multiple Azure operations into multi-step deployment plans. Instead of running individual commands one at a time, IDIO lets you describe an entire deployment (e.g., "web app with SQL backend and CDN") and executes it as a dependency-resolved pipeline with rollback support.

### How It Works

1. **Blueprints** define reusable deployment templates (e.g., `web-app-with-sql`)
2. **Planner** validates the DAG, resolves output references between steps, and topologically sorts execution order
3. **Engine** executes steps in dependency order with concurrency, event streaming, and automatic rollback on failure

### Built-in Blueprints

| Blueprint | Category | Steps | Description |
|-----------|----------|-------|-------------|
| `web-app-with-sql` | web-app | 7 | Resource group → App Insights → SQL Server → App Service Plan → Web App → CDN → Key Vault |
| `static-web-with-cdn` | web-app | 4 | Resource group → Storage account → CDN profile → CDN endpoint |
| `api-backend` | api | 6 | Resource group → App Insights → Cosmos DB → App Service Plan → Web App → Key Vault |
| `microservices-backbone` | microservices | 6 | Resource group → VNet → NSG → Service Bus → Redis Cache → Key Vault |
| `data-platform` | data | 6 | Resource group → Storage account → SQL Server → Cosmos DB → App Insights → Key Vault |

### Built-in Step Types (14)

| Step Type | Category | Description |
|-----------|----------|-------------|
| `create-resource-group` | foundation | Create a resource group |
| `deploy-arm-template` | foundation | Deploy an ARM/Bicep template |
| `create-vnet` | networking | Create a virtual network with subnets |
| `create-nsg` | networking | Create a network security group |
| `create-storage-account` | storage | Create a storage account |
| `create-sql-server` | database | Create a SQL server + database |
| `create-cosmosdb-account` | database | Create a Cosmos DB account |
| `create-redis-cache` | cache | Create a Redis cache instance |
| `create-cdn-profile` | cdn | Create a CDN profile + endpoint |
| `create-app-service-plan` | compute | Create an App Service plan |
| `create-web-app` | compute | Create a web app on a plan |
| `create-app-insights` | monitoring | Create Application Insights |
| `create-servicebus-namespace` | messaging | Create a Service Bus namespace |
| `create-keyvault` | security | Create a Key Vault |

### Output References

Steps can reference outputs from upstream dependencies using the `$step.<stepId>.<outputName>` syntax:

```jsonc
{
  "id": "web-app",
  "type": "create-web-app",
  "params": {
    "appServicePlanId": "$step.plan.planId",   // references "plan" step's planId output
    "appInsightsKey": "$step.insights.instrumentationKey"
  },
  "dependsOn": ["plan", "insights"]
}
```

### Conditional Execution

Steps can include conditions that gate execution based on upstream step status:

```jsonc
{
  "id": "cdn",
  "type": "create-cdn-profile",
  "condition": {
    "stepId": "web-app",
    "check": "succeeded"    // only run if web-app succeeded
  }
}
```

### Dry-Run Mode

Pass `dryRun: true` to `azure_execute_plan` or `azure_run_blueprint` to validate and simulate execution without creating real Azure resources. Useful for plan verification and CI pipelines.

### Extending with Custom Steps

Register custom step types programmatically:

```typescript
import { registerStepType } from '@espada/azure/orchestration';

registerStepType({
  type: 'deploy-my-service',
  category: 'compute',
  description: 'Deploy my custom service',
  requiredParams: ['resourceGroup', 'name', 'image'],
  optionalParams: ['replicas'],
  outputs: ['serviceUrl', 'serviceId'],
  handler: {
    execute: async (ctx) => {
      // deploy logic using ctx.params
      return { serviceUrl: '...', serviceId: '...' };
    },
    rollback: async (ctx, outputs) => {
      // cleanup logic
    },
  },
});
```

## Advisor — Project Analysis & Recommendation Engine

The Advisor module sits on top of IDIO and provides **autonomous** deployment support. Instead of manually selecting blueprints and parameters, point it at a project directory and it figures out what to deploy.

### How It Works

1. **Analyzer** (`analyzeProject`) scans the project for `package.json`, `requirements.txt`, `.csproj`, `Dockerfile`, `.env`, etc. — detecting language (9), framework (18), archetype (10), dependencies with infrastructure signals, port, entry point, and package manager.

2. **Recommendation Engine** (`recommend`) maps the analysis to Azure services:
   - Dependency signals → service recommendations (e.g., `pg` → PostgreSQL, `ioredis` → Azure Cache for Redis, `bullmq` → Service Bus)
   - Archetype → compute recommendation (static-site → Static Web Apps, microservices → Container Apps, API → App Service)
   - Cross-cutting concerns (monitoring, Key Vault, CDN, Container Registry)

3. **Blueprint Matching** scores all IDIO blueprints against the analysis, auto-populates parameters (projectName, location, runtime), and identifies missing required params.

4. **`recommendAndPlan`** generates a validated `ExecutionPlan` ready for the orchestrator — or returns issues if params are missing.

### CLI Usage

```bash
# Analyze a project
espada azure advisor analyze /path/to/project

# Get recommendations
espada azure advisor recommend /path/to/project --region westus2

# End-to-end deploy (dry-run by default)
espada azure advisor deploy /path/to/project --region westus2

# Live execution
espada azure advisor deploy /path/to/project --live
```

### Agent Tool: `azure_analyze_and_deploy`

This is the highest-level tool — an AI agent can call it with just a project path and get a full deployment. It defaults to dry-run for safety.

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
- [x] Full CLI coverage for all services (DNS, Redis, CDN, Network, CosmosDB, Service Bus, Event Grid, Security, IAM, Policy, Backup, Automation, Logic Apps, APIM, DevOps)
- [x] Unit tests for all service modules (46 test files, 557 tests)
- [x] 84 agent tools covering all services (networking, DNS, Redis, CDN, backup, automation, CosmosDB, Service Bus, Event Grid, IAM, Policy, Logic Apps, APIM, DevOps, AI, security, tagging, enterprise, orchestration, PAT management, advisor)
- [x] 70 gateway methods covering all services
- [x] IDIO orchestration engine — DAG planner, 14 built-in step types, 5 blueprints, 58 tests
- [x] DevOps PAT management — Secure storage/retrieval with AES-256-GCM encryption, validation, rotation, expiry tracking
- [x] Advisor module — Project analyzer (9 languages, 18 frameworks, 10 archetypes), recommendation engine (18 Azure services), blueprint matching, end-to-end deploy, 83 tests

## What Still Needs Work
- [ ] **Integration / E2E tests** — Tests against real Azure subscriptions (`LIVE=1`)
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
