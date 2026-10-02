# Load testing with headless bots

The harness in `templates/loadtest/` drives many simulated players through the game's own
networking code (`src/net/`) and reads the server's Prometheus metrics. It ran end-to-end against
the reference module on a 2.10.2 lab server [verified 2.10.2]. Agent `spacetimedb-load-tester`
runs it; the AI agent in the main context can run a single short pass the same way.

## Setup in the repository

```
tools/loadtest/
  package.json      tsx, typescript, @types/node (spacetimedb comes from the repo root)
  tsconfig.json     includes ../../src/net and ../../shared
  src/bots.ts       bots, wire counter, report
  src/metrics.ts    Prometheus scrape and window comparison
```

1. The AI agent copies `templates/loadtest/` to `tools/loadtest/` and adapts the marked game
   calls in `bots.ts` (`join`, `reportPose`, `buzz`, the own-profile query) to the module.
2. `npm install` in the repository root (game dependencies, generated bindings present) and in
   `tools/loadtest/`.
3. The bots import `src/net/spacetimeSession.ts`, `cellSubscriptions.ts`, `poseReporter.ts`
   and `src/net/bindings/` — the code the browser runs, minus rendering.

## Running

```
npx tsx src/bots.ts --uri ws://127.0.0.1:3000 --db bee-world --bots 100 --seconds 60 \
  --metrics http://127.0.0.1:3000/v1/metrics [--rate 15] [--radius 1] [--compression none] [--confirmed false]
```

- Target: the local development stack or a staging copy — never production (bots create
  accounts and fill the commit log). A disposable database is reset afterwards with
  `spacetime publish <db> --delete-data=always` (skill `spacetimedb-ops`).
- The bots ramp up at 100 connections per second, warm up for 5 s, then measure for
  `--seconds`. The world grows with 60·√N metres, so density stays near 6 visible bees per
  client; `--area` overrides it.
- One Node process handles a few hundred bots; above that, or when the bot process itself
  exceeds about 70 % of a core, the AI agent starts several processes with smaller `--bots`
  values, ideally on a second machine.

## Report fields

| Field | Meaning | Healthy (bee-3d budgets) |
|---|---|---|
| `client.kilobytesPerSecPerBot` | received WebSocket bytes per client | ≤ 30 KB/s |
| `client.messagesPerSecPerBot` | received WebSocket messages per client | ≈ tick rate + reducer replies |
| `client.ownUpdateLatencyMs` | report → own row back, p50/p95 | p95 ≤ tick interval + 2 × RTT + 20 ms |
| `server.websocketBytesPerSec` | payload sent to all clients | grows linearly with players |
| `server.reducerMicrosAvg` | reducer plus subscription evaluation per call | report reducers ≤ 100 µs; tick ≤ 20 % of its interval |
| `server.databaseThreadBusyPercent` | serial database thread utilisation | ≤ 50 % |
| `server.scheduledDelayAvgMs`, `scheduledLateShare` | lateness of scheduled functions | late share 0 |
| `server.outgoingQueueDisconnects` | clients kicked for falling behind | 0 |
| `reducerErrors` | rejected reducer calls | 0 (or explained) |

Server process CPU and memory come from the host: on the Docker stack the read-only
`docker stats --no-stream <container>`, locally the task manager or `ps`. The commit-log growth
is the size difference of the data volume's `replicas/<n>/clog/` directory over the run.

## Interpreting

| Symptom | Likely cause | Next step |
|---|---|---|
| CPU high, database thread busy < 20 % | Fan-out (sending) dominates | Fewer messages: tick coalescing, smaller radius, lower report rate, compression `none` |
| Database thread busy > 50 % | Heavy reducers or many affected queries | `reducerMicrosAvg` per reducer; non-equality queries on hot tables; per-user views |
| Tick average grows with players | O(n²) logic or full scans in the tick | Cell index lookups, cap loops |
| Scheduled late share > 0 | Database thread saturated or long reducers | Same as above; move work out of the hot tick |
| Outgoing queue disconnects | A client (or the bot process) cannot keep up | Check bot CPU; reduce data per client |
| Latency p95 far above tick + RTT | Queueing on the server | `spacetime_reducer_wait_time_sec` in `/v1/metrics` |

## A/B protocol

1. Change one variable at a time (tick rate, report rate, radius, compression, schema).
2. Alternate variants (A, B, A, B) on the same server process; single runs vary by about ±5 %.
3. Keep the bot count, area and duration fixed; record the commit-log growth too.
4. Record results in the pull request or the relevant spec, with host, version and parameters.

## Prometheus metrics worth knowing

| Metric | Use |
|---|---|
| `spacetime_reducer_plus_query_duration_sec` (`db`, `reducer`) | Serial cost per call: reducer plus subscription evaluation |
| `spacetime_reducer_wait_time_sec` | Queueing before a reducer runs (saturation) |
| `spacetime_scheduled_function_delay_seconds` (`function`) | Tick lateness; >50 ms also logs a warning |
| `spacetime_websocket_sent_msg_size_bytes` (`db`) | Bytes and payloads actually sent |
| `spacetime_num_bytes_sent_to_clients_total` | Encoded update bytes, counted once per evaluation, not per recipient [source] |
| `spacetime_subscription_*`, `spacetime_query_subscriptions` | Number and cost of subscriptions |
| `spacetime_total_outgoing_queue_length`, `spacetime_client_outgoing_queue_disconnects_total` | Slow clients |
| `spacetime_worker_v8_*` | Heap of TypeScript modules |
| `spacetime_worker_connected_clients` | Connections per database |
| `page_pool_resident_bytes` | Memory held in the free-page pool |

The endpoint `/v1/metrics` has no authentication; it stays on the internal network
(skill `spacetimedb-security`).
