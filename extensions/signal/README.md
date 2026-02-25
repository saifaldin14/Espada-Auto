# Signal

Espada Signal channel plugin.

## Overview

The Signal extension connects your Espada AI agent to Signal, the privacy-focused messaging platform. It registers as a channel provider in the Espada gateway, enabling secure, end-to-end encrypted conversations with your agent.

## Features

- Send and receive messages via Signal
- End-to-end encrypted messaging
- Support for individual and group conversations
- Media attachment handling
- Automatic reconnection on connection loss

## Installation

```bash
cd extensions/signal
pnpm install
```

## Configuration

See the main Espada configuration documentation for Signal setup.

```bash
espada config set signal.enabled true
```

Requires a registered Signal account linked to the gateway.

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
