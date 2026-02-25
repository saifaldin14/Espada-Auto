# Kubernetes

Kubernetes integration for the Espada AI agent gateway.

## Overview

The Kubernetes extension provides deep Kubernetes integration for Espada, enabling AI-driven cluster management. It includes manifest parsing, kubectl command wrapping, resource graph bridging for topology visualization, and agent-facing tools for conversational cluster operations.

## Features

- Kubernetes manifest parsing and validation
- kubectl command wrapping with structured output
- Resource graph bridging for topology visualization
- Namespace and context management
- Pod, deployment, service, and ingress operations
- Log streaming and event monitoring
- Agent-facing tools for conversational cluster ops

## Installation

```bash
cd extensions/kubernetes
pnpm install
```

## Configuration

```yaml
extensions:
  kubernetes:
    kubeconfig: ~/.kube/config
    context: my-cluster
    default_namespace: default
```

Requires `kubectl` installed and a valid kubeconfig.

## Usage

Manage Kubernetes resources through the agent or CLI:

```bash
espada k8s pods list --namespace production
espada k8s apply --file deployment.yaml
espada k8s logs --pod my-app-xyz --tail 100
```

The agent can answer questions like "what pods are failing in production?" or "scale the web deployment to 5 replicas."

## License

MIT
