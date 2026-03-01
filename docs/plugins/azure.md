---
summary: "Azure plugin: comprehensive Azure infrastructure management — 174 agent tools, 160 gateway methods, 100 CLI commands across 60+ Azure services"
read_when:
  - You want to manage Azure infrastructure through natural language
  - You need VMs, Storage, Networking, Databases, Security, AI, DevOps, or any Azure service
  - You want to deploy with blue/green, canary, or Traffic Manager strategies
  - You need hybrid/Arc management, IaC generation, or enterprise multi-tenancy
  - You are configuring or developing the Azure extension
---

# Azure (plugin)

Comprehensive Azure infrastructure management for Espada. Covers 60+
Azure services — compute, storage, networking, databases, security, AI,
DevOps, messaging, analytics, hybrid, and enterprise governance — through
174 agent tools, 160 gateway methods, and 100 CLI commands.

## Prerequisites

1. **Node.js 22+**
2. **Azure CLI (`az`)** installed and authenticated ([install guide](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli))
3. **Espada** installed and configured

## Install

```bash
espada plugins install @espada/azure
```

Restart the Gateway afterwards.

## Authentication

The plugin supports three credential methods: `cli` (default),
`environment`, and `managed-identity`. Configure via plugin settings.

```bash
az login
```

Or ask the agent:

> "Set up Azure authentication"

## Configuration

| Setting | Description | Default |
|---|---|---|
| `defaultSubscription` | Azure subscription ID used when none is specified | — |
| `defaultRegion` | Azure region for new resources (e.g. `eastus`) | — |
| `defaultTenantId` | Azure AD tenant ID | — |
| `credentialMethod` | Authentication method: `cli`, `environment`, `managed-identity` | `cli` |
| `devOpsOrganization` | Azure DevOps org name (enables DevOps features) | — |
| `tagConfig.enforceDefaultTags` | Auto-apply default tags to new resources | `false` |
| `tagConfig.defaultTags` | Default tags JSON object | `{}` |
| `retryConfig.maxRetries` | Max retry attempts for Azure API calls | `3` |
| `retryConfig.baseDelayMs` | Base delay between retries (ms) | `1000` |
| `diagnostics.enabled` | Enable diagnostic logging | `false` |
| `diagnostics.logLevel` | Log verbosity: `info`, `warning`, `error` | `info` |

---

## Agent tools

174 tools organised by service domain. All tools support natural-language
invocation through the agent. Tools that list resources support
`limit`/`offset` pagination where noted.

### Compute (12 tools)

| Tool | Description |
|---|---|
| `azure_list_vms` | List VMs, optionally by resource group. Paginated. |
| `azure_start_vm` | Start a VM |
| `azure_stop_vm` | Stop a VM |
| `azure_list_functions` | List Azure Function Apps |
| `azure_list_aks_clusters` | List AKS clusters |
| `azure_list_webapps` | List App Service Web Apps (excludes Function Apps) |
| `azure_get_webapp` | Get details of a specific Web App |
| `azure_list_app_service_plans` | List App Service Plans |
| `azure_webapp_start` | Start a Web App |
| `azure_webapp_stop` | Stop a Web App |
| `azure_webapp_restart` | Restart a Web App |
| `azure_list_deployment_slots` | List deployment slots for a Web App |

### Storage & Data (7 tools)

| Tool | Description |
|---|---|
| `azure_list_storage_accounts` | List Storage accounts. Paginated. |
| `azure_list_containers` | List containers in a storage account |
| `azure_list_sql_servers` | List Azure SQL servers |
| `azure_list_cosmosdb_accounts` | List Cosmos DB accounts |
| `azure_list_cosmosdb_databases` | List databases in a Cosmos DB account |
| `azure_list_redis_caches` | List Azure Cache for Redis instances |
| `azure_get_redis_cache` | Get details of a Redis cache |

### Databases — MySQL & PostgreSQL (6 tools)

| Tool | Description |
|---|---|
| `azure_list_mysql_servers` | List MySQL Flexible Servers |
| `azure_get_mysql_server` | Get details of a MySQL Flexible Server |
| `azure_list_mysql_databases` | List databases in a MySQL Flexible Server |
| `azure_list_pg_servers` | List PostgreSQL Flexible Servers |
| `azure_get_pg_server` | Get details of a PostgreSQL Flexible Server |
| `azure_list_pg_databases` | List databases in a PostgreSQL Flexible Server |

### Networking (27 tools)

| Tool | Description |
|---|---|
| `azure_list_vnets` | List Virtual Networks |
| `azure_list_nsgs` | List Network Security Groups |
| `azure_list_load_balancers` | List Load Balancers |
| `azure_list_public_ips` | List Public IP addresses |
| `azure_list_subnets` | List subnets in a VNet |
| `azure_list_nsg_rules` | List security rules in an NSG |
| `azure_list_firewalls` | List Azure Firewalls |
| `azure_get_firewall` | Get details of a Firewall |
| `azure_list_firewall_policies` | List Firewall Policies |
| `azure_list_ip_groups` | List IP Groups (used with Firewall rules) |
| `azure_list_app_gateways` | List Application Gateways |
| `azure_get_app_gateway` | Get details of an Application Gateway |
| `azure_get_waf_config` | Get WAF config for an Application Gateway |
| `azure_list_dns_zones` | List DNS zones |
| `azure_list_dns_records` | List DNS record sets in a zone |
| `azure_list_cdn_profiles` | List CDN profiles |
| `azure_list_cdn_endpoints` | List endpoints for a CDN profile |
| `azure_purge_cdn` | Purge content from a CDN endpoint |
| `azure_list_traffic_manager_profiles` | List Traffic Manager profiles |
| `azure_get_traffic_manager_profile` | Get a Traffic Manager profile with endpoint details |
| `azure_list_traffic_manager_endpoints` | List endpoints for a Traffic Manager profile |
| `azure_list_bastion_hosts` | List Bastion hosts |
| `azure_get_bastion_host` | Get details for a Bastion host |
| `azure_list_frontdoor_profiles` | List Front Door profiles (Standard/Premium) |
| `azure_get_frontdoor_profile` | Get a Front Door profile |
| `azure_list_frontdoor_endpoints` | List Front Door endpoints |
| `azure_list_frontdoor_origin_groups` | List Front Door origin groups |

### Security & Identity (10 tools)

| Tool | Description |
|---|---|
| `azure_list_keyvaults` | List Key Vaults |
| `azure_list_security_alerts` | List Defender for Cloud security alerts |
| `azure_list_security_recommendations` | List Defender for Cloud recommendations |
| `azure_get_secure_scores` | Get Defender for Cloud secure scores |
| `azure_compliance_report` | Generate a compliance report |
| `azure_list_role_definitions` | List RBAC role definitions |
| `azure_list_role_assignments` | List RBAC role assignments |
| `azure_list_policy_definitions` | List Azure Policy definitions |
| `azure_list_policy_assignments` | List Azure Policy assignments |
| `azure_policy_compliance` | Get Policy compliance state |

### Operations & Monitoring (9 tools)

| Tool | Description |
|---|---|
| `azure_query_costs` | Query cost data by timeframe |
| `azure_get_metrics` | Get Azure Monitor metrics for a resource |
| `azure_get_activity_log` | Get activity log events |
| `azure_list_backup_vaults` | List Recovery Services vaults |
| `azure_list_backup_items` | List backup items in a vault |
| `azure_list_backup_jobs` | List backup jobs in a vault |
| `azure_list_automation_accounts` | List Automation accounts |
| `azure_list_runbooks` | List runbooks in an Automation account |
| `azure_start_runbook` | Start an Automation runbook |

### Messaging (9 tools)

| Tool | Description |
|---|---|
| `azure_list_servicebus_namespaces` | List Service Bus namespaces |
| `azure_list_servicebus_queues` | List queues in a Service Bus namespace |
| `azure_list_servicebus_topics` | List topics in a Service Bus namespace |
| `azure_list_eventgrid_topics` | List Event Grid topics |
| `azure_list_eventgrid_domains` | List Event Grid domains |
| `azure_list_event_subscriptions` | List Event Grid subscriptions |
| `azure_list_eventhub_namespaces` | List Event Hubs namespaces |
| `azure_list_eventhubs` | List event hubs within a namespace |
| `azure_list_consumer_groups` | List consumer groups for an event hub |

### AI & Cognitive Services (3 tools)

| Tool | Description |
|---|---|
| `azure_list_ai_accounts` | List Cognitive Services / OpenAI accounts |
| `azure_list_ai_deployments` | List OpenAI / Cognitive Services deployments |
| `azure_list_ai_models` | List available AI models for a location |

### Platform & Resources (8 tools)

| Tool | Description |
|---|---|
| `azure_list_subscriptions` | List subscriptions |
| `azure_list_resource_groups` | List resource groups. Paginated. |
| `azure_list_management_groups` | List Management Groups |
| `azure_deploy_arm_template` | Deploy an ARM template to a resource group |
| `azure_list_logic_apps` | List Logic App workflows |
| `azure_list_logic_runs` | List runs for a Logic App |
| `azure_enable_logic_app` | Enable a Logic App |
| `azure_disable_logic_app` | Disable a Logic App |

### API Management (2 tools)

| Tool | Description |
|---|---|
| `azure_list_apim_services` | List API Management services |
| `azure_list_apim_apis` | List APIs in an APIM service |

### DevOps & PAT Management (11 tools)

| Tool | Description |
|---|---|
| `azure_list_devops_projects` | List DevOps projects |
| `azure_list_devops_pipelines` | List pipelines in a DevOps project |
| `azure_trigger_devops_pipeline` | Trigger a pipeline run |
| `azure_list_devops_repos` | List repos in a DevOps project |
| `azure_list_pats` | List stored DevOps PATs |
| `azure_store_pat` | Store a DevOps PAT with AES-256-GCM encryption |
| `azure_delete_pat` | Delete a stored PAT |
| `azure_validate_pat` | Validate a PAT against the DevOps API |
| `azure_rotate_pat` | Rotate a PAT with a new token |
| `azure_get_pat_token` | Retrieve the best PAT for an org |
| `azure_check_pat_expiry` | Check for expired/expiring PATs |

### Tagging (3 tools)

| Tool | Description |
|---|---|
| `azure_get_resource_tags` | Get tags on a resource |
| `azure_update_resource_tags` | Update tags on a resource |
| `azure_validate_tags` | Validate tags against a tag policy |

### Static Web Apps (4 tools)

| Tool | Description |
|---|---|
| `azure_list_static_web_apps` | List Static Web Apps |
| `azure_get_static_web_app` | Get details for a Static Web App |
| `azure_list_static_web_app_builds` | List builds for a Static Web App |
| `azure_list_static_web_app_custom_domains` | List custom domains for a Static Web App |

### Analytics & Integration (8 tools)

| Tool | Description |
|---|---|
| `azure_list_synapse_workspaces` | List Synapse Analytics workspaces |
| `azure_get_synapse_workspace` | Get details of a Synapse workspace |
| `azure_list_synapse_sql_pools` | List SQL pools in a Synapse workspace |
| `azure_list_synapse_spark_pools` | List Spark pools in a Synapse workspace |
| `azure_list_data_factories` | List Data Factory instances |
| `azure_get_data_factory` | Get details of a Data Factory |
| `azure_list_data_factory_pipelines` | List pipelines in a Data Factory |
| `azure_list_data_factory_datasets` | List datasets in a Data Factory |

### SignalR & Notification Hubs (5 tools)

| Tool | Description |
|---|---|
| `azure_list_signalr_resources` | List SignalR Service resources |
| `azure_get_signalr_resource` | Get details of a SignalR resource |
| `azure_list_notification_hub_namespaces` | List Notification Hubs namespaces |
| `azure_get_notification_hub_namespace` | Get details of a Notification Hubs namespace |
| `azure_list_notification_hubs` | List hubs in a namespace |

### Spring Apps, Purview, Maps & Digital Twins (10 tools)

| Tool | Description |
|---|---|
| `azure_list_spring_services` | List Spring Apps services |
| `azure_get_spring_service` | Get details of a Spring Apps service |
| `azure_list_spring_apps` | List apps in a Spring Apps service |
| `azure_list_purview_accounts` | List Microsoft Purview accounts |
| `azure_get_purview_account` | Get details of a Purview account |
| `azure_list_maps_accounts` | List Azure Maps accounts |
| `azure_get_maps_account` | Get details of a Maps account |
| `azure_list_digital_twins` | List Digital Twins instances |
| `azure_get_digital_twin` | Get details of a Digital Twins instance |
| `azure_list_digital_twin_endpoints` | List endpoints for a Digital Twins instance |

### Hybrid / Azure Arc (10 tools)

| Tool | Description |
|---|---|
| `azure_list_arc_servers` | List Arc-enabled servers |
| `azure_get_arc_server` | Get details of an Arc server |
| `azure_list_arc_server_extensions` | List extensions on an Arc server |
| `azure_list_arc_kubernetes` | List Arc-connected Kubernetes clusters |
| `azure_get_arc_kubernetes` | Get details of an Arc K8s cluster |
| `azure_list_hci_clusters` | List Azure Stack HCI clusters |
| `azure_get_hci_cluster` | Get details of an HCI cluster |
| `azure_list_custom_locations` | List Custom Locations |
| `azure_get_custom_location` | Get details of a Custom Location |
| `azure_hybrid_discover` | Full hybrid discovery — all Arc servers, K8s, HCI, Custom Locations |

### Deployment Strategies (12 tools)

| Tool | Description |
|---|---|
| `azure_create_deployment_slot` | Create a Web App deployment slot |
| `azure_delete_deployment_slot` | Delete a deployment slot |
| `azure_swap_deployment_slots` | Swap two slots (zero-downtime blue/green) |
| `azure_set_slot_traffic` | Set slot traffic routing percentages (canary) |
| `azure_get_slot_traffic` | Get current slot traffic percentages |
| `azure_create_traffic_manager_profile` | Create a Traffic Manager profile |
| `azure_create_traffic_manager_endpoint` | Create/update a Traffic Manager endpoint |
| `azure_update_traffic_manager_weight` | Update endpoint weight for gradual shifting |
| `azure_blue_green_swap` | Execute blue/green swap with optional health check |
| `azure_canary_shift` | Set canary traffic routing for a slot |
| `azure_traffic_manager_shift` | Shift traffic across TM endpoints |
| `azure_deployment_status` | Aggregated deployment status view |

### Orchestration — IDIO Blueprints (6 tools)

The IDIO (Intent-Driven Infrastructure Orchestration) engine provides
blueprint-based provisioning with DAG-ordered execution plans.

| Tool | Description |
|---|---|
| `azure_list_blueprints` | List available IDIO blueprints |
| `azure_get_blueprint` | Get full blueprint details including parameters |
| `azure_generate_plan` | Generate an execution plan from a blueprint |
| `azure_validate_plan` | Validate a plan for correctness |
| `azure_execute_plan` | Execute a plan (supports dry-run) |
| `azure_run_blueprint` | Generate and execute a blueprint in one step |

Built-in blueprints: `webAppWithSql`, `staticWebWithCdn`, `apiBackend`,
`microservicesBackbone`, `dataPlatform`.

### Advisor — Project Analysis (6 tools)

Scans a project to detect language, framework, and dependencies, then
recommends Azure services and matches IDIO blueprints.

| Tool | Description |
|---|---|
| `azure_analyze_project` | Scan a project directory for infra signals |
| `azure_recommend_services` | Recommend Azure services and match blueprints |
| `azure_analyze_and_deploy` | End-to-end analyse → recommend → plan → execute |
| `azure_prompt_params` | Identify missing parameters for a matched blueprint |
| `azure_provide_answers` | Supply answers to parameter prompts |
| `azure_verify_deployment` | Run post-deploy health checks |

### Higher-Level Subsystems (6 multiplexed tools)

These tools expose multiple sub-actions via an `action` parameter.

| Tool | Actions | Description |
|---|---|---|
| `azure_idio` | `compile`, `validate`, `estimate_cost` | Intent-driven infra orchestration — compile intents into plans with cost estimates and guardrail checks |
| `azure_assistant` | `query`, `get_context`, `track_resource`, `untrack_resource`, `get_insights`, `list_wizards`, `start_wizard`, `wizard_next`, `get_wizard_state`, `get_summary` | Conversational infra assistant with resource tracking, proactive insights, and multi-step creation wizards |
| `azure_catalog` | `list`, `search`, `search_by_tags`, `get`, `apply`, `get_categories` | Browse, search, and apply pre-built infrastructure templates |
| `azure_iac` | `generate`, `generate_from_definitions`, `detect_drift`, `export_state` | Generate Terraform/Bicep/ARM code, detect drift, export state |
| `azure_enterprise` | tenant (`list`, `switch`), billing (`account`, `budgets`, `forecast`), auth (`configureSaml`, `configureOidc`), gitops (`configure`, `sync`, `history`) | Multi-tenancy, billing, SSO config, and GitOps |
| `azure_reconciliation` | `reconcile`, `create_schedule`, `list_schedules`, `get_schedule`, `delete_schedule` | Compare desired vs actual state — drift detection, compliance checking, auto-remediation |

---

## Deployment strategies

The plugin provides three production-grade deployment strategies for
Azure Web Apps. Each strategy is exposed as both an agent tool and a
programmatic API.

### Blue/green slot swap

Atomically swap a staging slot into production with automatic health
checks and rollback on failure.

**Flow:** validate slot → health-check staging → atomic swap →
health-check production → rollback on failure

```
Agent: "Deploy my app using blue/green — swap the staging slot to production"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `appName` | string | Yes | Web App name |
| `resourceGroup` | string | Yes | Azure resource group |
| `slotName` | string | No | Source slot (default: `staging`) |
| `healthCheckPath` | string | No | Health-check endpoint (default: `/health`) |
| `healthCheckTimeoutMs` | number | No | Timeout (default: 30 000 ms) |

### Canary slot traffic shifting

Route a percentage of live traffic to a canary deployment slot.

```
Agent: "Route 10% of traffic to the canary slot for my-web-app"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `appName` | string | Yes | Web App name |
| `resourceGroup` | string | Yes | Azure resource group |
| `slotName` | string | No | Canary slot (default: `canary`) |
| `percentage` | number | Yes | Traffic percentage (0–100) |

### Traffic Manager weighted routing

DNS-level traffic shifting across regions or endpoints.

```
Agent: "Shift 80% of traffic to the us-east endpoint via Traffic Manager"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `profileName` | string | Yes | Traffic Manager profile name |
| `resourceGroup` | string | Yes | Azure resource group |
| `endpointName` | string | Yes | Target endpoint name |
| `weight` | number | Yes | Traffic weight (1–1000) |

---

## CLI commands

All CLI commands are available under `espada azure`. The full command tree:

```
espada azure
├── status                          Show Azure connection status
├── vm list|start|stop|restart      Virtual Machine management
├── storage list|containers         Storage account management
├── rg list                         Resource group listing
├── functions list                  Function Apps
├── aks list                        AKS clusters
├── webapp list|start|stop|restart|plans|slots  App Service Web Apps
├── keyvault list                   Key Vaults
├── sql list                        SQL servers
├── cost query                      Cost analysis
├── subscription list               Subscriptions
├── dns zones|records               DNS management
├── redis list|info                 Redis caches
├── cdn profiles|endpoints          CDN management
├── network vnet|nsg|lb|pip list    Networking
├── firewall list|policies|ip-groups  Firewalls
├── appgateway list|waf             Application Gateways
├── cosmosdb list|databases         Cosmos DB
├── servicebus list|queues|topics   Service Bus
├── eventgrid topics|domains        Event Grid
├── eventhubs namespaces|list|consumer-groups  Event Hubs
├── security scores|alerts|recommendations  Defender for Cloud
├── iam roles|assignments           RBAC
├── policy definitions|assignments|compliance  Azure Policy
├── backup vaults|items|jobs        Recovery Services
├── automation accounts|runbooks|jobs  Automation
├── logic list|runs|enable|disable  Logic Apps
├── apim list|apis                  API Management
├── devops projects|pipelines|repos DevOps
│   └── pat list|store|delete|validate|rotate|check-expiry  PAT management
├── advisor analyze|recommend|deploy|prompt|verify  Project advisor
├── hybrid arc-servers|arc-k8s|hci|custom-locations|discover  Arc / hybrid
├── trafficmanager list|endpoints   Traffic Manager
├── bastion list                    Bastion hosts
├── frontdoor list|endpoints|origins  Front Door
├── staticwebapp list|builds|domains  Static Web Apps
├── synapse list|sql-pools|spark-pools  Synapse Analytics
├── datafactory list|pipelines|datasets  Data Factory
├── signalr list                    SignalR
├── notificationhubs list|hubs      Notification Hubs
├── mysql list|get|databases        MySQL
├── postgresql list|get|databases   PostgreSQL
├── spring list|get|apps            Spring Apps
├── purview list|get                Microsoft Purview
├── maps list|get                   Azure Maps
├── digitaltwins list|get|endpoints Digital Twins
├── idio compile|validate|estimate  Intent-driven orchestration
├── assistant query|insights|summary|wizards  Conversational assistant
├── catalog list|search|get|categories  Template catalog
├── iac generate|drift              IaC generation
├── enterprise tenant|billing       Enterprise features
└── reconciliation run|schedules    Reconciliation engine
```

---

## Gateway methods

~160 gateway methods are available for programmatic access. Organised by
domain:

| Domain | Methods |
|---|---|
| **Core** | `azure.status` |
| **VM** | `azure.vm.list`, `.start`, `.stop` |
| **Storage** | `azure.storage.list` |
| **Resource Groups** | `azure.rg.list` |
| **Functions** | `azure.functions.list` |
| **AKS** | `azure.aks.list` |
| **SQL** | `azure.sql.list` |
| **Key Vault** | `azure.keyvault.list` |
| **Cost** | `azure.cost.query` |
| **Subscriptions** | `azure.subscriptions.list` |
| **Monitor** | `azure.monitor.metrics` |
| **Security** | `azure.security.scores`, `.alerts`, `.recommendations` |
| **Compliance** | `azure.compliance.report` |
| **Network** | `azure.network.vnets`, `.nsgs`, `.lbs`, `.pips` |
| **Web Apps** | `azure.webapp.list`, `.get`, `.start`, `.stop`, `.restart`, `.plans`, `.slots` |
| **Firewall** | `azure.firewall.list`, `.get`, `.policies`, `.ipgroups` |
| **App Gateway** | `azure.appgateway.list`, `.get`, `.waf` |
| **DNS** | `azure.dns.zones`, `.records` |
| **Redis** | `azure.redis.list`, `.get` |
| **CDN** | `azure.cdn.profiles`, `.endpoints` |
| **Cosmos DB** | `azure.cosmosdb.list`, `.databases` |
| **Service Bus** | `azure.servicebus.list`, `.queues`, `.topics` |
| **Event Grid** | `azure.eventgrid.topics`, `.domains` |
| **Event Hubs** | `azure.eventhubs.namespaces`, `.list`, `.consumergroups` |
| **IAM** | `azure.iam.roles`, `.assignments` |
| **Policy** | `azure.policy.definitions`, `.assignments`, `.compliance` |
| **Backup** | `azure.backup.vaults`, `.items`, `.jobs` |
| **Automation** | `azure.automation.accounts`, `.runbooks`, `.jobs` |
| **Logic** | `azure.logic.list`, `.runs` |
| **APIM** | `azure.apim.list`, `.apis` |
| **DevOps** | `azure.devops.projects`, `.pipelines`, `.repos` |
| **DevOps PAT** | `azure.devops.pat.list`, `.store`, `.delete`, `.validate`, `.token`, `.checkExpiry` |
| **AI** | `azure.ai.accounts`, `.deployments`, `.models` |
| **Activity Log** | `azure.activitylog.events` |
| **Orchestration** | `azure.orchestration.listBlueprints`, `.getBlueprint`, `.generatePlan`, `.executePlan`, `.runBlueprint` |
| **Advisor** | `azure.advisor.analyze`, `.recommend`, `.analyzeAndDeploy`, `.prompt`, `.resolveParams`, `.verify`, `.formatReport` |
| **Hybrid** | `azure.hybrid.arcServers`, `.arcServer`, `.arcServerExtensions`, `.arcKubernetes`, `.arcKubernetesCluster`, `.hciClusters`, `.hciCluster`, `.customLocations`, `.customLocation`, `.discover` |
| **Traffic Manager** | `azure.trafficmanager.list`, `.get`, `.endpoints` |
| **Bastion** | `azure.bastion.list`, `.get` |
| **Front Door** | `azure.frontdoor.list`, `.get`, `.endpoints`, `.origingroups` |
| **Static Web Apps** | `azure.staticwebapp.list`, `.get`, `.builds`, `.domains` |
| **Synapse** | `azure.synapse.list`, `.get`, `.sqlPools`, `.sparkPools` |
| **Data Factory** | `azure.datafactory.list`, `.get`, `.pipelines`, `.datasets` |
| **SignalR** | `azure.signalr.list`, `.get` |
| **Notification Hubs** | `azure.notificationhubs.namespaces`, `.get`, `.hubs` |
| **MySQL** | `azure.mysql.list`, `.get`, `.databases` |
| **PostgreSQL** | `azure.postgresql.list`, `.get`, `.databases` |
| **Spring Apps** | `azure.spring.list`, `.get`, `.apps` |
| **Purview** | `azure.purview.list`, `.get` |
| **Maps** | `azure.maps.list`, `.get` |
| **Digital Twins** | `azure.digitaltwins.list`, `.get`, `.endpoints` |
| **IDIO** | `azure.idio.compile`, `.validate`, `.estimateCost` |
| **Conversational** | `azure.assistant.query`, `.context`, `.trackResource`, `.untrackResource`, `.insights`, `.summary`, `.listWizards`, `.startWizard`, `.wizardNext` |
| **Catalog** | `azure.catalog.list`, `.search`, `.get`, `.apply`, `.categories` |
| **IaC** | `azure.iac.generate`, `.generateFromDefinitions`, `.detectDrift`, `.exportState` |
| **Enterprise** | `azure.enterprise.tenant.list`, `.tenant.switch`, `.billing.account`, `.billing.budgets`, `.billing.forecast`, `.auth.configureSaml`, `.auth.configureOidc`, `.gitops.configure`, `.gitops.sync`, `.gitops.history` |
| **Reconciliation** | `azure.reconciliation.run`, `.schedules.list`, `.schedules.create`, `.schedules.delete` |

---

## Advanced subsystems

### IDIO — Intent-Driven Infrastructure Orchestration

Compile high-level application intents into concrete infrastructure
plans with cost estimation, policy validation, and guardrail checks.

```
Agent: "I need a Node.js API with a SQL database and CDN — plan it out"
```

The IDIO engine:
1. Compiles an `ApplicationIntent` into an `InfrastructurePlan`
2. Validates the plan against guardrails and policies
3. Estimates costs
4. Generates IaC (Terraform/Bicep/ARM)
5. Executes with DAG-ordered steps and rollback support

### Conversational Assistant

Natural-language infrastructure management with resource tracking,
proactive insights, and guided creation wizards.

```
Agent: "What resources are in my production resource group?"
Agent: "Start the VM creation wizard"
Agent: "Give me infrastructure insights"
```

### Infrastructure Template Catalog

Browse, search, and apply pre-built infrastructure templates covering
common patterns: web apps, APIs, microservices, data platforms.

```
Agent: "Show me available infrastructure templates"
Agent: "Apply the API backend template to my project"
```

### IaC Generation

Generate Terraform, Bicep, or ARM templates from infrastructure plans
or resource definitions. Detect configuration drift between desired and
actual state.

```
Agent: "Generate Terraform for my current Azure setup"
Agent: "Check for infrastructure drift"
```

### Reconciliation Engine

Compare desired infrastructure state against actual state. Supports
drift detection, compliance checking, cost anomaly detection, and
auto-remediation. Schedule recurring reconciliation runs with cron.

```
Agent: "Reconcile my infrastructure — check for drift"
Agent: "Create a daily reconciliation schedule"
```

### Enterprise Features

Multi-tenancy, billing, authentication, collaboration, and GitOps.

- **Tenant management** — register, switch, isolate tenants with quotas
- **Billing** — accounts, budgets, forecasts
- **Auth** — SAML/OIDC/SCIM/MFA/conditional access configuration
- **Collaboration** — workspaces, approval flows, comments, notifications
- **GitOps** — repo configuration, sync, history

### Guardrails

Preventative rules with severity levels that block or warn on dangerous
operations before execution (e.g. deleting production resources,
exceeding cost thresholds).

### Compliance

Evaluate resources against compliance frameworks and generate violation
reports.

---

## Example conversations

> "List all VMs in my production resource group"

> "Show me the costs for this month"

> "What Key Vaults do I have?"

> "List my AKS clusters and their status"

> "Deploy my-api using blue/green — swap the staging slot"

> "Route 5% of traffic to the canary slot for my-web-app"

> "Generate Terraform for my current infrastructure"

> "Analyse my project and recommend Azure services"

> "Run a blueprint to set up a web app with SQL database"

> "Show all Arc-enabled servers across my hybrid environment"

> "Check for infrastructure drift"

> "List my Azure DevOps pipelines and trigger a build"

> "What Defender for Cloud recommendations do I have?"

> "Create a daily reconciliation schedule for my production environment"

## Troubleshooting

**"Azure CLI not authenticated"** — run `az login` or
`az login --use-device-code`.

**"VM/Storage/SQL manager not initialized"** — the plugin initialises
managers during service start. Ensure the extension is installed and the
Gateway has been restarted.

**"DevOps features unavailable"** — set the `devOpsOrganization`
configuration option in plugin settings.

**"Slot not found"** — ensure the deployment slot exists. Create it with
`az webapp deployment slot create`.

**Health check failures** — verify your health-check endpoint returns
HTTP 200. Adjust `healthCheckPath` and `healthCheckTimeoutMs`.

**Pagination** — tools that support pagination accept `limit` and
`offset` parameters. Use `--limit` and `--offset` in CLI commands.
