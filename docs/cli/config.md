---
summary: "CLI reference for `espada config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
---

# `espada config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `espada configure`).

## Examples

```bash
espada config get browser.executablePath
espada config set browser.executablePath "/usr/bin/google-chrome"
espada config set agents.defaults.heartbeat.every "2h"
espada config set agents.list[0].tools.exec.node "node-id-or-name"
espada config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
espada config get agents.defaults.workspace
espada config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
espada config get agents.list
espada config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
espada config set agents.defaults.heartbeat.every "0m"
espada config set gateway.port 19001 --json
espada config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
