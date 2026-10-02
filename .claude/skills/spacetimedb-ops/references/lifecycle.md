# Lifecycle: build, publish, migrate, upgrade, back up

Commands assume the stack layout of this skill: owner CLI configuration in
`mounts/spacetime-cli/cli.toml`, server on `http://127.0.0.1:3000`, database `bee-world`.

## Build and publish

`make compile` [verified 2.10.2]:

```bash
npm ci                                   # Wurzel: Client, Lasttest
npm ci --prefix server                   # Modul: eigenes typescript, sonst keine Typprüfung im build
spacetime build --module-path server     # tsc --noEmit + Bundle → server/dist/bundle.js
spacetime generate --lang typescript --out-dir src/net/bindings --js-path server/dist/bundle.js --yes
# danach Typprüfung und Vite-Build des Clients
```

- `spacetime build` type-checks only with `server/node_modules/.bin/tsc`; without it the CLI
  prints "tsc not found in node_modules" and still bundles. `compile.py` therefore fails on that
  line or installs the module dependencies first, as above.
- Bindings generated from the bundle match bindings generated from the module source.
- The build host needs Node.js and the `spacetime` CLI in the stack's version. That includes
  the production server, which builds from source. Linux install: `curl -sSf
  https://install.spacetimedb.com | sh`, then `spacetime version install 2.10.2` and
  `spacetime version use 2.10.2` [docs].

`make start` and `make update` end with `python tools/spacetimedb_publish.py`
(`templates/tools/`). It waits for `/v1/ping` and runs:

```bash
spacetime --config-path mounts/spacetime-cli/cli.toml publish bee-world \
  --server http://127.0.0.1:3000 --js-path server/dist/bundle.js --no-config --yes=migrate
```

- First publish: the CLI performs a server-issued login and stores the token in the
  configuration file; the database is created; the module's `init` reducer runs.
- Later publishes swap the module in place. Connected clients stay connected unless the
  migration plan breaks them (table below).
- `--break-clients` (tool flag) accepts plans that disconnect all clients. The tool never
  passes `--delete-data`.

## Publish outcomes of schema changes [verified 2.10.2]

Published with `--yes=migrate` to a lab database running the reference module:

| Change | Outcome |
|---|---|
| New table, new btree index, removed btree index | Published; clients stay connected |
| Private table made public, public table made private | Published without prompt |
| Reducer removed, reducer parameters changed | Published without prompt; old clients' calls fail afterwards |
| Column appended with a default value | Refused without `--break-clients`; with it, all clients are disconnected |
| Column added without a default value | Refused: "requires a default value annotation" |
| Column type changed | Refused: "requires a manual migration" |
| Column removed or reordered, non-empty table removed | Refused [docs] |
| Unique or primary-key constraint added | Allowed when existing rows satisfy it (2.7.0 release notes) |

The CLI's break check covers only the table layout. Changes to reducers and to visibility get
no warning, so the protocol version below catches them.

### Change patterns [recommendation]

- **Extension table instead of a new column** on hot tables: `bee_stats` keyed by `playerId`
  next to `bee_state`. A new table publishes without disconnecting anyone.
- **New reducer instead of a changed signature:** `reportPoseV2` next to `reportPose`; the old
  reducer goes once no client uses it.
- **Versioned table for type changes:** `bee_state_v2` plus a copy step (owner reducer or lazy
  copy on access); clients switch with the next protocol version.
- Columns with a default value only in announced maintenance windows (`--break-clients`).

### Protocol version check [verified 2.10.2]

A browser tab keeps running old client code after a deploy. Before subscribing, the client
compares its compiled protocol version with the module's:

```ts
// shared/protocol.ts
/** Wird erhöht, sobald alte Clients mit dem neuen Modul nicht mehr korrekt arbeiten (Protokollversion). */
export const ProtocolVersion = 1;

// server/src/index.ts — Name, Parameter und Rückgabetyp bleiben für immer gleich.
export const protocolVersion = spacetimedb.procedure(t.u32(), () => ProtocolVersion);
```

The client calls `await connection.procedures.protocolVersion({})` in `onReady`. On a
mismatch it stops reconnecting and asks the player to reload (skill `spacetimedb-babylon`,
`references/session.md`). The AI agent raises `ProtocolVersion` for every change to a
reducer the client calls, to a table or column it subscribes to, or to the meaning of a
value.

## Definition data, demo data, clear

| Target | Implementation [recommendation] |
|---|---|
| `make init` | `tools/init.py` calls an owner-only, idempotent reducer, e.g. `spacetime call bee-world sync_definitions` (owner prefix: [docker.md](docker.md)), which upserts definition tables from module constants |
| `make seed` | `tools/seed.py` calls owner-only demo reducers |
| `make clear` | `tools/clear.py` republishes the current bundle with `--delete-data=always --yes=delete-data,migrate,break-clients`, then runs the `init` step |

- Definitions that never change at runtime and need no subscription live as constants in
  `shared/`; they need no table and no sync.
- `--delete-data=always` keeps the database name and identity, empties all tables and runs the
  `init` reducer again [verified 2.10.2]. Every clear starts a new replica directory and
  leaves the previous one on disk (≈7 MB plus the old data) [verified 2.10.2]. To reclaim
  development disk space, the developer runs `make stop`, deletes `mounts/spacetimedb/data/`
  (keys and owner token stay) and runs `make start`, which creates the database anew.
- `tools/clear.py` refuses to run when the stack's environment is production (skill
  `dev-env`).

## Version upgrade (lockstep)

1. The AI agent reads the release notes from the current to the target version
   (`https://api.github.com/repos/clockworklabs/SpacetimeDB/releases`), especially entries on
   migrations, durability, protocol and the TypeScript SDK.
2. The developer installs the CLI: `spacetime version install <v>`, `spacetime version use <v>`
   (development machine and production server).
3. One commit bumps the image tag in `docker-compose.yml`, `spacetimedb` in the root and
   `server/` `package.json` (exact version) and the lock file.
4. `make compile stop start wait`, smoke test, load test on the development machine
   (agent `spacetimedb-load-tester`).
5. Production: backup, `git pull`, `make compile update wait`.
6. Rollback: previous commit plus the pre-upgrade backup. The AI agent never starts an older
   server version on data that a newer one has written [recommendation].

## Backup and restore

The unit is `mounts/spacetimedb/` (keys and data) together with `mounts/spacetime-cli/cli.toml`
(owner token).

- **Consistent copy:** `make stop`, copy, `make start` — or an atomic filesystem snapshot
  (LVM, ZFS, btrfs) of the running volume. A file-by-file copy of a running server is not a
  consistent backup [recommendation].
- **Restore drill [verified 2.10.2]:** a server started on a copy of a stopped server's root
  directory replays every database; the owner token from the separately kept CLI
  configuration reads private tables and publishes.
- Restore: `make stop`, replace both paths with the backup, check out the code version of the
  backup, `make start wait`. `make start` publishes the checked-out module; a newer checkout
  migrates the restored database.
- Backups contain the JWT signing keys and the owner token: encrypted storage, access for the
  developer only.
- The commit log holds the complete history; backup size grows with it.

## Monitoring

| Signal | Source | Alert [recommendation] |
|---|---|---|
| Server alive | Healthcheck `/v1/ping` | Container unhealthy |
| Serial database load | `spacetime_reducer_plus_query_duration_sec` (`/v1/metrics`, internal only) | > 50 % of one core over 5 min |
| Tick lateness | `spacetime_scheduled_function_delay_seconds` | p95 > one tick |
| Slow clients kicked | `spacetime_client_outgoing_queue_disconnects_total` | rising |
| Data volume | Host disk usage of `mounts/spacetimedb/data/` | 80 % |
| Memory | Container working set (`docker stats`, host monitoring); the server exports no `process_*` metrics | 80 % of the limit |

Metric names and meaning: skill `spacetimedb-performance`, `references/load-testing.md`.
Disk growth: ≈9 MB per player-hour raw in the lab pattern, ≈1/5 after compression; an idle
tick that rewrites one row costs ≈250 MB per day [measured].

## Production rules

1. Exactly one production SpacetimeDB instance (BSL 1.1); every game database lives in it.
   Staging runs on another host and serves no players.
2. `spacetime lock bee-world` after the first deploy.
3. No `--delete-data` against production. `--break-clients` only in announced maintenance
   windows.
4. Publishing, SQL, logs and MCP run on the server via loopback or an SSH tunnel, never
   through the public proxy.
5. Keys and owner token leave the server only inside encrypted backups.
