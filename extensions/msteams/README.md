# Microsoft Teams

Espada Microsoft Teams channel plugin.

## Overview

The Microsoft Teams extension connects your Espada AI agent to Microsoft Teams, enabling it to participate in team channels, respond to direct messages, and handle adaptive card interactions within your organization's Teams environment.

## Features

- Send and receive messages in Teams channels and chats
- Direct message (1:1) conversations
- Adaptive Card rendering and interaction
- File and media attachment support
- Meeting and event notifications
- Thread and reply support
- Multi-tenant Azure AD authentication
- Proactive messaging capabilities
- Typing indicators and read receipts

## Installation

```bash
cd extensions/msteams
pnpm install
```

## Configuration

Configure your Microsoft Teams bot registration:

```yaml
extensions:
  msteams:
    app_id: ${TEAMS_APP_ID}
    app_password: ${TEAMS_APP_PASSWORD}
    tenant_id: ${TEAMS_TENANT_ID}
```

Requires a bot registered in the [Azure Bot Service](https://portal.azure.com/) with the Teams channel enabled.

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

Install the bot app in your Teams organization to begin interacting.

## License

MIT
