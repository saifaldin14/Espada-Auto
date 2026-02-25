# Slack

Espada Slack channel plugin.

## Overview

The Slack extension connects your Espada AI agent to Slack, enabling it to participate in channels, respond to direct messages, and handle interactions within your Slack workspace. It registers as a channel provider in the Espada gateway.

## Features

- Send and receive messages in Slack channels and DMs
- Thread and reply support
- Slash command handling
- File and media attachment support
- Automatic reconnection via Socket Mode or RTM

## Installation

```bash
cd extensions/slack
pnpm install
```

## Configuration

Set your Slack bot token in Espada configuration:

```bash
espada config set slack.token xoxb-YOUR-BOT-TOKEN
```

Requires a Slack app with Bot Token Scopes configured in the [Slack API Dashboard](https://api.slack.com/apps).

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
