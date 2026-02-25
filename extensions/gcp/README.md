# GCP

Google Cloud Platform plugin for Espada infrastructure management.

## Overview

The GCP extension provides comprehensive Google Cloud Platform integration for the Espada gateway. It enables AI-driven infrastructure management across GCP services including Compute Engine, Cloud Storage, Cloud SQL, GKE, Cloud Functions, networking, IAM, and more — with full resource lifecycle support.

## Features

- Compute Engine instance management (create, list, start, stop, delete)
- Google Kubernetes Engine (GKE) cluster operations
- Cloud Storage bucket and object management
- Cloud SQL instance provisioning and administration
- Cloud Functions deployment and invocation
- VPC networking, firewall rules, and load balancers
- IAM policy and service account management
- Cloud monitoring and logging queries
- Resource inventory and cost analysis
- Multi-project and multi-region support
- Agent-facing tools for conversational infrastructure ops

## Installation

```bash
cd extensions/gcp
pnpm install
```

## Configuration

Configure GCP credentials and project:

```yaml
extensions:
  gcp:
    project: my-gcp-project
    region: us-central1
    credentials: ~/.config/gcloud/application_default_credentials.json
```

Or use application default credentials:

```bash
gcloud auth application-default login
```

## Usage

Manage GCP resources through the agent or CLI:

```bash
espada gcp compute list --project my-project
espada gcp storage buckets list
espada gcp gke clusters list --region us-central1
```

The agent can also manage resources conversationally — e.g., "list all GKE clusters in production" or "create a Cloud SQL instance in us-east1."

## License

MIT
