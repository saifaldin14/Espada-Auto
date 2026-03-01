---
summary: "CLI reference for `espada agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
---

# `espada agents`

Manage isolated agents (workspaces + auth + routing).

Related:
- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
espada agents list
espada agents add work --workspace ~/espada-work
espada agents set-identity --workspace ~/espada --from-identity
espada agents set-identity --agent main --avatar avatars/espada.png
espada agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:
- Example path: `~/espada/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:
- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
espada agents set-identity --workspace ~/espada --from-identity
```

Override fields explicitly:

```bash
espada agents set-identity --agent main --name "Espada" --emoji "🦞" --avatar avatars/espada.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Espada",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/espada.png"
        }
      }
    ]
  }
}
```
