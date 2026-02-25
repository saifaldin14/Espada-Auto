# Nextcloud Talk

Espada Nextcloud Talk channel plugin.

## Overview

The Nextcloud Talk extension connects your Espada AI agent to Nextcloud Talk, the communication platform built into Nextcloud. It enables your agent to participate in conversations, respond to messages, and integrate with your self-hosted Nextcloud instance.

## Features

- Send and receive messages in Nextcloud Talk conversations
- Support for one-on-one and group conversations
- File sharing through Nextcloud integration
- Rich message formatting support
- Polling-based or webhook message retrieval
- Automatic reconnection and error recovery
- Room management and membership handling

## Installation

```bash
cd extensions/nextcloud-talk
pnpm install
```

## Configuration

Configure your Nextcloud instance connection:

```yaml
extensions:
  nextcloud-talk:
    server: https://nextcloud.example.com
    username: espada-bot
    password: ${NEXTCLOUD_PASSWORD}
```

Requires a Nextcloud instance with the Talk app installed.

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
