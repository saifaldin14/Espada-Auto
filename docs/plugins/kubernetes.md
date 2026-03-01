---
summary: "Kubernetes plugin: kubectl operations, Helm chart management, resource parsing, rollouts, and scaling"
read_when:
  - You want to manage Kubernetes clusters through Espada
  - You need to install, upgrade, or rollback Helm charts
  - You are configuring or developing the Kubernetes extension
---

# Kubernetes (plugin)

Kubernetes cluster management for Espada. Run kubectl operations, manage
Helm charts, parse resources, scale workloads, inspect logs, and handle
rollouts — all through natural language or CLI commands.

Current capabilities:
- **Resources** — get, apply, diff, delete across all resource types
- **Pods** — log retrieval, container inspection
- **Scaling** — replica count changes for deployments, statefulsets, replicasets
- **Rollouts** — restart, undo, status, history for deployments
- **Helm** — install, upgrade, uninstall, rollback, template, repo management, search
- **Graph bridge** — feed discovered resources into the knowledge graph

## Prerequisites

1. **Node.js 22+**
2. **kubectl** installed and configured with a valid kubeconfig
3. **Helm 3** installed (for Helm tools)
4. **Espada** installed and configured

## Install

```bash
espada plugins install @espada/kubernetes
```

Restart the Gateway afterwards.

## Agent tools

The plugin registers **20 agent tools** across two categories:

### Kubernetes tools (8)

| Tool | Safety | Description |
|---|---|---|
| `k8s_resources` | Read-only | Parse Kubernetes resource JSON and return normalised resources with relationships |
| `k8s_get` | Read-only | Run `kubectl get` for a resource type and return parsed results |
| `k8s_diff` | Read-only | Run `kubectl diff` against a manifest to preview changes |
| `k8s_apply` | ⚠ Mutating | Apply a manifest file (supports `--dry-run`) |
| `k8s_delete` | ⚠ Destructive | Delete a resource by type and name |
| `k8s_logs` | Read-only | Retrieve container logs from a pod |
| `k8s_scale` | ⚠ Mutating | Change replica count for a deployment/statefulset |
| `k8s_rollout` | ⚠ Mutating | Manage rollouts: restart, undo, status, history |

### Helm tools (12)

| Tool | Safety | Description |
|---|---|---|
| `helm_install` | ⚠ Mutating | Install a Helm chart as a new release |
| `helm_upgrade` | ⚠ Mutating | Upgrade an existing Helm release |
| `helm_uninstall` | ⚠ Destructive | Uninstall a Helm release and all managed resources |
| `helm_list` | Read-only | List all Helm releases (filter by namespace/name) |
| `helm_status` | Read-only | Show detailed status of a Helm release |
| `helm_rollback` | ⚠ Mutating | Roll back a release to a previous revision |
| `helm_history` | Read-only | Show revision history of a release |
| `helm_get_values` | Read-only | Get values currently applied to a release |
| `helm_template` | Read-only | Render chart templates locally (no cluster changes) |
| `helm_repo_add` | Safe | Add a Helm chart repository |
| `helm_repo_update` | Safe | Update all configured chart repository listings |
| `helm_search` | Read-only | Search chart repositories for charts matching a keyword |

## CLI wrappers

The plugin provides 13 kubectl wrapper functions used internally by
the agent tools:

`kubectlGet`, `kubectlApply`, `kubectlApplyDryRun`, `kubectlDiff`,
`kubectlDescribe`, `kubectlDelete`, `kubectlLogs`, `kubectlScale`,
`kubectlRolloutStatus`, `kubectlRolloutRestart`, `kubectlRolloutUndo`,
`kubectlRolloutHistory`, `kubectlGetNamespaces`

## Gateway methods

| Method | Description |
|---|---|
| `k8s/resources` | List Kubernetes resources |
| `k8s/namespaces` | List available namespaces |

## Example conversations

### Kubernetes

> "List all pods in the production namespace"

> "Show me the logs from the api-server pod"

> "Scale the web-frontend deployment to 5 replicas"

> "Apply this manifest file to the staging namespace"

> "Roll back the api deployment to the previous version"

> "Show the diff for my updated deployment manifest"

### Helm

> "Install nginx-ingress from the bitnami repo into the ingress namespace"

> "Upgrade my-release to chart version 2.0.0 with custom values"

> "Roll back the redis release to revision 3"

> "List all Helm releases in the production namespace"

> "Show me the history of the postgres release"

> "Search for chart repositories matching 'prometheus'"

> "Render the templates for my chart locally before installing"

## Helm workflow example

A typical Helm workflow through the agent:

```
1. helm_repo_add      → Add a chart repository
2. helm_repo_update   → Refresh available charts
3. helm_search        → Find the chart you need
4. helm_template      → Preview rendered manifests
5. helm_install       → Install the release
6. helm_status        → Verify deployment succeeded
7. helm_upgrade       → Update with new values/version
8. helm_rollback      → Roll back if issues arise
9. helm_history       → Inspect revision history
10. helm_get_values   → Check current configuration
11. helm_uninstall    → Clean up when done
```

## Troubleshooting

**"kubectl not found"** — install kubectl and ensure it's on your PATH.
See [kubernetes.io/docs/tasks/tools](https://kubernetes.io/docs/tasks/tools/).

**"helm not found"** — install Helm 3 from
[helm.sh/docs/intro/install](https://helm.sh/docs/intro/install/).

**Context/namespace issues** — the tools use your current kubeconfig
context. Pass `namespace` to target a specific namespace, or switch
context with `kubectl config use-context`.

**Dry-run mode** — use `k8s_apply` with `dryRun: true` or
`helm_template` to preview changes before applying.
