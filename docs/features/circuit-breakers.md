# Circuit Breakers & Resilience Patterns

> **Status**: Implemented (Phase 1)  
> **Roadmap**: Feature #17

Circuit breakers prevent cascading failures by detecting degraded
dependencies and failing fast instead of burning resources on calls that are
likely to time out.

---

## How it works

Each circuit breaker maintains a three-state machine:

```
    success          timeout expires        probe succeeds
 ┌──────────┐     ┌──────────────┐      ┌─────────────────┐
 │  CLOSED  │────▸│    OPEN      │─────▸│   HALF_OPEN     │──▸ CLOSED
 └──────────┘     └──────────────┘      └─────────────────┘
   (normal)       (fail fast)            (limited probes)
                                              │
                                              │ probe fails
                                              ▼
                                            OPEN
```

| State     | Behaviour                                                    |
|-----------|--------------------------------------------------------------|
| **Closed** | Calls pass through normally. Consecutive failures are counted. |
| **Open**   | All calls are immediately rejected with `CircuitOpenError`.  |
| **Half-open** | A limited number of probe calls are allowed through. Success transitions back to Closed; failure re-opens. |

### Configuration

```ts
import { CircuitBreaker } from "./infra/circuit-breaker.js";

const breaker = new CircuitBreaker<Response>("my-service", {
  failureThreshold: 5,     // consecutive failures before opening
  resetTimeoutMs: 60_000,  // how long to stay open before probing
  halfOpenMaxProbes: 1,    // concurrent probes in half-open state
  callTimeoutMs: 30_000,   // optional per-call timeout
  shouldTrip: (err) => {   // filter which errors actually count
    return err instanceof Error && err.message.includes("timeout");
  },
  onStateChange: (event) => {
    console.log(`${event.name}: ${event.from} → ${event.to}`);
  },
});
```

---

## Integration points

### LLM providers

Each LLM provider gets its own circuit breaker, registered as `llm:<provider>`
in the global registry. The breaker trips on transient errors only:

- Rate limits (429 / `rate_limit` reason)
- Timeouts
- Auth / billing failures
- Server errors (5xx)

**Files**: `src/agents/pi-embedded-runner/circuit-breaker-llm.ts`,
`src/agents/pi-embedded-runner/run.ts`

When a provider's circuit is open, the failover system immediately
promotes the fallback provider instead of waiting for the primary to
time out. This is logged at `warn` level and emitted as a diagnostic
event.

```ts
import {
  isLLMProviderAvailable,
  recordLLMProviderSuccess,
  recordLLMProviderFailure,
} from "./circuit-breaker-llm.js";

if (!isLLMProviderAvailable("openai")) {
  // skip to fallback immediately
}
```

### Channel delivery

Outbound channel delivery (Telegram, WhatsApp, Slack, etc.) is wrapped
with per-channel circuit breakers, registered as
`channel:<name>` or `channel:<name>:<accountId>`.

**Files**: `src/infra/outbound/circuit-breaker-channel.ts`,
`src/infra/outbound/deliver.ts`

```ts
import { withChannelBreaker } from "./circuit-breaker-channel.js";

const result = await withChannelBreaker("telegram", accountId, () =>
  sendMessageTelegram(to, text),
);
```

### Health endpoint

The `/health` endpoint automatically includes circuit breaker state
when any breakers exist:

```json
{
  "circuitBreakers": {
    "total": 3,
    "open": 1,
    "halfOpen": 0,
    "closed": 2,
    "hasOpenCircuits": true
  }
}
```

Access the full per-breaker snapshot programmatically:

```ts
import { circuitBreakerRegistry } from "./infra/circuit-breaker.js";

const snap = circuitBreakerRegistry.snapshot();
// snap.breakers → detailed state per breaker
```

### Diagnostic events

State transitions emit `circuit_breaker.state_change` events through
the platform's diagnostic event pipeline, making them visible in
OTel / diagnostics integrations.

---

## Registry

All breakers are stored in a global `CircuitBreakerRegistry` singleton.
This enables:

- **Central visibility** — one place to enumerate all breakers and their state.
- **Bulk operations** — `resetAll()`, `clear()`, iterate with `for...of`.
- **Health reporting** — `healthSummary()` aggregates state counts.

```ts
import { circuitBreakerRegistry } from "./infra/circuit-breaker.js";

// iterate
for (const [name, breaker] of circuitBreakerRegistry) {
  console.log(name, breaker.snapshot().state);
}

// manual override
circuitBreakerRegistry.get("llm:openai")?.forceOpen();
circuitBreakerRegistry.get("llm:openai")?.reset();
```

---

## Testing

Tests are co-located at `src/infra/circuit-breaker.test.ts` and cover:

- State machine transitions (closed → open → half-open → closed)
- `shouldTrip` filtering
- `callTimeoutMs` enforcement
- Manual `recordSuccess()` / `recordFailure()`
- `forceOpen()`, `forceClose()`, `reset()`
- Snapshot counters
- Registry CRUD, health summary, iteration
- Edge cases (threshold=1, concurrent calls, re-entrant callbacks)

Run with:

```sh
pnpm vitest run src/infra/circuit-breaker.test.ts
```

---

## Architecture decisions

| Decision | Rationale |
|----------|-----------|
| Generic `CircuitBreaker<T>` | Reusable across LLM, channels, and future integrations |
| Module-level singleton registry | Matches existing patterns (health state, diagnostics) |
| `shouldTrip` predicate | Prevents non-transient errors (bad prompts, format issues) from tripping breakers |
| Manual `recordSuccess()` / `recordFailure()` | Supports fire-and-forget recording where `execute()` wrapping is impractical |
| Console logging + diagnostic events | Immediate operator visibility + structured telemetry |
| No external dependencies | Aligns with project philosophy of zero-dep infrastructure |
