---
summary: "CLI reference for `espada logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
---

# `espada logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:
- Logging overview: [Logging](/logging)

## Examples

```bash
espada logs
espada logs --follow
espada logs --json
espada logs --limit 500
```

