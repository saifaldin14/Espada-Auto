# Mattermost

Espada Mattermost channel plugin.

## Overview

The Mattermost extension connects your Espada AI agent to Mattermost, the open-source messaging platform. It enables your agent to participate in channels, respond to direct messages, and handle slash commands in self-hosted Mattermost instances.

## Features

- Send and receive messages in channels and DMs
- Slash command handling
- Thread and reply support
- File and media attachment handling
- WebSocket-based real-time messaging
- Multi-team support
- Automatic reconnection on connection loss
- Typing indicator support

## Installation

```bash
cd extensions/mattermost
pnpm install
```

## Configuration

Configure your Mattermost server connection:

```yaml
extensions:
  mattermost:
    server: https://mattermost.example.com
    token: ${MATTERMOST_BOT_TOKEN}
    team: my-team
```

Requires a bot account created in your Mattermost instance.

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
