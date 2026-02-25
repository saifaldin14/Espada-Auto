# LINE

Espada LINE channel plugin.

## Overview

The LINE extension connects your Espada AI agent to the LINE messaging platform, popular across Japan, Taiwan, Thailand, and Southeast Asia. It registers as a channel provider in the Espada gateway.

## Features

- Send and receive messages via LINE Messaging API
- Support for text, image, and rich message types
- Group and multi-person chat support
- LINE-specific message templates and flex messages
- Webhook-based event handling

## Installation

```bash
cd extensions/line
pnpm install
```

## Configuration

Configure your LINE channel credentials:

```yaml
extensions:
  line:
    channel_access_token: ${LINE_CHANNEL_ACCESS_TOKEN}
    channel_secret: ${LINE_CHANNEL_SECRET}
```

Requires a LINE Official Account and Messaging API channel configured in the [LINE Developers Console](https://developers.line.biz/).

## Usage

Enable the extension and start the gateway:

```bash
espada gateway run
espada channels status --probe
```

## License

MIT
