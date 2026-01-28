---
summary: "CLI reference for `espada onboard` (interactive onboarding wizard)"
read_when:
  - You want guided setup for gateway, workspace, auth, channels, and skills
---

# `espada onboard`

Interactive onboarding wizard (local or remote Gateway setup).

Related:
- Wizard guide: [Onboarding](/start/onboarding)

## Examples

```bash
espada onboard
espada onboard --flow quickstart
espada onboard --flow manual
espada onboard --mode remote --remote-url ws://gateway-host:18789
```

Flow notes:
- `quickstart`: minimal prompts, auto-generates a gateway token.
- `manual`: full prompts for port/bind/auth (alias of `advanced`).
- Fastest first chat: `espada dashboard` (Control UI, no channel setup).
