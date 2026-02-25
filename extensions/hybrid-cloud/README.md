# Hybrid Cloud

Hybrid and edge infrastructure discovery for the Espada AI agent gateway.

## Overview

The Hybrid Cloud extension provides unified topology discovery across hybrid and edge infrastructure. It aggregates resources from Azure Arc, AWS Outposts, GKE Enterprise, and Google Distributed Cloud into a single consistent view, enabling cross-cloud visibility and management through Espada.

## Features

- Unified topology view across hybrid/edge environments
- Azure Arc connected resource discovery
- AWS Outposts infrastructure inventory
- GKE Enterprise multi-cluster visibility
- Google Distributed Cloud edge node discovery
- Cross-cloud resource correlation and mapping
- Agent-facing tools for hybrid infrastructure queries

## Installation

```bash
cd extensions/hybrid-cloud
pnpm install
```

## Configuration

```yaml
extensions:
  hybrid-cloud:
    providers:
      azure_arc:
        enabled: true
        subscription_id: ${AZURE_SUBSCRIPTION_ID}
      aws_outposts:
        enabled: true
        region: us-east-1
      gke_enterprise:
        enabled: true
        fleet_project: my-fleet-project
```

## Usage

Discover and query hybrid infrastructure:

```bash
espada hybrid-cloud discover --provider all
espada hybrid-cloud topology --format json
```

The agent can answer questions like "show all edge nodes across providers" or "which Outposts resources are in us-west-2?"

## License

MIT
