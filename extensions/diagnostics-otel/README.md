# Diagnostics OpenTelemetry

OpenTelemetry exporter for Espada diagnostics.

## Overview

The Diagnostics OpenTelemetry extension exports Espada gateway telemetry data (traces, metrics, and logs) to any OpenTelemetry-compatible backend. This enables integration with observability platforms like Jaeger, Grafana, Datadog, and others for production monitoring and debugging.

## Features

- Export traces, metrics, and logs via OpenTelemetry protocol (OTLP)
- Compatible with any OTLP-capable backend
- Configurable export intervals and batching
- Automatic instrumentation of gateway operations
- Support for custom span attributes and resource labels

## Installation

```bash
cd extensions/diagnostics-otel
pnpm install
```

## Configuration

```yaml
extensions:
  diagnostics-otel:
    endpoint: http://localhost:4318
    protocol: http/protobuf   # or grpc
    service_name: espada-gateway
    export_interval: 30000
```

## Usage

Enable the extension in your Espada configuration. Telemetry data is automatically exported to the configured OTLP endpoint once the gateway starts.

Verify with your backend's dashboard or:

```bash
espada diagnostics status
```

## License

MIT
