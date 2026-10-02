---
name: spacetimedb-performance
description: Use when designing SpacetimeDB tables, reducers, world ticks or subscriptions for many concurrent players, sizing CPU, RAM, disk or bandwidth for a self-hosted server, diagnosing lag, high server CPU, a growing commit log, slow reducers or "scheduled function started late" warnings, choosing interest management, compression or confirmed reads, or load-testing a SpacetimeDB module with headless bots.
---

# SpacetimeDB performance

Many players on little hardware is a design question before it is a tuning question. This skill
holds the cost model, numbers measured on the development machine, the patterns that keep a world
database cheap and the measurement protocol.

**REQUIRED BACKGROUND:** skill `spacetimedb` (evidence tags, API rules, version facts).

## Cost model

Where a game workload spends server resources, largest first [measured] [source]:

| Cost | Runs on | Grows with | Lever |
|---|---|---|---|
| Sending updates (serialize, compress, write) | worker threads | messages × recipients | coalesce writes into a tick; smaller interest areas; compact hot rows |
| Subscription delta evaluation | commit path, serial per database | affected distinct queries per transaction | single-column equality queries; nothing unfiltered on hot tables |
| Reducer calls (decode, call, commit, reply) | database thread, serial | calls per second | input rate; one call carries all of a frame's input |
| Module code | inside the reducer | algorithm | indexes and a spatial grid; the language only matters for tight loops |
| Durability (group commit, fsync) | background | bytes written | fewer, smaller writes; local NVMe |
| Memory | process | rows, indexes, connections | hot/cold split; event tables; cleanup |
| Disk | commit log, never pruned | every committed transaction | write volume first, then monitoring |

Facts behind the model:

- A database runs one transaction at a time, and the subscription evaluation of a committed
  transaction finishes before the next transaction starts [source].
- Identical queries from many clients are evaluated once and copied to every subscriber
  [source].
- A query with a single `column = value` filter is evaluated only when a changed row carries
  that value. Queries with ranges, `OR`, `!=`, compound `AND` equalities or no filter run on
  every change of their table [source].
- A per-user view re-runs once per subscriber: one shared write seen by 250 per-user views cost
  30–40 ms in the upstream benchmark (PR #5975).
- For movement workloads the serial database thread is not the first limit: 100 players at
  15 Hz kept it busy about 7 % of the time, while sending updates used most of the 46 % process
  CPU across other threads [measured]. More cores help; the serial path matters for heavy
  reducers and per-user views.

## Measured on the development machine [measured]

Ryzen 7 2700 (Zen+, 2018), Windows, SpacetimeDB 2.10.2, TypeScript module, 20 Hz world tick,
15 Hz pose reports, 9 cells of 64 m per client, about 6.5 visible movers per client:

| Players | Server CPU (100 % = one core) | Download per client | Own-update latency p50/p95 |
|---|---|---|---|
| 50 | 31 % | 8.8 KB/s | 34/64 ms |
| 100 | 46 % | 9.1 KB/s | 38/65 ms |
| 200 | 94 % | 9.4 KB/s | 44/65 ms |

| Variation at 100 players | Effect |
|---|---|
| Reports written straight into the public table (no tick) | +30–60 % CPU, 3× messages, latency 11/18 ms |
| Compression `none` instead of `gzip` | −10–15 % CPU, same bytes |
| 5 Hz instead of 15 Hz reports | −45 % CPU, −53 % bytes |
| 25 cells instead of 9 | +50 % CPU, +70 % bytes |
| Confirmed reads on | no measurable change |
| Rust module instead of TypeScript | no measurable change; Rust is 1.5–5× faster in an O(n²) loop |

Server RAM stayed near 100 MB. The commit log grew ≈0.9 GB per hour for 100 players
(compressible ≈5×); an idle world whose tick rewrites one clock row writes ≈250 MB per day.
Rule of thumb: about 0.5 % of one desktop core per player for this pattern. The developer
confirms capacity on the target host with agent `spacetimedb-load-tester`. Tables and method:
[references/lab-results.md](references/lab-results.md).

## Patterns that keep a world database cheap [recommendation]

1. **Coalesce input into a tick.** A reducer overwrites one private inbox row per player; a
   20 Hz schedule validates and applies all inbox rows in one transaction. Clients receive one
   message per tick instead of one per report.
2. **Replicate only what others render.** The hot table holds compact `u32` ids (an `Identity`
   costs 32 bytes), small numeric types and no strings; names, stats and settings live in cold
   tables.
3. **Write only changes.** Skip unchanged rows, skip moves below a threshold, keep the tick
   number in the moved rows and derive it from `ctx.timestamp` instead of a clock row that
   changes every tick: a scheduled reducer that changes nothing adds nothing to the commit log
   [measured].
4. **Interest by cells.** One packed `u32` `cell` column with a btree index; one equality query
   per cell; radius 1 (3×3 cells); subscribe to the new set before dropping the old one.
5. **Shared beats per-user.** Plain queries or anonymous views for anything a group sees;
   per-user views only for small private results.
6. **Effects through event tables** carrying a `cell` column, subscribed per cell like the
   movers.
7. **Bounded reducers.** Index lookups only, a spatial grid for proximity, caps on every loop;
   the tick stays under 20 % of its interval.
8. **Lean client.** Own `Map` registries instead of SDK `find()`, compression `none`, confirmed
   reads off on the game connection (skill `spacetimedb-babylon`).
9. **Watch the disk.** Every committed transaction stays in the commit log; cut write volume
   before buying disk.
10. **Scale out last.** A second database (region, room) only after the load tester shows one
    database thread saturating; all databases stay in the one production instance (license).

## Budgets for bee-3d [recommendation]

| Quantity | Budget |
|---|---|
| World tick | 20 Hz; p95 ≤ 10 ms |
| Pose reports | 10–15 Hz while moving, ≤ 2 Hz while idle |
| Hot replicated row | ≤ 32 bytes |
| Visible movers per client | ≤ 50 |
| Download per client | ≤ 30 KB/s in crowds |
| Server CPU at target player count | ≤ 60 % of the host's cores |
| Commit log | measured per 100 players and day; alert at 80 % disk |

## Measurement protocol

1. Run headless bots against a local or staging server, never production. Agent
   `spacetimedb-load-tester` runs the harness from
   [references/load-testing.md](references/load-testing.md).
2. Record process CPU and RAM, sampled tick timings, "scheduled function delay" warnings,
   `/v1/metrics` (internal network only), commit-log growth, client bytes and messages per
   second, own-update latency.
3. Compare variants in alternating runs; single runs vary by about ±5 %.
4. Capacity numbers come from the target host; the development machine shows trends.

## Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Every input reducer writes the public state row | one fan-out per report, 3× messages | inbox row plus tick |
| `subscribeToAllTables()` or unfiltered queries on moving entities | every client receives the whole world | cell queries |
| Range or `OR` filters for areas (`x > a AND x < b`) | evaluated on every change of the table | packed cell column, one equality query per cell |
| `Identity` or strings in hot rows | 32+ bytes per row per update | `u32` player id |
| Per-user view for team or region data | one evaluation per subscriber | anonymous view or cell query |
| O(n²) proximity checks in the tick | tick time explodes, database stalls | spatial grid table or cell index |
| Tick rewrites a clock row 20× per second | ≈250 MB commit log per day | tick number from `ctx.timestamp`, stored only in moved rows |
| `conn.db.x.id.find()` per entity per frame | O(n) scan each call on the client | own `Map` from row callbacks |
| Load test against production | real players lag, disk fills | staging copy |

## Reference files

| File | Content |
|---|---|
| [lab-results.md](references/lab-results.md) | Full measurement tables, method, commit-log growth, TypeScript vs Rust |
| [data-and-ticks.md](references/data-and-ticks.md) | Hot/cold schema, inbox and tick module code, write-volume control, spatial grid, cleanup |
| [interest.md](references/interest.md) | Cell packing, client cell subscriptions, views vs queries, event scoping, large worlds |
| [load-testing.md](references/load-testing.md) | Bot harness, measurement script, metrics to read, interpreting results |
| [tuning.md](references/tuning.md) | Server config knobs, compression, confirmed reads, hardware and disk sizing |
