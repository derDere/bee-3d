# SpacetimeDB in Docker

How the stack runs the SpacetimeDB host. Template: `templates/compose.spacetimedb.yml` (service
excerpt for `docker-compose.yml`) and `templates/config.toml` (versioned as
`docker/spacetimedb/config.toml`). Stack conventions: skill `docker-stack`.

## Image and process

- `clockworklabs/spacetime:v2.10.2`, pinned literally in the compose file. Debian bookworm with
  the Rust toolchain, .NET 8 WASI, binaryen and `curl` (~940 MB, amd64 and arm64)
  [source v2.10.2]. The stack uses only the server; `make compile` builds the module on the
  host.
- Entrypoint `spacetime` (the CLI). `spacetime start` replaces its own process with
  `spacetimedb-standalone` [source v2.10.2]. The template's shell entrypoint copies the
  versioned `config.toml` into the data directory and then `exec`s the server, so the server
  is PID 1.
- **Shutdown:** the server shuts down gracefully on SIGINT only. As PID 1 it ignores Docker's
  default SIGTERM and dies by SIGKILL after the grace period [source v2.10.2]. The template
  sets `stop_signal: SIGINT`. The AI agent confirms it on the first `make stop`: it returns
  within seconds and the container log ends with `Shutting down server...`.
- User `spacetime` without root rights (uid 1000 from `useradd` on the Debian base image)
  [source v2.10.2].

## Volumes

| Host path | Container path | Content | Backup |
|---|---|---|---|
| `mounts/spacetimedb/config/` | `/stdb/config` | `id_ecdsa`, `id_ecdsa.pub`: JWT signing keys, created on first start | yes; without them every server-issued token is invalid |
| `mounts/spacetimedb/data/` | `/stdb/data` | `config.toml` (copied at start), `control-db/` (catalogue: names, owners, replicas), `replicas/<n>/clog`, `snapshots/`, `module_logs/`, `logs/` | yes |
| `mounts/spacetime-cli/cli.toml` | none (host) | Owner token of the publish tool | yes; the only identity that may publish, clear or delete the database |
| `docker/spacetimedb/config.toml` | `/etc/spacetimedb/config.toml` (read-only) | Server configuration | git |

- Keys, data and owner token form one unit: the owner token is a server-issued token, signed
  with the keys in `/stdb/config` [verified 2.10.2].
- **Linux hosts:** `mounts/spacetimedb/` must exist and belong to uid 1000 before the first
  start; a directory that Docker creates on demand belongs to root, and the server cannot
  write. The developer prepares it once on the server:
  `mkdir -p mounts/spacetimedb && sudo chown -R 1000:1000 mounts/spacetimedb`. Docker Desktop
  on Windows and macOS needs no ownership change.

## Start and database launch [verified 2.10.2]

- `/v1/ping` answers as soon as the HTTP server runs; the healthcheck uses it.
- A database **launches on the first request that needs it** after a server start: it loads
  the last snapshot and replays the commit log behind it. Measured replay: ≈110,000
  transactions per second (Ryzen 7 2700, NVMe); with a snapshot every 1,000,000 transactions a
  launch takes at most ≈10 s on that machine. Schedules (world tick) resume only after the
  launch.
- `make start` and `make update` publish, which launches the database. After an automatic
  container restart (crash, host reboot) the first player connection launches it and waits
  for the replay. `GET /v1/database/bee-world/schema?version=9` launches a database without a
  client connection and without running a reducer; an internal monitor can use it.
- `GET /v1/database/<db>/identity` does not launch the database.

## Network and ports

- Development: `127.0.0.1:${SPACETIMEDB_PORT:-3000}:3000` for the CLI, the MCP server, the
  load tester and the Vite client of the developer.
- Production: the same loopback binding serves the operator's CLI on the server; players reach
  the server only through the reverse proxy and its route allowlist
  ([proxy.md](proxy.md)). Port 3000 is never published on all interfaces.
- No `--pg-port`: the PostgreSQL wire protocol has no TLS on standalone and uses the token as
  password.
- Outbound traffic: token validation fetches `<iss>/.well-known/openid-configuration` for
  every unknown issuer. On the server the container's egress is limited to the OIDC issuer
  (skill `spacetimedb-security`, `references/infrastructure.md`).

## Configuration

- The server writes a default `config.toml` with debug log directives on first start; the
  template replaces it at every start with the versioned file (log level info, outbound module
  HTTP off, WebSocket limits, small procedure pools, commit-log defaults).
- Changes take effect with `make stop start`. Key reference: skill `spacetimedb`,
  `references/cli-config.md`; tuning values: skill `spacetimedb-performance`,
  `references/tuning.md`.
- The startup warning about a "static max level" of the logger also appears with the default
  file and is harmless.

## Resources

- Memory: all rows and indexes live in RAM; base working set ≈100 MB [measured]. The
  container gets a memory limit with headroom over the measured working set: an
  out-of-memory kill forces a full replay on the next start.
- CPU: one busy thread per database plus transport threads; no `cpus:` limit on a dedicated
  host.
- Disk: the commit log grows without pruning. Monitoring and sizing: [lifecycle.md](lifecycle.md).

## Logs

| Log | Where | Read with |
|---|---|---|
| Server log | Container stdout and `/stdb/data/logs/` | `make logs SERVICE=spacetimedb` |
| Module log (`console.*` in reducers) | `/stdb/data/replicas/<n>/module_logs/<date>.log`, JSON lines per database and day, not in stdout [verified 2.10.2] | `spacetime logs bee-world -f` as owner |

The server deletes no module log files [source]. The operator removes old files; production
modules log events and errors, never every tick.

## CLI commands against the stack

Every owner command uses the publish tool's identity and the loopback URL:

```bash
spacetime --config-path mounts/spacetime-cli/cli.toml <command> … --server http://127.0.0.1:3000
```

| Purpose | Command after the prefix |
|---|---|
| Query, including private tables | `sql bee-world "SELECT COUNT(*) AS n FROM session"` |
| Module log | `logs bee-world -f` |
| Owner reducer (example from [lifecycle.md](lifecycle.md)) | `call bee-world sync_definitions` |
| Deletion guard (production) | `lock bee-world` |
| Schema | `describe bee-world --json` |

The project's MCP server `spacetimedb` uses the same CLI configuration, so the AI agent reads
private tables of the development database as owner [verified 2.10.2].
