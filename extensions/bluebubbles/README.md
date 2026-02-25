# BlueBubbles

Espada BlueBubbles channel plugin for iMessage integration.

## Overview

The BlueBubbles extension bridges Espada to Apple iMessage via a BlueBubbles server. This enables your AI agent to send and receive iMessages through a self-hosted BlueBubbles instance, bringing iMessage into your unified messaging gateway.

## Features

- Send and receive iMessages through Espada
- Bridge to BlueBubbles server API
- Support for individual and group conversations
- Media attachment handling (images, files)
- Read receipt and typing indicator support
- Automatic reconnection and error recovery
- Message queue for reliable delivery

## Installation

```bash
cd extensions/bluebubbles
pnpm install
```

## Configuration

Configure connection to your BlueBubbles server:

```yaml
extensions:
  bluebubbles:
    server: http://localhost:1234
    password: your-bluebubbles-password
```

Requires a running [BlueBubbles](https://bluebubbles.app/) server on a Mac with an active iMessage account.

## Usage

Enable the extension in your Espada configuration. The plugin registers as a channel provider and automatically connects to your BlueBubbles server on gateway startup.

```bash
espada channels status --probe
```

## License

MIT
