# VCS

Version control system integration for the Espada AI agent gateway.

## Overview

The VCS extension provides GitHub and GitLab integration for Espada, enabling AI-driven pull request automation, webhook handling, and plan commenting. It bridges your agent with your VCS platform for streamlined code review and infrastructure change workflows.

## Features

- GitHub and GitLab PR/MR automation
- Webhook event handling and routing
- Automated plan commenting on pull requests
- PR status checks and approval workflows
- Branch and repository management
- Commit status updates
- Agent-facing tools for VCS operations
- Multi-repository support

## Installation

```bash
cd extensions/vcs
pnpm install
```

## Configuration

```yaml
extensions:
  vcs:
    provider: github        # or "gitlab"
    github:
      token: ${GITHUB_TOKEN}
      webhook_secret: ${GITHUB_WEBHOOK_SECRET}
    gitlab:
      token: ${GITLAB_TOKEN}
      webhook_secret: ${GITLAB_WEBHOOK_SECRET}
```

## Usage

Manage VCS integrations through the agent or CLI:

```bash
espada vcs prs list --repo my-org/my-repo
espada vcs comment --pr 42 --body "Terraform plan attached"
espada vcs webhook setup --repo my-org/my-repo
```

The agent can automate workflows like "post the Terraform plan output as a PR comment" or "list open PRs that need review."

## License

MIT
