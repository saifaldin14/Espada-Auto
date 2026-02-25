# Matrix

Espada Matrix channel plugin.

## Overview

The Matrix extension connects your Espada AI agent to the Matrix decentralized communication network. It supports encrypted messaging, room management, and federation — enabling your agent to participate in Matrix rooms across any homeserver.

## Features

- Send and receive messages in Matrix rooms
- End-to-end encryption (E2EE) support
- Room creation and management
- Federated messaging across homeservers
- Media upload and attachment handling
- Thread and reply support
- Typing indicators and read receipts
- User presence and room membership tracking
- Invite handling and auto-join support

## Installation

```bash
cd extensions/matrix
pnpm install
```

## Configuration

Configure your Matrix homeserver and credentials:

```yaml
extensions:
  matrix:
    homeserver: https://matrix.example.com
    user_id: "@espada:example.com"
    access_token: ${MATRIX_ACCESS_TOKEN}
```

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

Invite the bot user to a Matrix room and it will begin responding.

## License

MIT
