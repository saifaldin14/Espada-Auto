---
summary: "CLI reference for `espada voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
---

# `espada voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:
- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
espada voicecall status --call-id <id>
espada voicecall call --to "+15555550123" --message "Hello" --mode notify
espada voicecall continue --call-id <id> --message "Any questions?"
espada voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
espada voicecall expose --mode serve
espada voicecall expose --mode funnel
espada voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.

