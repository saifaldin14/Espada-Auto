---
summary: "Enterprise Auth plugin: RBAC roles and permissions, OIDC SSO, API key management, MFA support, JWT sessions, and SQLite-backed user storage"
read_when:
  - You need to manage users, roles, or permissions
  - You want to set up OIDC single sign-on
  - You need to create or revoke API keys
  - You want to check if a user has specific permissions
  - You are configuring role-based access control for Espada
---

# Enterprise Auth (plugin)

Role-based access control, OIDC SSO, API key management, and
session handling for Espada deployments. Defines 26 granular
permissions across infrastructure, policy, audit, Terraform, cost,
VCS, blueprint, user, and gateway domains. Ships with 4 built-in
roles, supports custom roles, and persists all data in SQLite
(WAL mode) with an in-memory backend for tests.

## Prerequisites

1. **Node.js 22+**
2. **Espada** installed and configured
3. **better-sqlite3** — bundled as a dependency for production storage

## Install

```bash
espada plugins install @espada/enterprise-auth
```

Restart the Gateway afterwards. On first start, built-in roles
(Viewer, Operator, Admin, Security) are automatically created.

---

## Built-in roles

4 roles are created on initialization and cannot be deleted:

| Role | ID | Permissions | Description |
|---|---|---|---|
| **Viewer** | `viewer` | 8 | Read-only access to infrastructure, policies, audits, costs, VCS, blueprints, users, roles |
| **Operator** | `operator` | 14 | Day-to-day infrastructure operations including Terraform plan/apply, VCS write, blueprint deploy |
| **Admin** | `admin` | 26 | Full access to all operations including user management, API keys, gateway admin |
| **Security** | `security` | 9 | Security-focused — policy read/write/evaluate, audit read/export, plus infra and cost read |

---

## Permissions

26 granular permissions organized by domain:

| Domain | Permissions |
|---|---|
| **Infrastructure** | `infra.read`, `infra.write`, `infra.delete`, `infra.admin` |
| **Policy** | `policy.read`, `policy.write`, `policy.evaluate` |
| **Audit** | `audit.read`, `audit.export` |
| **Terraform** | `terraform.plan`, `terraform.apply`, `terraform.destroy` |
| **Cost** | `cost.read`, `cost.approve` |
| **VCS** | `vcs.read`, `vcs.write` |
| **Blueprints** | `blueprint.read`, `blueprint.deploy` |
| **Users** | `user.read`, `user.write`, `user.admin` |
| **Roles** | `role.read`, `role.write` |
| **API Keys** | `apikey.create`, `apikey.revoke` |
| **Gateway** | `gateway.admin` |

---

## Agent tools

4 tools for checking permissions, listing roles, querying user info,
and creating API keys through natural language:

### auth_check_permission

Check if a user has the required permissions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `userId` | string | Yes | User ID to check |
| `permissions` | string[] | Yes | List of permissions to check |

**Output**: `allowed` (boolean), `reason`, `missingPermissions`,
`matchedRole` (the role that granted access, if any).

### auth_list_roles

List all available roles with their permissions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| _(none)_ | — | — | — |

**Output**: Array of roles with ID, name, description, permission
count, and `builtIn` flag.

### auth_user_info

Get user information including roles and resolved permissions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `userId` | string | No | User ID |
| `email` | string | No | User email (fallback lookup) |

At least one of `userId` or `email` must be provided.

**Output**: User ID, email, name, roles, resolved permissions set,
MFA status, disabled status, last login, SSO provider.

### auth_api_key_create

Create a new API key for a user. The raw key is shown once only.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `userId` | string | Yes | User ID to create key for |
| `name` | string | Yes | Descriptive name for the API key |
| `permissions` | string[] | Yes | Permissions granted to the key |
| `expiresInDays` | number | No | Key expiration in days |

**Output**: Key ID, name, raw API key (format `esp_<base64url>`),
prefix (first 12 chars), expiration date, and a warning to save
the key immediately.

---

## CLI commands

All commands live under `espada auth`:

```
espada auth
├── roles                       Manage RBAC roles
│   ├── list                    List all roles
│   │   --json                  Output as JSON
│   ├── show <id>               Show role details
│   ├── create                  Create a custom role
│   │   --name <name>           Role name (required)
│   │   --permissions <p...>    Permissions (required)
│   │   --description <desc>    Description
│   └── delete <id>             Delete a custom role
├── users                       Manage users
│   ├── list                    List all users
│   │   --role <role>           Filter by role
│   │   --json                  Output as JSON
│   ├── create                  Create a user
│   │   --email <email>         Email address (required)
│   │   --name <name>           Full name (required)
│   │   --roles <roles...>      Role IDs (default: viewer)
│   ├── assign-role <userId> <roleId>
│   │                           Assign a role to a user
│   └── check <userId> <permissions...>
│                               Check user permissions
├── apikeys                     Manage API keys
│   ├── create                  Create an API key
│   │   --user <userId>         User ID (required)
│   │   --name <name>           Key name (required)
│   │   --permissions <p...>    Permissions (default: infra.read)
│   │   --expires <days>        Expiration in days
│   ├── list <userId>           List API keys for a user
│   └── revoke <id>             Revoke an API key
└── sso                         Manage OIDC SSO providers
    ├── list                    List OIDC providers
    ├── add <file>              Add provider from JSON config file
    └── remove <id>             Remove an OIDC provider
```

### CLI examples

```bash
# List all roles
espada auth roles list

# Show role details
espada auth roles show operator

# Create a custom role
espada auth roles create --name "Deploy Only" \
  --permissions terraform.plan terraform.apply blueprint.deploy \
  --description "Can deploy but not destroy"

# Delete a custom role
espada auth roles delete deploy-only

# List all users
espada auth users list

# List users with admin role
espada auth users list --role admin

# Create a user
espada auth users create --email alice@example.com --name "Alice" \
  --roles operator security

# Assign a role
espada auth users assign-role user-123 admin

# Check permissions
espada auth users check user-123 terraform.apply infra.write

# Create an API key (expires in 90 days)
espada auth apikeys create --user user-123 --name "CI Pipeline" \
  --permissions infra.read terraform.plan terraform.apply \
  --expires 90

# List API keys
espada auth apikeys list user-123

# Revoke an API key
espada auth apikeys revoke apikey-abc123

# List SSO providers
espada auth sso list

# Add an OIDC provider
espada auth sso add ./okta-config.json

# Remove an OIDC provider
espada auth sso remove oidc-okta
```

---

## Gateway methods

4 gateway methods for programmatic access via the Gateway WebSocket API:

| Method | Parameters | Description |
|---|---|---|
| `auth/check` | `userId`, `permissions[]` | Check if a user has the required permissions. Returns `allowed`, `reason`, `missingPermissions`, `matchedRole`. |
| `auth/roles` | _(none)_ | List all roles with permissions. |
| `auth/users` | `role?` | List users, optionally filtered by role. |
| `auth/sso/providers` | _(none)_ | List configured OIDC SSO providers. |

---

## OIDC SSO

The plugin supports OIDC-based single sign-on with automatic
role mapping from identity provider claims.

### Provider configuration

OIDC providers are added via JSON config file:

```json
{
  "id": "okta-prod",
  "name": "Okta Production",
  "issuerUrl": "https://company.okta.com",
  "clientId": "0oa1abc2def3ghi4j5k6",
  "clientSecret": "secret-value",
  "scopes": ["openid", "profile", "email", "groups"],
  "callbackUrl": "https://espada.example.com/auth/callback",
  "roleMappings": [
    { "claim": "groups", "value": "infra-admins", "role": "admin" },
    { "claim": "groups", "value": "infra-ops", "role": "operator" },
    { "claim": "groups", "value": "security-team", "role": "security" }
  ],
  "enabled": true
}
```

### Role mappings

Role mappings connect OIDC claim values to Espada roles:

| Field | Description |
|---|---|
| `claim` | OIDC claim name (e.g. `groups`, `roles`) |
| `value` | Value to match in the claim |
| `role` | Espada role ID to assign when the claim matches |

Users authenticated via SSO are linked by `ssoProviderId` and
`externalId` (the OIDC subject).

---

## API keys

API keys provide programmatic access for CI/CD pipelines, scripts,
and integrations.

- **Format**: `esp_<base64url>` (32 random bytes)
- **Storage**: Only the SHA-256 hash is stored; the raw key is shown
  once at creation
- **Prefix**: First 12 characters are stored for display purposes
- **Scoped permissions**: Each key has its own permission set
  (independent of the user's role permissions)
- **Expiration**: Optional expiry in days
- **Revocation**: Keys can be revoked immediately via CLI or gateway

---

## RBAC engine

The RBAC engine resolves permissions from roles and checks
authorization:

- **`authorize(user, permissions)`** — checks if a user has ALL
  required permissions; returns `allowed`, `reason`,
  `missingPermissions`, and the `matchedRole` that granted access
- **`authorizeAny(user, permissions)`** — checks if a user has
  ANY of the required permissions
- **`getUserPermissions(user)`** — resolves all permissions from
  the user's assigned roles into a flat `Set<Permission>`
- **Role caching** — roles are cached in memory after first lookup;
  cache clears on role updates or `initializeBuiltInRoles()`
- **Disabled users** — authorization is automatically denied for
  disabled accounts

---

## Storage

Two storage backends:

| Backend | Use | Details |
|---|---|---|
| **SQLiteAuthStorage** | Production | SQLite with WAL mode, `NORMAL` sync, foreign keys enabled. Database stored at `enterprise-auth.db` in the plugin data directory. |
| **InMemoryAuthStorage** | Testing | In-memory maps with `structuredClone` for isolation. Activated when `NODE_ENV=test` or `ESPADA_TEST=1`. |

### Database schema

5 tables with indexes:

| Table | Primary key | Indexes |
|---|---|---|
| `roles` | `id` | — |
| `users` | `id` | `email` (unique), `(sso_provider_id, external_id)` |
| `sessions` | `id` | `user_id`, `expires_at` |
| `api_keys` | `id` | `key_hash` (unique), `user_id` |
| `oidc_providers` | `id` | — |

### Session management

Sessions track:
- JWT token hash (the token itself is not stored)
- Expiration time
- Last activity timestamp
- IP address and user agent

Expired sessions can be pruned via `pruneExpiredSessions()`.

---

## MFA support

Users have `mfaEnabled` and `mfaSecret` (TOTP) fields. When MFA
is enabled, the TOTP secret is stored encrypted at rest. MFA status
is reported in `auth_user_info` output.

---

## Example conversations

> "What roles are available?"

> "Check if user-123 has terraform.apply permission"

> "Create an API key for the CI pipeline with deploy permissions"

> "Who has the admin role?"

> "Show me Alice's permissions"

> "Set up OIDC with Okta"

> "Revoke all API keys for user-456"

---

## Troubleshooting

**"User not found"** — the user ID or email does not exist in the
database. Create the user first with `espada auth users create`.

**"Missing permissions"** — the user's assigned roles do not include
the required permissions. Use `espada auth users assign-role` to
add a role, or create a custom role with the needed permissions.

**Built-in roles cannot be deleted** — the Viewer, Operator, Admin,
and Security roles are protected. Create custom roles instead.

**API key shown once** — the raw API key is only displayed at creation
time. If lost, revoke the old key and create a new one.

**SQLite WAL mode** — the database uses WAL journaling for concurrent
reads. If you see locking issues, ensure only one Espada instance
accesses the database file.

**SSO users not appearing** — OIDC providers must be enabled and the
callback URL must be accessible. Check `espada auth sso list` for
provider status.
