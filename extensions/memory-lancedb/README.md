# Memory LanceDB

LanceDB-backed long-term memory plugin for the Espada AI agent gateway.

## Overview

The Memory LanceDB extension provides persistent long-term memory for Espada agents using LanceDB as the vector storage backend. It supports automatic memory capture during conversations and semantic recall, enabling agents to remember context across sessions.

## Features

- LanceDB vector storage for agent memories
- Automatic memory capture from conversations
- Semantic similarity search for memory recall
- Configurable embedding models
- Memory expiry and lifecycle management
- Auto-recall of relevant context during conversations

## Installation

```bash
cd extensions/memory-lancedb
pnpm install
```

## Configuration

```yaml
extensions:
  memory-lancedb:
    db_path: ~/.espada/memory/lancedb
    auto_capture: true
    auto_recall: true
    embedding_model: default
```

## Usage

Enable the extension in your Espada configuration. Memories are automatically captured and recalled during agent conversations.

The agent can also explicitly manage memories — e.g., "remember that the production database is in us-east-1" or "what do you remember about the deployment process?"

## License

MIT
