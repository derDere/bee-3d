# Lab results

Measurements behind the numbers in this skill. They describe one machine and one workload; the
AI agent uses them for orders of magnitude and A/B decisions, not as capacity promises.

## Setup

- Host: development machine, Windows 10, AMD Ryzen 7 2700 (Zen+, 8 cores / 16 threads,
  3.2 GHz), 32 GB RAM, NVMe SSD.
- Server: SpacetimeDB 2.10.2 standalone, default `config.toml`, started with
  `spacetime --root-dir=<dir> start --listen-addr 127.0.0.1:3077`.
- Modules: a TypeScript module and a Rust twin with identical schema and reducers (Rust 1.99,
  crate `spacetimedb =2.10.2`, built without `wasm-opt`).
- Clients: headless bots (TypeScript SDK 2.10.2, Node 26) in one process on the same host. Bot
  CPU is not part of the server numbers.
- Server CPU: process CPU time divided by wall time (100 % = one core). Latency: time from a
  bot's pose report until its own updated row arrives.

Workload:

- `bee_state` (public): `player_id u32` primary key, `cell u32` btree, `x y z f32`,
  `yaw pitch i16`, `tick u32` — 27 bytes in BSATN.
- Each bot flies a 50 m circle at about 10 m/s and calls `report_pose` at R Hz.
- Inbox mode: `report_pose` overwrites a private `pose_inbox` row; a 20 Hz scheduled
  `world_tick` validates speed and copies all inbox rows into `bee_state`.
- Direct mode: `report_pose_direct` writes `bee_state` immediately.
- Each bot subscribes to `bee_state` and the event table `buzz_event` with one `cell = K` query
  per cell of the 3×3 neighbourhood (64 m cells) and moves the subscription when its cell
  changes. The world grows with 60·√N m, so each client sees about 6.5 movers.

## Results (TypeScript module)

| Run | Server CPU | WS messages/s per client | KB/s per client | Own latency p50/p95 ms | Tick p50 ms |
|---|---|---|---|---|---|
| 50 bots, inbox, 15 Hz, gzip | 31 % | 31.6 | 8.8 | 34 / 64 | 0.22 |
| 100 bots, inbox, 15 Hz, gzip | 46 % | 31.3 | 9.1 | 38 / 65 | 0.34 |
| 200 bots, inbox, 15 Hz, gzip | 94 % | 32.6 | 9.4 | 44 / 65 | 0.61 |
| 100 bots, direct, 15 Hz, gzip | 58–73 % | 97–107 | 12.0 | 11 / 18 | 0.05 |
| 100 bots, inbox, 15 Hz, no compression | 37 % | 30.3 | 9.2 | 36 / 64 | 0.29 |
| 200 bots, inbox, 15 Hz, no compression | 80 % | 31.8 | 9.5 | 44 / 66 | 0.57 |
| 100 bots, inbox, 5 Hz, gzip | 25 % | 22.6 | 4.3 | 36 / 65 | 0.20 |
| 100 bots, inbox, 15 Hz, confirmed reads | 45 % | 29.1 | 8.8 | 36 / 64 | 0.31 |
| 50 bots, inbox, 30 Hz, gzip | 31 % | 44.1 | 10.8 | 30 / 34 | 0.29 |
| 100 bots, inbox, 15 Hz, 25 cells | 69 % | 35.7 | 15.5 | 47 / 65 | 0.30 |
| 100 bots, empty reducer, 15 Hz | 19.6 % | 14.2 | 0.5 | – | 0.06 |
| 100 bots, empty reducer, 1 Hz (idle baseline) | 9.4 % | 1.3 | 0.2 | – | 0.06 |

Readings:

- Fan-out dominates: the same 1,500 calls per second cost 20 % CPU with an empty reducer and
  46 % when each call leads to replicated movement.
- One trivial reducer call costs about 70 µs of total process CPU on this machine (transport,
  module call, commit, reply).
- The tick adds about 25 ms average latency compared with direct writes; remote players are
  interpolated 100 ms in the past anyway, and the own bee is simulated locally.
- Small updates stay below the compression threshold, so `gzip` and `none` send the same bytes,
  but `gzip` costs CPU.
- Windows timer granularity (15.6 ms) shows up as alternating 46/62 ms tick intervals; Linux
  hosts tick evenly.

## Serial-path cost per reducer

The Prometheus histogram `spacetime_reducer_plus_query_duration_sec` (reducer plus subscription
evaluation, i.e. the time the database thread is busy) averaged over all runs, TypeScript module:

| Reducer | Work | Average |
|---|---|---|
| `noop` | nothing | 15.7 µs |
| `report_pose` | upsert of one private inbox row | 38.7 µs |
| `report_pose_direct` | update of one public row (fan-out evaluation) | 61.7 µs |
| `buzz` | event-table insert | 83 µs |
| `spawn` | one public insert | 107 µs |
| `set_name` | regex check, one upsert | 163 µs |
| `world_tick` | 100–200 row updates | 374 µs |
| `on_connect` | JWT parse, account and session insert | 478 µs |

100 players at 15 Hz keep the database thread busy for about 66 ms per second (≈7 %): the
serial path has room for roughly ten times this load on this machine. The 46 % process CPU of
that run is mostly transport and sending on other threads — total cores, not the single
database thread, limit this workload first.

## TypeScript vs Rust module

Same server process, alternating runs, 100 bots at 15 Hz:

| Run | TypeScript CPU | Rust CPU | TypeScript tick p50 | Rust tick p50 |
|---|---|---|---|---|
| Inbox | 40.6 % / 45.2 % | 41.5 % / 42.9 % | 0.29–0.31 ms | 0.25–0.26 ms |
| Direct | 57.7 % / 60.2 % | 60.2 % / 61.9 % | 0.05 ms | 0.03 ms |
| Empty tick | 80–130 µs | 35–44 µs | | |

Compute probe — O(n²) distance check over 2,000 rows, about two million pairs, no writes:

| Module | First call | Warm, per pass |
|---|---|---|
| TypeScript | 27–29 ms | ≈11 ms |
| Rust (unoptimised wasm) | 6–8 ms | ≈7.4 ms |

Conclusion: for small reducers with heavy fan-out the module language does not change total
server CPU; for tight compute loops Rust is 1.5–5× faster. Either way a 30 ms loop inside a 50 ms
tick stalls every player of that database — the algorithm (spatial grid) matters first.

## Commit log growth

| Situation | Growth |
|---|---|
| 100 bots, inbox, 15 Hz | ≈254 KB/s ≈ 0.9 GB/h uncompressed (≈9 MB/h per player) |
| Idle world, 20 Hz tick rewriting one clock row | ≈2.8–2.9 KB/s ≈ 240–250 MB/day |
| Idle world, 20 Hz tick deriving its number from `ctx.timestamp` (no write) | 0 bytes in 40 s |
| zstd on a 40 MB load-test slice | 5.4× (level 3), 5.9× (level 9) |

Segments older than the latest snapshot are zstd-compressed by the server after each snapshot
(every 1,000,000 transactions) [source]; nothing is deleted.

## Security probes on the same server

| Probe | Result |
|---|---|
| `POST /v1/identity` without token | New identity; token ES256 with `iss` `localhost`, `aud` `["spacetimedb"]`, random `sub`, no `exp` |
| Anonymous `POST /v1/database/<db>/sql` | Reads public tables; private table → `no such table … may be marked private` |
| Anonymous `GET /v1/database/<db>/schema` | Lists every table including private ones, and every reducer |
| Anonymous `GET /v1/metrics` | 200, about 1,300 lines of Prometheus metrics |
| Anonymous publish of a new database name | Database created |
| Anonymous publish, delete or logs on the owner's database | 403 |
| Anonymous HTTP SQL or reducer call | Runs `client_connected` with a fresh identity each time |
| `POST /v1/mcp` without token / with owner token | `list_databases` empty / lists owned databases; owner reads private tables |
