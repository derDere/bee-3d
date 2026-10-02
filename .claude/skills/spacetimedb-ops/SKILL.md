---
name: spacetimedb-ops
description: Use when running SpacetimeDB for bee-3d in Docker or on the production server — the compose service and config.toml, make targets that build, publish, clear or seed the module, schema migrations and breaking publishes, protocol version checks, version upgrades, backups and restore, logs and metrics, reverse-proxy routes, disk growth, or the one-production-instance license limit.
---

# SpacetimeDB operations

The stack runs one container from the official image `clockworklabs/spacetime:v2.10.2`. The host
builds the module (`make compile`), and `make start` / `make update` publish it with the host
CLI under a dedicated owner identity. The AI agent drives containers only through the make
targets (skills `makefile-commands`, `docker-stack`). Evidence tags: skill `spacetimedb`.

## Facts behind the setup

- The server shuts down gracefully only on SIGINT; as PID 1 it ignores SIGTERM
  [source v2.10.2] → `stop_signal: SIGINT`.
- A database launches on the first request after a server start and replays its commit log
  since the last snapshot (≈110,000 tx/s measured); schedules wait for that launch
  [verified 2.10.2].
- The database owner is the identity that published it first. Its token is signed with the
  server's keys in `/stdb/config`: keys, data and owner token are backed up and restored as
  one unit. A restore drill passed in the lab [verified 2.10.2].
- The CLI's break check covers table layouts only. Removing a reducer, changing reducer
  parameters or hiding a public table publishes without a warning [verified 2.10.2].
- `--delete-data=always` empties a database and keeps its name and identity
  [verified 2.10.2].
- Module logs sit in per-day files under `replicas/<n>/module_logs/`, not in the container
  output; the commit log is never pruned [source].
- License: one production instance; every game database lives inside it [source].

## Make targets

| Target | SpacetimeDB part |
|---|---|
| `compile` | `npm ci`, `npm ci --prefix server`, `spacetime build --module-path server`, `spacetime generate … --js-path server/dist/bundle.js`, client build |
| `start` | `docker compose up -d --build`, then `python tools/spacetimedb_publish.py` |
| `wait` | Healthcheck `GET /v1/ping` |
| `init` | Owner-only idempotent reducer for definition tables (`sync_definitions`) |
| `seed` | Owner-only demo reducers |
| `clear` | Republish with `--delete-data=always`, then the `init` step; refuses in production |
| `update` | Image pull and container recreate (skill `makefile-commands`), then the publish tool |
| `logs` | Server log; module log via `spacetime logs bee-world -f` as owner |

Commands and details: [references/lifecycle.md](references/lifecycle.md).

## Rules

1. **Lockstep versions:** image tag, CLI, `spacetimedb` npm package (root and `server/`) and
   generated bindings carry the same version; upgrades follow the procedure in
   `lifecycle.md`.
2. **Publishing runs only through `tools/spacetimedb_publish.py`** with the owner configuration
   `mounts/spacetime-cli/cli.toml`. `--break-clients` is a deliberate choice;
   `--delete-data` never touches production.
3. **Every client-visible change raises `ProtocolVersion`** in `shared/protocol.ts`; clients
   with another version reload instead of reconnecting.
4. **The server port binds to `127.0.0.1`.** Players reach SpacetimeDB only through the proxy
   allowlist ([references/proxy.md](references/proxy.md)); operators use loopback or an SSH
   tunnel.
5. **Back up `mounts/spacetimedb/` and `mounts/spacetime-cli/` together** from a stopped
   container or an atomic snapshot; backups are encrypted (they hold root credentials).
6. **Production:** `spacetime lock bee-world`; alerts on disk usage, serial database load and
   tick lateness; module logs carry events and errors, not ticks.
7. **On Linux** the developer creates `mounts/spacetimedb/` with owner uid 1000 before the
   first start.

## Templates

| Template | Project path |
|---|---|
| `templates/compose.spacetimedb.yml` | Service `spacetimedb` in `docker-compose.yml` |
| `templates/config.toml` | `docker/spacetimedb/config.toml` |
| `templates/spacetime.json` | `spacetime.json` |
| `templates/tools/spacetimedb_publish.py` | `tools/spacetimedb_publish.py` |

The module template lives in skill `spacetimedb` (`templates/server/`). Git ignores `mounts/`,
`server/dist/` and `spacetime*.local.json`.

## Reference files

| File | Content |
|---|---|
| [docker.md](references/docker.md) | Image, volumes, launch behaviour, ports, configuration, resources, logs, owner CLI commands |
| [lifecycle.md](references/lifecycle.md) | Build and publish, verified migration outcomes, change patterns, protocol version, init/seed/clear, upgrades, backup and restore, monitoring, production rules |
| [proxy.md](references/proxy.md) | Route allowlist with Traefik, nginx and HAProxy snippets |
