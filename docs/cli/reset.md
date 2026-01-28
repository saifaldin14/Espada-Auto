---
summary: "CLI reference for `espada reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `espada reset`

Reset local config/state (keeps the CLI installed).

```bash
espada reset
espada reset --dry-run
espada reset --scope config+creds+sessions --yes --non-interactive
```

