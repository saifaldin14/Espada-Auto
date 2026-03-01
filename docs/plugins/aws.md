---
summary: "AWS plugin: comprehensive AWS infrastructure management — 30 agent tools with 660+ actions across 40+ AWS services including EC2, Lambda, S3, RDS, DynamoDB, ECS, EKS, API Gateway, and more"
read_when:
  - You want to manage AWS infrastructure through Espada
  - You need EC2, Lambda, S3, RDS, DynamoDB, containers, networking, or any AWS service
  - You want intent-driven infrastructure orchestration (IDIO)
  - You need compliance, guardrails, CI/CD, or enterprise multi-tenancy on AWS
  - You are configuring or developing the AWS extension
---

# AWS (plugin)

Comprehensive AWS infrastructure management for Espada. Covers 40+ AWS
services — compute, storage, databases, networking, security, AI/ML,
containers, messaging, observability, CI/CD, and enterprise governance —
through 30 agent tools exposing 660+ actions, 12 gateway methods, and
15 CLI commands.

## Prerequisites

1. **Node.js 22+**
2. **AWS CLI v2** installed ([install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
3. **AWS Account** with appropriate permissions
4. **Espada** installed and configured

## Install

### Option A: install from npm (recommended)

```bash
espada plugins install @espada/aws
```

Restart the Gateway afterwards.

### Option B: install from a local folder (dev)

```bash
espada plugins install ./extensions/aws
cd extensions/aws && pnpm install
```

Restart the Gateway afterwards.

## Authentication

Three options:

### Browser-based SSO (recommended for organizations)

```bash
espada aws whoami   # triggers SSO flow if not authenticated
```

Or ask the agent:

> "Set up AWS SSO with start URL https://my-org.awsapps.com/start in us-east-1"

### Access keys (personal accounts)

> "Authenticate with AWS using access keys"

The agent will guide you through entering your Access Key ID and Secret
Access Key securely.

### Environment variables

Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally
`AWS_SESSION_TOKEN` in your environment before starting the Gateway.

## Configuration

Configure under `plugins.entries.aws.config`:

```bash
espada config set plugins.entries.aws.config.defaultRegion us-west-2
espada config set plugins.entries.aws.config.defaultProfile my-profile
espada config set plugins.entries.aws.config.diagnostics.enabled true
```

| Key | Type | Default | Description |
|---|---|---|---|
| `defaultRegion` | string | `us-east-1` | Default AWS region |
| `defaultProfile` | string | — | AWS credentials profile name |
| `credentialSources` | string[] | — | Credential source order: `profile`, `environment`, `sso`, `instance`, `container` |
| `diagnostics.enabled` | boolean | `false` | Enable API call tracing (integrates with diagnostics-otel) |
| `diagnostics.verbose` | boolean | `false` | Verbose retry/API logging |
| `retry.attempts` | number | `3` | Max retry attempts for API calls |
| `retry.minDelayMs` | number | `100` | Min delay between retries (ms) |
| `retry.maxDelayMs` | number | `30000` | Max delay between retries (ms) |
| `tagConfig.requiredTags` | string[] | — | Tags required on all resources |
| `tagConfig.optionalTags` | string[] | — | Recommended but optional tags |
| `defaultTags` | object[] | — | Tags auto-applied to created resources |

---

## Agent tools

30 tools, each accepting an `action` parameter that selects from many
sub-actions. All tools support natural-language invocation through the
agent.

### Compute

| Tool | Actions | Description |
|---|---|---|
| `aws_ec2` | 39 actions | Instances (list/start/stop/reboot/terminate/create), launch templates, key pairs, AMIs, Auto Scaling Groups, Load Balancers, target groups, listeners, monitoring, tags |
| `aws_lambda` | 39 actions | Functions, code deployment, env vars, triggers (event source mappings), layers, versions/aliases, cold-start optimisation (reserved/provisioned concurrency, warmup), function URLs, metrics, logs |
| `aws_containers` | 42 actions | **ECS** clusters/services/tasks/task definitions, container instances, deploy/rollback; **EKS** clusters/node groups/Fargate profiles; **ECR** repos/images/scans/lifecycle policies; auto-scaling, container insights |

#### `aws_ec2` action reference

| Category | Actions |
|---|---|
| Instance lifecycle | `list`, `describe`, `start`, `stop`, `reboot`, `terminate`, `create`, `modify_attribute`, `get_status`, `wait_for_state` |
| Launch templates | `list_launch_templates`, `create_launch_template`, `delete_launch_template`, `get_launch_template_versions` |
| Key pairs | `list_key_pairs`, `create_key_pair`, `import_key_pair`, `delete_key_pair` |
| Monitoring | `enable_monitoring`, `disable_monitoring`, `get_metrics` |
| AMIs | `list_amis`, `create_ami`, `deregister_ami`, `copy_ami`, `modify_ami_attribute` |
| Auto Scaling | `list_asgs`, `create_asg`, `update_asg`, `delete_asg`, `set_desired_capacity`, `get_scaling_activities`, `attach_target_groups`, `detach_target_groups` |
| Load Balancers | `list_load_balancers`, `create_load_balancer`, `delete_load_balancer` |
| Target Groups | `list_target_groups`, `create_target_group`, `delete_target_group`, `register_targets`, `deregister_targets`, `get_target_health` |
| Listeners | `list_listeners`, `create_listener`, `delete_listener` |
| Tags | `add_tags`, `remove_tags` |

#### `aws_lambda` action reference

| Category | Actions |
|---|---|
| Functions | `list_functions`, `get_function`, `create_function`, `update_function_code`, `update_function_configuration`, `delete_function`, `invoke_function` |
| Environment | `get_environment_variables`, `set_environment_variables`, `update_environment_variables`, `remove_environment_variables` |
| Triggers | `list_event_source_mappings`, `create_event_source_mapping`, `update_event_source_mapping`, `delete_event_source_mapping`, `add_permission`, `remove_permission`, `get_policy` |
| Layers | `list_layers`, `list_layer_versions`, `get_layer_version`, `publish_layer_version`, `delete_layer_version`, `add_layers_to_function`, `remove_layers_from_function` |
| Versions/Aliases | `publish_version`, `list_versions`, `create_alias`, `update_alias`, `delete_alias`, `list_aliases` |
| Monitoring | `get_metrics`, `get_logs`, `get_recent_log_streams` |
| Cold starts | `set_reserved_concurrency`, `delete_reserved_concurrency`, `get_reserved_concurrency`, `set_provisioned_concurrency`, `delete_provisioned_concurrency`, `list_provisioned_concurrency_configs`, `analyze_cold_starts`, `warmup_function` |
| Function URLs | `create_function_url`, `update_function_url`, `delete_function_url`, `get_function_url`, `list_function_urls` |

#### `aws_containers` action reference

| Category | Actions |
|---|---|
| ECS Clusters | `list_ecs_clusters`, `get_ecs_cluster`, `create_ecs_cluster`, `update_ecs_cluster`, `delete_ecs_cluster` |
| ECS Services | `list_ecs_services`, `get_ecs_service`, `create_ecs_service`, `update_ecs_service`, `scale_ecs_service`, `delete_ecs_service`, `deploy_service`, `rollback_service` |
| ECS Tasks | `list_ecs_tasks`, `get_ecs_task`, `run_ecs_task`, `stop_ecs_task`, `list_task_definitions`, `get_task_definition`, `register_task_definition`, `deregister_task_definition`, `list_container_instances`, `drain_container_instance` |
| EKS | `list_eks_clusters`, `get_eks_cluster`, `create_eks_cluster`, `update_eks_cluster`, `update_eks_cluster_version`, `delete_eks_cluster` |
| EKS Node Groups | `list_eks_node_groups`, `get_eks_node_group`, `create_eks_node_group`, `update_eks_node_group`, `update_eks_node_group_version`, `delete_eks_node_group` |
| EKS Fargate | `list_eks_fargate_profiles`, `create_eks_fargate_profile`, `delete_eks_fargate_profile` |
| ECR | `list_ecr_repositories`, `get_ecr_repository`, `create_ecr_repository`, `delete_ecr_repository`, `list_ecr_images`, `delete_ecr_images`, `start_ecr_image_scan`, `get_ecr_image_scan_findings`, `get_ecr_lifecycle_policy`, `set_ecr_lifecycle_policy`, `delete_ecr_lifecycle_policy`, `get_ecr_authorization_token` |
| Auto Scaling | `register_scalable_target`, `deregister_scalable_target`, `list_scalable_targets`, `put_scaling_policy`, `delete_scaling_policy`, `list_scaling_policies` |
| Misc | `get_container_logs`, `get_container_insights`, `tag_ecs_resource`, `untag_ecs_resource`, `tag_eks_resource`, `untag_eks_resource` |

### Storage & Data

| Tool | Actions | Description |
|---|---|---|
| `aws_s3` | 38 actions | Buckets, objects, versioning, encryption, lifecycle policies, website hosting, CloudFront distributions, replication, notifications, CORS, bucket policies, presigned URLs, empty bucket |
| `aws_dynamodb` | 28 actions | Tables, items, queries/scans, batch get/write, transactions, TTL, point-in-time recovery, backups, global tables, auto-scaling, S3 export |
| `aws_elasticache` | 20 actions | Redis/Valkey replication groups, Memcached clusters, snapshots, failover testing, scaling, parameter groups, subnet groups |

#### `aws_s3` action reference

`list_buckets`, `get_bucket_details`, `create_bucket`, `delete_bucket`, `bucket_exists`, `list_objects`, `upload_object`, `download_object`, `delete_object`, `delete_objects`, `copy_object`, `get_presigned_url`, `get_versioning`, `set_versioning`, `get_encryption`, `set_encryption`, `get_public_access_block`, `set_public_access_block`, `get_lifecycle`, `set_lifecycle`, `delete_lifecycle`, `get_website`, `set_website`, `delete_website`, `get_cors`, `set_cors`, `delete_cors`, `get_replication`, `set_replication`, `delete_replication`, `get_notifications`, `set_notifications`, `list_cloudfront`, `get_cloudfront`, `create_cloudfront`, `empty_bucket`, `get_bucket_tags`, `set_bucket_tags`, `get_bucket_policy`, `set_bucket_policy`

### Databases

| Tool | Actions | Description |
|---|---|---|
| `aws_rds` | 36 actions | Instances (create/modify/delete/start/stop/reboot), snapshots, parameter groups, subnet groups, read replicas, Multi-AZ failover, Performance Insights, backup/maintenance config, events, log files |

#### `aws_rds` action reference

`list_instances`, `get_instance`, `create_instance`, `modify_instance`, `delete_instance`, `start_instance`, `stop_instance`, `reboot_instance`, `list_snapshots`, `create_snapshot`, `delete_snapshot`, `restore_from_snapshot`, `restore_point_in_time`, `list_parameter_groups`, `create_parameter_group`, `modify_parameter_group`, `delete_parameter_group`, `get_parameters`, `list_subnet_groups`, `create_subnet_group`, `modify_subnet_group`, `delete_subnet_group`, `get_metrics`, `enable_performance_insights`, `disable_performance_insights`, `get_backup_config`, `set_backup_config`, `get_maintenance_config`, `set_maintenance_config`, `create_read_replica`, `promote_read_replica`, `list_read_replicas`, `get_replica_status`, `force_failover`, `enable_multi_az`, `disable_multi_az`, `get_multi_az_status`, `list_events`, `list_log_files`, `download_log_portion`

### Networking

| Tool | Actions | Description |
|---|---|---|
| `aws_network` | 32 actions | VPCs, subnets, route tables, internet/NAT gateways, VPC peering, transit gateways, NACLs, VPC endpoints, flow logs, multi-AZ VPC creation |
| `aws_route53` | 21 actions | Hosted zones, DNS records, health checks, VPC associations, DNS answer testing |
| `aws_apigateway` | 42 actions | REST, HTTP, and WebSocket APIs — resources, methods, integrations, routes, stages, deployments, authorizers, usage plans, API keys, custom domains |

#### `aws_network` action reference

`list_vpcs`, `create_vpc`, `delete_vpc`, `list_subnets`, `create_subnet`, `delete_subnet`, `list_route_tables`, `create_route_table`, `create_route`, `associate_route_table`, `delete_route_table`, `list_internet_gateways`, `create_internet_gateway`, `delete_internet_gateway`, `list_nat_gateways`, `create_nat_gateway`, `delete_nat_gateway`, `list_vpc_peering`, `create_vpc_peering`, `accept_vpc_peering`, `delete_vpc_peering`, `list_transit_gateways`, `create_transit_gateway`, `attach_vpc_to_transit_gateway`, `delete_transit_gateway`, `list_network_acls`, `create_network_acl`, `create_network_acl_entry`, `delete_network_acl`, `list_vpc_endpoints`, `list_vpc_endpoint_services`, `create_vpc_endpoint`, `delete_vpc_endpoints`, `list_flow_logs`, `create_flow_log`, `delete_flow_logs`, `create_multi_az_vpc`, `get_availability_zones`

#### `aws_apigateway` action reference

`create_rest_api`, `get_rest_api`, `list_rest_apis`, `delete_rest_api`, `import_rest_api`, `export_rest_api`, `create_http_api`, `get_http_api`, `list_http_apis`, `delete_http_api`, `import_http_api`, `export_http_api`, `create_resource`, `list_resources`, `delete_resource`, `create_method`, `delete_method`, `create_integration`, `create_lambda_proxy_integration`, `create_route`, `list_routes`, `delete_route`, `create_http_integration`, `create_http_lambda_integration`, `list_http_integrations`, `create_rest_stage`, `create_http_stage`, `list_rest_stages`, `list_http_stages`, `delete_rest_stage`, `delete_http_stage`, `create_rest_deployment`, `create_http_deployment`, `create_rest_authorizer`, `create_http_authorizer`, `list_rest_authorizers`, `list_http_authorizers`, `create_usage_plan`, `list_usage_plans`, `create_api_key`, `list_api_keys`, `add_api_key_to_usage_plan`, `create_rest_domain`, `create_http_domain`, `create_base_path_mapping`, `create_api_mapping`, `get_api_metrics`, `get_invoke_url`, `flush_stage_cache`

### Security & Identity

| Tool | Actions | Description |
|---|---|---|
| `aws_security` | 46 actions | IAM roles/users/policies, policy simulation, Security Hub findings/standards, GuardDuty detectors/findings, KMS keys/rotation, Secrets Manager, Access Analyzer, security posture assessment |
| `aws_security_group` | 6 actions | List, describe, create, delete security groups; add/remove inbound/outbound rules |
| `aws_cognito` | 27 actions | User pools, users, groups, app clients, identity providers |

#### `aws_security` action reference

| Category | Actions |
|---|---|
| IAM Roles | `list_roles`, `get_role`, `create_role`, `delete_role`, `attach_role_policy`, `detach_role_policy` |
| IAM Users | `list_users`, `get_user`, `create_user`, `delete_user` |
| IAM Policies | `list_policies`, `get_policy`, `create_policy`, `delete_policy`, `simulate_policy`, `get_policy_template` |
| Security Hub | `list_security_findings`, `update_security_findings`, `enable_security_hub`, `disable_security_hub`, `list_security_standards`, `enable_security_standard` |
| GuardDuty | `list_guardduty_findings`, `get_guardduty_detector`, `enable_guardduty`, `disable_guardduty`, `archive_guardduty_findings` |
| KMS | `list_kms_keys`, `get_kms_key`, `create_kms_key`, `schedule_key_deletion`, `enable_key_rotation`, `disable_key_rotation` |
| Secrets Manager | `list_secrets`, `get_secret`, `get_secret_value`, `create_secret`, `update_secret`, `delete_secret`, `rotate_secret` |
| Access Analyzer | `list_access_analyzers`, `list_access_analyzer_findings`, `create_access_analyzer`, `delete_access_analyzer`, `archive_access_analyzer_finding` |
| Posture | `get_security_posture` |

### Monitoring & Observability

| Tool | Actions | Description |
|---|---|---|
| `aws_observability` | 33 actions | CloudWatch alarms/metrics/dashboards/logs, Log Insights queries, X-Ray tracing/service maps, Synthetics canaries, anomaly detection |
| `aws_cloudtrail` | 5 actions | Audit event querying — `query`, `security_events`, `infrastructure_events`, `user_events`, `audit_summary` |

### Messaging

| Tool | Actions | Description |
|---|---|---|
| `aws_sqs` | 21 actions | Standard/FIFO queues, messages, DLQ, message move tasks, batch operations |
| `aws_sns` | 19 actions | Topics, subscriptions, publishing, filter policies, platform applications, batch publish |

### Cost & Governance

| Tool | Actions | Description |
|---|---|---|
| `aws_cost` | 10 actions | Cost summaries, forecasts, rightsizing/RI/Savings Plan recommendations, unused resource detection, resource scheduling, budgets |
| `aws_organizations` | 40 actions | Multi-account management, OUs, SCPs (with templates), cross-account assume-role, RAM resource sharing, consolidated billing, delegated admin, handshakes |
| `aws_guardrails` | 30 actions | Approval workflows, dry-run, environment protection, rate limiting, audit logging, change requests, policy-based guardrails, impact assessment |
| `aws_compliance` | 32 actions | Config rules, conformance packs, framework checks (CIS, SOC2, HIPAA, PCI-DSS, GDPR, NIST, ISO-27001, FedRAMP), tag enforcement, violation tracking, remediation, reporting |
| `aws_backup` | 30 actions | Backup plans/vaults/recovery points, on-demand backups, cross-region replication, DR runbooks, failover orchestration, compliance reporting, recovery testing |

### CI/CD & Automation

| Tool | Actions | Description |
|---|---|---|
| `aws_cicd` | 38 actions | CodePipeline management, CodeBuild projects, CodeDeploy applications/deployment groups, blue/green deployments, pipeline templates |
| `aws_automation` | 35 actions | EventBridge rules/schedules, Step Functions state machines/executions, automated remediation, event archival/replay, workflow builder |

### AI & Machine Learning

| Tool | Actions | Description |
|---|---|---|
| `aws_ai` | 30 actions | SageMaker notebooks/endpoints/models/training, Bedrock foundation models, Comprehend NLP (sentiment/entities/key phrases/PII), Rekognition image analysis, Translate |

#### `aws_ai` action reference

| Category | Actions |
|---|---|
| SageMaker | `list_notebooks`, `describe_notebook`, `create_notebook`, `start_notebook`, `stop_notebook`, `delete_notebook`, `list_endpoints`, `describe_endpoint`, `delete_endpoint`, `list_models`, `describe_model`, `list_training_jobs`, `describe_training_job` |
| Bedrock | `list_foundation_models`, `get_foundation_model`, `invoke_model` |
| Comprehend | `detect_sentiment`, `detect_entities`, `detect_key_phrases`, `detect_language`, `detect_pii` |
| Rekognition | `detect_labels`, `detect_faces`, `detect_text`, `recognize_celebrities`, `detect_moderation_labels` |
| Translate | `translate_text`, `list_languages` |

### Infrastructure & Platform

| Tool | Actions | Description |
|---|---|---|
| `aws_authenticate` | 2 actions | Set up AWS authentication — `sso` or `access-keys` |
| `aws_discover` | 5 actions | Discover AWS services, regions, and resources — `services`, `regions`, `resources`, `ec2_instances`, `vpcs` |
| `aws_iac` | 5 actions | Generate Terraform HCL & CloudFormation YAML/JSON, detect drift, export state, plan changes |

### Higher-Level Subsystem Tools

These tools expose multiple sub-actions via an `action` parameter and
provide higher-level orchestration capabilities.

| Tool | Actions | Description |
|---|---|---|
| `aws_idio` | 11 actions | Intent-Driven Infrastructure Orchestration — describe business requirements and IDIO plans the optimal architecture. Actions: `create_plan`, `create_from_template`, `validate_intent`, `estimate_cost`, `execute_plan`, `check_status`, `reconcile`, `rollback`, `list_templates`, `get_template_details`, `get_plan_details` |
| `aws_assistant` | 37 actions | Conversational infrastructure assistant with context management, proactive insights, natural-language queries, and wizard-guided creation. Actions across context, queries, insights, wizards, and summaries |

---

## IDIO — Intent-Driven Infrastructure Orchestration

Compile high-level business intents into concrete infrastructure plans
with cost estimation, policy validation, guardrail checks, and real AWS
provisioning.

```
Agent: "I need a three-tier web application with high availability and a $500/month budget"
```

The IDIO engine:
1. Validates a declarative `ApplicationIntent` (compliance, budget, availability)
2. Compiles into an optimised `InfrastructurePlan`
3. Estimates costs
4. Executes the plan with real AWS API calls
5. Monitors for drift and reconciles

### Built-in catalog templates

| Template | Description | Cost range |
|---|---|---|
| `three-tier-web-app` | Three-Tier Web Application | $200–$2K/mo |
| `serverless-api` | Serverless API | $10–$200/mo |
| `ecommerce-platform` | High-Availability E-Commerce Platform | varies |
| `data-pipeline` | Data Processing Pipeline | varies |
| `microservices-platform` | Microservices Platform | $1K–$10K/mo |
| `machine-learning-platform` | Machine Learning Platform | $500–$10K/mo |
| `static-website` | Static Website | $10–$200/mo |

---

## Conversational Assistant

Context-aware natural-language infrastructure management with resource
tracking, proactive insights, and wizard-guided creation flows.

```
Agent: "What resources are in my production account?"
Agent: "Start the serverless API wizard"
Agent: "Give me infrastructure insights for cost savings"
```

**Wizard templates:** 7 built-in guided creation flows for common patterns.

**Insight categories:** cost, security, performance, reliability, operational.

---

## Compliance Frameworks

The compliance tool supports 18 framework variants:

CIS (1.2, 1.4, 2.0), SOC2 (Type 1, Type 2), HIPAA, PCI-DSS (3.2.1, 4.0),
GDPR, NIST-800-53, NIST-CSF, ISO-27001, FedRAMP, AWS Foundational
Security Best Practices, AWS Well-Architected.

---

## Enterprise Features

Multi-tenancy, billing, authentication, collaboration, and GitOps.

- **Tenant management** — tenant store, isolation, quotas
- **Billing & metering** — account tracking, usage metering
- **Auth** — JWT, SAML, OIDC, SCIM integration
- **Collaboration** — workspaces, approval flows, comments, notifications, Slack/Teams integrations
- **GitOps** — infrastructure-as-code repo sync
- **Service catalog** — managed service offerings

---

## Hybrid / Edge

Manage on-premises and edge infrastructure connected to AWS:

- **AWS Outposts** — on-premises AWS infrastructure
- **EKS Anywhere** — Kubernetes on your own hardware
- **ECS Anywhere** — container workloads on your own servers
- **SSM Managed Instances** — on-premises nodes managed via Systems Manager

---

## CLI commands

All commands live under `espada aws`:

```
espada aws
├── whoami                           Show current AWS identity
├── ec2 list [--state] [--region]    List EC2 instances
├── ec2 start <instanceIds...>       Start instances
├── ec2 stop <instanceIds...>        Stop instances [--force]
├── ec2 terminate <instanceIds...>   Terminate instances
├── sg list [--vpc] [--region]       List security groups
├── keypair list [--region]          List key pairs
├── asg list [--region]              List Auto Scaling groups
├── asg scale <name> <capacity>      Set desired capacity
├── elb list [--region]              List load balancers
├── services [--region]              Discover available AWS services
└── cloudtrail events [--limit]      Recent CloudTrail audit events
```

Add `--region <region>` to any command to override the default region.

---

## Gateway methods

For programmatic access via the Gateway WebSocket API:

| Method | Description |
|---|---|
| `aws/identity` | Current AWS identity (account, region, profile) |
| `aws/ec2/instances` | List EC2 instances |
| `aws/ec2/start` | Start EC2 instances |
| `aws/ec2/stop` | Stop EC2 instances |
| `aws/ec2/terminate` | Terminate EC2 instances |
| `aws/ec2/security-groups` | List security groups |
| `aws/ec2/key-pairs` | List key pairs |
| `aws/asg/list` | List Auto Scaling groups |
| `aws/asg/scale` | Scale an Auto Scaling group |
| `aws/elb/list` | List load balancers |
| `aws/services` | List discovered AWS services |
| `aws/cloudtrail/events` | List CloudTrail events |

---

## AWS services covered

| Category | Services |
|---|---|
| **Compute** | EC2, Lambda, ECS, EKS, Fargate, Auto Scaling, Elastic Load Balancing (ALB/NLB), Launch Templates, AMIs |
| **Storage** | S3, EBS (via EC2), S3 Glacier (via lifecycle policies) |
| **Database** | RDS (MySQL, MariaDB, PostgreSQL, Oracle, SQL Server, Aurora), DynamoDB, ElastiCache (Redis, Valkey, Memcached) |
| **Networking** | VPC, Subnets, Route Tables, Internet Gateways, NAT Gateways, VPC Peering, Transit Gateways, NACLs, VPC Endpoints, Flow Logs, Route 53, CloudFront, API Gateway |
| **Security & Identity** | IAM, Security Hub, GuardDuty, KMS, Secrets Manager, Access Analyzer, Cognito, Organizations, SCPs |
| **Monitoring** | CloudWatch (Alarms, Metrics, Dashboards, Logs, Log Insights, Anomaly Detection), X-Ray, Synthetics, CloudTrail |
| **CI/CD** | CodePipeline, CodeBuild, CodeDeploy |
| **Messaging** | SQS, SNS, EventBridge |
| **Automation** | Step Functions, EventBridge Scheduler, SSM |
| **AI/ML** | SageMaker, Bedrock, Comprehend, Rekognition, Translate |
| **Governance** | AWS Config, Conformance Packs, AWS Backup, Cost Explorer, Budgets, Savings Plans, RAM |
| **IaC** | Terraform generation, CloudFormation generation |
| **Containers** | ECS, EKS, ECR, ECS Anywhere, EKS Anywhere |
| **Hybrid / Edge** | AWS Outposts, ECS Anywhere, EKS Anywhere, SSM Managed Instances |
| **Enterprise** | Multi-tenancy, billing/metering, SAML/OIDC/SCIM, GitOps, service catalog |

---

## Example conversations

> "List all running EC2 instances in us-west-2"

> "Create a security group for my web server allowing port 80 and 443"

> "Show me the cost breakdown for the last 30 days"

> "Deploy this Lambda function with Node.js 22 runtime"

> "Set up S3 bucket versioning and lifecycle policies for my-data-bucket"

> "Create an RDS read replica in us-west-2 for my production database"

> "List all DynamoDB tables and show their auto-scaling config"

> "Set up a three-tier web application using IDIO"

> "What are my Security Hub findings?"

> "Check compliance against SOC2 Type 2"

> "Create a CodePipeline for my Node.js app with blue/green deployment"

> "List my ECS clusters and scale the production service to 5 tasks"

> "Show me SageMaker endpoints and their status"

> "Generate Terraform for my current AWS infrastructure"

> "Create a VPC with public and private subnets across 3 AZs"

> "Set up an SQS dead-letter queue for my order processing queue"

## Troubleshooting

**"EC2 manager not initialized"** — the Gateway service hasn't started
yet. Wait a moment or restart the Gateway.

**Authentication errors** — run `espada aws whoami` to check your
identity. Re-authenticate with `aws sso login` or reconfigure access
keys.

**Region mismatch** — resources are region-scoped. Pass `--region` or
set `defaultRegion` in config to match where your resources live.

**Diagnostics** — enable `diagnostics.enabled` and `diagnostics.verbose`
in config to see detailed API call tracing. Pair with the
`diagnostics-otel` extension for full observability.
