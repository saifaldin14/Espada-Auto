# Google Chat

Espada Google Chat channel plugin.

## Overview

The Google Chat extension connects your Espada AI agent to Google Chat (formerly Hangouts Chat), enabling it to participate in spaces, respond to direct messages, and handle card interactions within Google Workspace environments.

## Features

- Send and receive messages in Google Chat spaces and DMs
- Interactive card and dialog support
- Thread-aware conversations
- Slash command handling
- Media and file attachment support
- Google Workspace integration
- Automatic reconnection and error recovery

## Installation

```bash
cd extensions/googlechat
pnpm install
```

## Configuration

Configure your Google Chat bot credentials:

```yaml
extensions:
  googlechat:
    credentials: ~/.espada/google-chat-credentials.json
    project_id: your-project-id
```

Requires a Google Chat bot configured in the [Google Cloud Console](https://console.cloud.google.com/) with the Chat API enabled.

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
