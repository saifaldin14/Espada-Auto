# Telegram

Espada Telegram channel plugin.

## Overview

The Telegram extension connects your Espada AI agent to Telegram, enabling it to respond to messages in groups, channels, and direct conversations. It registers as a channel provider in the Espada gateway.

## Features

- Send and receive messages via Telegram Bot API
- Support for groups, supergroups, and direct messages
- Inline keyboard and reply markup support
- Media and file attachment handling
- Automatic reconnection on connection loss

## Installation

```bash
cd extensions/telegram
pnpm install
```

## Configuration

Set your Telegram bot token in Espada configuration:

```bash
espada config set telegram.token YOUR_BOT_TOKEN
```

Create a bot via [@BotFather](https://t.me/BotFather) on Telegram to obtain your token.

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
