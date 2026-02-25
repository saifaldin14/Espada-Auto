# Blueprints

Infrastructure blueprint templates and provisioning engine for Espada.

## Overview

The Blueprints extension provides a template-driven infrastructure provisioning system for the Espada gateway. Define reusable infrastructure blueprints, customize them with parameters, and deploy consistent environments through the agent or CLI. Includes a built-in library of common patterns.

## Features

- Declarative blueprint template definitions
- Built-in library of common infrastructure patterns
- Custom blueprint authoring with typed parameters
- Template engine for variable substitution and composition
- CLI commands for listing, validating, and deploying blueprints
- Agent-facing tools for blueprint discovery and provisioning
- Dry-run and plan modes before applying changes

## Installation

```bash
cd extensions/blueprints
pnpm install
```

## Configuration

```yaml
extensions:
  blueprints:
    library_path: ~/.espada/blueprints
    custom_path: ./my-blueprints
```

## Usage

List available blueprints:

```bash
espada blueprints list
espada blueprints show web-app-stack
```

Deploy a blueprint:

```bash
espada blueprints deploy web-app-stack --param region=us-east-1 --param tier=production
```

## Architecture

| Module    | Purpose                              |
| --------- | ------------------------------------ |
| `engine`  | Blueprint rendering and deployment   |
| `library` | Built-in blueprint catalog           |
| `custom`  | Custom blueprint loader              |
| `tools`   | Agent-facing blueprint tools         |
| `cli`     | CLI commands                         |
| `types`   | Shared type definitions              |

## License

MIT
