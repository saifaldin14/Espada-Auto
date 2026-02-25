# Memory Core

Core memory search plugin for the Espada AI agent gateway.

## Overview

The Memory Core extension provides the foundational memory search interface for Espada agents. It defines the core abstractions for storing and retrieving agent memories, serving as the base layer that concrete memory backends (such as LanceDB) implement.

## Features

- Core memory search and retrieval interface
- Pluggable backend architecture
- Semantic search across agent memories
- Memory lifecycle management (store, query, delete)
- Integration with the Espada agent runtime

## Installation

```bash
cd extensions/memory-core
pnpm install
```

## Configuration

See the main Espada configuration documentation. Memory Core is typically used alongside a concrete backend extension like `memory-lancedb`.

```yaml
extensions:
  memory-core:
    enabled: true
```

## Usage

Enable the extension in your Espada configuration. Memory Core provides the search interface; pair it with a storage backend for full functionality.

## License

MIT
