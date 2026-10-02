# Tuning and sizing

Design changes (data model, tick, interest) bring the large gains; the settings here adjust the
rest. Every change gets an A/B load test.

## Connection options (client)

| Option | Recommendation | Evidence |
|---|---|---|
| `withCompression('none')` | Default for the game connection | Same bytes for small updates, 10–15 % less server CPU [measured] |
| `withCompression('gzip')` | Connections that load large snapshots (editors, admin views) | Server compresses only above a size threshold [source] |
| `withConfirmedReads(false)` | Game connection | No measurable latency change on local NVMe [measured]; avoids waiting for fsync on slower disks; rows may be lost on a crash, which movement tolerates |
| `withConfirmedReads(true)` (default) | Inventory, purchases, anything a player must never see roll back | 2.0 default [docs] |

## Server `config.toml`

| Key | Default | Recommendation |
|---|---|---|
| `[logs] level`, `directives` | generated file sets debug for SpacetimeDB crates | `info` (or `warn`) in production; debug only while investigating |
| `[module-http] enabled` | true | `false` unless a procedure must call out (skill `spacetimedb-security`) |
| `[websocket] ping-interval` / `idle-timeout` | 15 s / 30 s | keep; browsers in background tabs answer pings late, shorter timeouts disconnect them |
| `[websocket] incoming-queue-length` | 16384 per client | lower (e.g. 1024) when single clients flood; overflow closes that connection |
| `[wasm]` / `[v8] procedure-instance-pool-size` | number of cores | 1–2 on small hosts; procedures are rare in bee-3d |
| `[v8-heap-policy] heap-limit-mb` | V8 default | set when RAM is tight; watch `spacetime_worker_v8_heap_limit_hit` |
| `[commitlog] write-buffer-size`, `max-segment-size` | 128 KiB, 1 GiB | keep |
| start flag `--page_pool_max_size` | 8 GiB | 256–512 MiB on hosts with ≤ 4 GiB RAM: limits memory kept after large deletes |

Changes need a server restart (skill `spacetimedb-ops`).

## Hardware

| Resource | What matters | bee-3d starting point [recommendation] |
|---|---|---|
| CPU | Several cores for sending; strong single-core speed for the database thread | 4 dedicated vCPUs of a current generation |
| RAM | All rows and indexes in memory, ≈100 MB base [measured], V8 heap, connection buffers | 4 GB for a few hundred players; measure `spacetime_data_size_*` and the process working set |
| Disk | Local NVMe for fsync latency; commit log grows forever | ≥ 100 GB, alert at 80 %; never network block storage with slow fsync for the data volume |
| Network | ≈10 KB/s per player down in the lab pattern, inputs ≈1–2 KB/s up | 1 Gbit/s uplink; check the provider's traffic quota |

Capacity on the target host comes from the load tester. The development machine numbers
(Ryzen 7 2700, Windows) are a lower bound for a modern Linux host.

## Disk growth control

- Raw commit log per player and hour ≈ report rate × (input record + inbox row change) plus the
  player's share of tick updates; the lab pattern produced ≈9 MB per player-hour, compressible
  ≈5× after snapshots [measured].
- A world tick that rewrites a row every tick costs ≈250 MB per day even without players
  [measured]; derive time from tick numbers in moved rows instead.
- Event-table inserts are logged too.
- There is no supported pruning of old commit-log segments in 2.10.x [source]; tiered storage is
  announced for late 2026. The operator monitors the data volume (skill `spacetimedb-ops`).

## Docker resource limits

- Give the SpacetimeDB container a memory limit above its working set plus headroom; an
  out-of-memory kill loses the in-memory state and forces a commit-log replay on restart (long
  for large logs: `spacetime_replay_commitlog_*` metrics).
- CPU limits (`cpus:`) throttle the sending threads first; prefer no limit on a dedicated host.
- The host's clock must be NTP-synchronised: `ctx.timestamp`, schedules and JWT expiry use it.

## Databases per instance

Each database has its own serial thread, commit log and memory. More databases help when one
database thread saturates (`databaseThreadBusyPercent` > 50 %) and the world splits naturally
(regions, rooms). All of them stay in the one production instance the license allows.
