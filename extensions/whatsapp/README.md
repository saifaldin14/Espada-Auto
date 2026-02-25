# WhatsApp

Espada WhatsApp channel plugin.

## Overview

The WhatsApp extension connects your Espada AI agent to WhatsApp, enabling it to send and receive messages through the WhatsApp platform. It registers as a channel provider in the Espada gateway.

## Features

- Send and receive WhatsApp messages
- Support for individual and group conversations
- Media attachment handling (images, documents, audio)
- Message templates and rich formatting
- Automatic reconnection on connection loss

## Installation

```bash
cd extensions/whatsapp
pnpm install
```

## Configuration

See the main Espada configuration documentation for WhatsApp setup.

```bash
espada config set whatsapp.enabled true
```

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
