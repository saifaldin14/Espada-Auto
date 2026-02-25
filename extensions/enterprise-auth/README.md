# Enterprise Auth

Enterprise SSO and RBAC extension for the Espada AI agent gateway.

## Overview

The Enterprise Auth extension adds enterprise-grade authentication and authorization to Espada. It supports Single Sign-On via OIDC providers, JWT-based session management, and fine-grained role-based access control (RBAC) with customizable roles and permissions for multi-tenant deployments.

## Features

- OIDC-based Single Sign-On (SSO) with major identity providers
- JWT session management with configurable expiry and refresh
- Role-based access control (RBAC) with custom roles
- Fine-grained permission assignments per role
- Multi-tenant support with organization-scoped access
- API key management for service-to-service auth
- Audit logging integration for auth events

## Installation

```bash
cd extensions/enterprise-auth
pnpm install
```

## Configuration

```yaml
extensions:
  enterprise-auth:
    oidc:
      issuer: https://auth.example.com
      client_id: espada-gateway
      client_secret: ${OIDC_CLIENT_SECRET}
    jwt:
      secret: ${JWT_SECRET}
      expiry: 3600
    rbac:
      default_role: viewer
```

## Usage

Enable the extension in your Espada configuration. Users authenticate via your OIDC provider and receive JWT sessions with role-based permissions.

Manage roles:

```bash
espada auth roles list
espada auth roles assign --user user@example.com --role admin
```

## License

MIT
