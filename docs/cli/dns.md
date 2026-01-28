---
summary: "CLI reference for `espada dns` (wide-area discovery helpers)"
read_when:
  - You want wide-area discovery (DNS-SD) via Tailscale + CoreDNS
  - You’re setting up split DNS for espada.internal
---

# `espada dns`

DNS helpers for wide-area discovery (Tailscale + CoreDNS). Currently focused on macOS + Homebrew CoreDNS.

Related:
- Gateway discovery: [Discovery](/gateway/discovery)
- Wide-area discovery config: [Configuration](/gateway/configuration)

## Setup

```bash
espada dns setup
espada dns setup --apply
```

