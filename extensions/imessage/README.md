# iMessage

Espada iMessage channel plugin.

## Overview

The iMessage extension connects your Espada AI agent to Apple iMessage, enabling it to send and receive messages through iMessage on macOS. It registers as a channel provider in the Espada gateway.

## Features

- Send and receive iMessages through Espada
- Support for individual and group conversations
- Media attachment handling
- Read receipt support
- Native macOS integration

## Installation

```bash
cd extensions/imessage
pnpm install
```

## Configuration

See the main Espada configuration documentation. Requires macOS with an active iMessage account.

```bash
espada config set imessage.enabled true
```

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
