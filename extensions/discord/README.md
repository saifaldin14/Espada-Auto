# Discord

Espada Discord channel plugin.

## Overview

The Discord extension connects your Espada AI agent to Discord, allowing it to receive and respond to messages in Discord servers and direct messages. It registers as a channel provider in the Espada gateway.

## Features

- Send and receive messages in Discord channels and DMs
- Support for Discord slash commands
- Media and file attachment handling
- Thread and reply support
- Automatic reconnection on connection loss

## Installation

```bash
cd extensions/discord
pnpm install
```

## Configuration

Set your Discord bot token in Espada configuration:

```bash
espada config set discord.token YOUR_BOT_TOKEN
```

Ensure your Discord bot has the required permissions and intents enabled in the [Discord Developer Portal](https://discord.com/developers/applications).

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
