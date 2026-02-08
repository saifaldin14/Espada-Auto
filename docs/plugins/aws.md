---
summary: "AWS plugin: manage EC2, Lambda, S3, RDS, IAM, CloudTrail, and more through conversational AI"
read_when:
  - You want to manage AWS infrastructure through Espada
  - You are configuring or developing the AWS extension
---

# AWS (plugin)

Comprehensive AWS infrastructure management for Espada. Manage EC2
instances, Lambda functions, S3 buckets, RDS databases, IAM, CloudTrail,
and more through natural language or CLI commands.

Current capabilities:
- **EC2** — instances, security groups, key pairs, auto scaling, load balancers
- **Lambda** — functions, triggers, layers, versions, cold-start optimization
- **S3** — buckets, objects, lifecycle policies, versioning, encryption, website hosting
- **RDS** — databases, snapshots, multi-AZ failover, read replicas
- **IAM & Security** — access analyzer, GuardDuty, Security Hub
- **CloudTrail** — audit logging and event querying
- **Cost** — budget tracking and cost analysis
- **IaC** — infrastructure-as-code template generation
- **Backup** — automated backup management
- **Containers** — ECS, EKS, ECR management
- **Observability** — CloudWatch, X-Ray, synthetics

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

> Set up AWS SSO with start URL https://my-org.awsapps.com/start in us-east-1

### Access keys (personal accounts)

> Authenticate with AWS using access keys

The agent will guide you through entering your Access Key ID and Secret
Access Key securely.

### Environment variables

Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally
`AWS_SESSION_TOKEN` in your environment before starting the Gateway.

## Config

Configure under `plugins.entries.aws.config`:

```bash
# Set default region
espada config set plugins.entries.aws.config.defaultRegion us-west-2

# Set default profile
espada config set plugins.entries.aws.config.defaultProfile my-profile

# Enable diagnostics (works with diagnostics-otel extension)
espada config set plugins.entries.aws.config.diagnostics.enabled true
```

| Key | Type | Default | Description |
|---|---|---|---|
| `defaultRegion` | string | `us-east-1` | Default AWS region |
| `defaultProfile` | string | — | AWS credentials profile name |
| `diagnostics.enabled` | boolean | `false` | Enable API call tracing |
| `diagnostics.verbose` | boolean | `false` | Verbose retry/API logging |
| `retry.attempts` | number | `3` | Max retry attempts for API calls |
| `retry.minDelayMs` | number | `100` | Min delay between retries (ms) |
| `retry.maxDelayMs` | number | `30000` | Max delay between retries (ms) |
| `tagConfig.requiredTags` | string[] | — | Tags required on all resources |
| `defaultTags` | object[] | — | Tags auto-applied to resources |

## CLI commands

All commands live under `espada aws`:

```bash
espada aws whoami                    # Show current AWS identity
espada aws ec2 list                  # List EC2 instances
espada aws ec2 list --state running  # Filter by state
espada aws ec2 start i-1234567890   # Start an instance
espada aws ec2 stop i-1234567890    # Stop an instance
espada aws sg list                   # List security groups
espada aws keypair list              # List key pairs
espada aws asg list                  # List Auto Scaling groups
espada aws asg scale my-asg 5       # Set desired capacity
espada aws elb list                  # List load balancers
espada aws services                  # Discover available services
espada aws cloudtrail events         # Recent audit events
```

Add `--region <region>` to any command to override the default region.

## Agent tools

The plugin registers 15 agent tools that the AI can use when you ask about
AWS infrastructure:

| Tool | Description |
|---|---|
| `aws_authenticate` | Set up AWS authentication (SSO or access keys) |
| `aws_ec2` | Manage EC2 instances (list, start, stop, terminate) |
| `aws_security_group` | Manage security groups and rules |
| `aws_cloudtrail` | Query CloudTrail audit events |
| `aws_discover` | Discover AWS services and resources |
| `aws_rds` | Manage RDS databases and snapshots |
| `aws_lambda` | Manage Lambda functions and deployments |
| `aws_s3` | Manage S3 buckets and objects |
| `aws_iac` | Generate infrastructure-as-code templates |
| `aws_cost` | Analyze costs and budgets |
| `aws_security` | Security analysis (IAM, GuardDuty, Security Hub) |
| `aws_guardrails` | Operational guardrails and change management |
| `aws_organizations` | AWS Organizations and service control policies |
| `aws_backup` | Automated backup management |
| `aws_cicd` | CodePipeline, CodeBuild, CodeDeploy, blue/green deployments |
| `aws_network` | VPCs, subnets, route tables, NAT/internet gateways, VPC peering |
| `aws_assistant` | Natural language AWS infrastructure assistant |

## Example conversations

> "List all running EC2 instances in us-west-2"

> "Create a security group for my web server allowing port 80 and 443"

> "Show me the cost breakdown for the last 30 days"

> "Deploy this Lambda function with Node.js 22 runtime"

> "Set up S3 bucket versioning and lifecycle policies for my-data-bucket"

## Gateway methods

For programmatic access via the Gateway WebSocket API:

- `aws/identity` — current AWS identity
- `aws/ec2/instances` — list EC2 instances
- `aws/ec2/start` / `aws/ec2/stop` / `aws/ec2/terminate` — instance lifecycle
- `aws/ec2/security-groups` — list security groups
- `aws/ec2/key-pairs` — list key pairs
- `aws/asg/list` / `aws/asg/scale` — Auto Scaling
- `aws/elb/list` — load balancers
- `aws/services` — service discovery
- `aws/cloudtrail/events` — audit events

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
