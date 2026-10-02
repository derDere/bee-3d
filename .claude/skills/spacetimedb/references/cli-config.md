# CLI, project config, server config, HTTP routes

Command list and flags from `spacetime --help` of CLI 2.10.2 [verified 2.10.2]; `call`, `sql`,
`describe`, `subscribe`, `list`, `server` and `mcp` print "UNSTABLE" warnings.

## Everyday commands

| Command | Purpose |
|---|---|
| `spacetime build --module-path server` | Bundle the TypeScript module to `server/dist/bundle.js` (Rust: `target/wasm32-unknown-unknown/release/*.wasm`) |
| `spacetime publish <db> --module-path server --server local` | Create or update a database; hot-swaps the module without dropping clients |
| `spacetime publish <db> --bin-path x.wasm` / `--js-path dist/bundle.js` | Publish a prebuilt artifact (`--js-path` is marked unstable) |
| `spacetime publish <db> --delete-data=always\|on-conflict\|never` | Wipe data first (`-c`); never on production |
| `spacetime publish <db> --break-clients` | Accept schema changes that break old clients (does not delete data) |
| `--yes` / `--yes=all\|remote\|migrate\|break-clients\|skip-login\|delete-data` | Non-interactive confirmation; the value needs `=` |
| `spacetime generate --lang typescript --out-dir src/net/bindings --module-path server` | Client bindings (`--include-private` for owner tools) |
| `spacetime generate … --js-path server/dist/bundle.js --yes` | Same bindings from the built bundle, without a second build [verified 2.10.2] |
| `spacetime sql <db> "SELECT …"` | Ad-hoc SQL; owners may also `INSERT`/`UPDATE`/`DELETE` |
| `spacetime call <db> <reducer> <json-args…>` | Call a reducer or procedure (each argument a separate JSON value) |
| `spacetime logs <db> -f`, `-n 100`, `--level warn`, `--format json` | Module and host log of one database (owner only) |
| `spacetime describe <db> --json [tables\|reducers\|views…]` | Schema as JSON |
| `spacetime subscribe <db> "SELECT …" --num-updates 10` | Watch live updates |
| `spacetime list`, `delete <db>`, `rename`, `lock <db>`, `unlock <db>` | Database management; `lock` prevents deletion |
| `spacetime server add <name> --url http://127.0.0.1:3000 --default`, `server list`, `server ping <name>` | Server nicknames in `cli.toml` |
| `spacetime login`, `login --token <jwt>`, `login show --token`, `logout` | CLI identity |
| `spacetime start --listen-addr 0.0.0.0:3000 [--pg-port 5432]` | Run a standalone server |
| `spacetime mcp [db] --server <name>` | MCP over stdio for agents |
| `spacetime version list\|install <v>\|use <v>\|upgrade\|uninstall <v>` | Installed CLI/server versions [source] |
| `spacetime dev` | Watch, rebuild, publish, generate and run a client dev server (unstable) |

Global flags: `--root-dir <dir>` (keeps `config/` and `data/` below one directory),
`--config-path <cli.toml>`.

Identity of the CLI:
- `spacetime login` opens spacetimedb.com (GitHub/Google); that identity is portable across
  servers.
- Publishing to a self-hosted server without login and with `--yes` performs a
  **server-issued login** for that server ("logged in directly to your target server")
  [verified 2.10.2]. That identity owns the databases it creates; losing its token (the CLI's
  `cli.toml`, in the stack `mounts/spacetime-cli/cli.toml`) or the server's signing keys locks
  the owner out.
- Owner token for tools: `spacetime login show --token`.

## spacetime.json

```jsonc
// spacetime.json — eingecheckt; JSON5 (Kommentare erlaubt)
{
  "database": "bee-world",
  "server": "local",
  "module-path": "./server",
  "generate": [{ "language": "typescript", "out-dir": "./src/net/bindings" }]
}
```

- Layering (highest first): CLI flags → `spacetime.<env>.local.json` → `spacetime.<env>.json` →
  `spacetime.local.json` → `spacetime.json`. `--env dev` selects the environment;
  `spacetime dev` implies `--env dev`. `*.local.json` files belong in `.gitignore`.
- Further fields: `bin-path`, `js-path`, `build-options`, `break-clients`, `anonymous`,
  `children` (more databases sharing the module, e.g. world shards), `dev.run`.
- `spacetime mcp`, `list` and `rename` use the configured server when it is unambiguous
  (2.10.1).

## Server `config.toml`

Location: `<data-dir>/config.toml`; the server writes a commented default on first start, and
that default sets **debug** log directives for the SpacetimeDB crates [verified 2.10.2].
Changes need a restart.

```toml
[logs]
level = "info"
directives = ["spacetimedb=info", "spacetimedb_standalone=info"]

[module-http]
enabled = false            # keine ausgehenden HTTP-Requests aus Prozeduren/Handlern

[websocket]
ping-interval = "15s"
idle-timeout = "30s"
close-handshake-timeout = "250ms"
incoming-queue-length = 16384   # pro Client; Überlauf → Verbindung wird geschlossen

[commitlog]
max-segment-size = 1073741824
write-buffer-size = 131072

[wasm]
procedure-instance-pool-size = 2   # Standard: Anzahl der Kerne
[v8]
procedure-instance-pool-size = 2

[v8-heap-policy]
heap-limit-mb = 0                  # 0 = V8-Standard
heap-gc-trigger-fraction = 0.67
heap-retire-fraction = 0.75

[certificate-authority]
jwt-priv-key-path = "/stdb/config/id_ecdsa"
jwt-pub-key-path = "/stdb/config/id_ecdsa.pub"
```

The `[wasm]`, `[v8]` and `[v8-heap-policy]` keys appear only in the generated default file, not
on the documentation page [verified 2.10.2]. Start flags: `--listen-addr` (default
`0.0.0.0:3000`), `--data-dir`, `--jwt-pub-key-path` + `--jwt-priv-key-path`, `--pg-port`,
`--in-memory` (no durability; tests only), `--page_pool_max_size` (cache of free 64 KiB pages,
default 8 GiB), `--non-interactive` [source].

Data directory written by `spacetime --root-dir=/stdb start` [verified 2.10.2]:

```
/stdb/config/cli.toml        CLI identity and server list
/stdb/config/id_ecdsa(.pub)  JWT signing keys (generated on first start when both are missing)
/stdb/data/config.toml       server config
/stdb/data/control-db/       database catalogue
/stdb/data/...               commit logs, snapshots, program bytes per database
/stdb/data/logs/             host log (spacetime-standalone.log)
```

## HTTP routes (all under `/v1`)

| Route | Who needs it | Default access |
|---|---|---|
| `GET /v1/database/:db/subscribe` (WebSocket upgrade) | game clients | anyone |
| `POST /v1/identity/websocket-token` | browser SDK with a saved token | any token holder |
| `POST /v1/identity` | mints a new anonymous identity | anyone |
| `GET /v1/ping` | health checks | anyone |
| `ANY /v1/database/:db/route/*` | module HTTP handlers (beta) | anyone; handler validates |
| `POST /v1/database/:db/call/:reducer`, `POST /v1/database/:db/sql` | tools | anonymous allowed (public data, any reducer) |
| `GET /v1/database/:db/schema` | tools | anonymous; lists private tables and all reducers [verified 2.10.2] |
| `POST /v1/database`, `PUT /v1/database/:db` | publishing | **anonymous may create new databases** [verified 2.10.2]; updates owner-only |
| `DELETE /v1/database/:db`, `GET …/logs`, environment routes | owner tools | owner |
| `POST /v1/mcp`, `POST /v1/database/:db/mcp` | MCP clients | token decides |
| `GET /v1/metrics` (≈1300 lines Prometheus text), `/v1/prometheus/sd_config`, `/v1/energy/*` | monitoring | **unauthenticated** [verified 2.10.2] |
| `/internal/heap`, `/internal/heap/settings` (POST switches heap profiling) | jemalloc heap profiles on Linux builds | unauthenticated [source] |

Which routes the public reverse proxy forwards: skill `spacetimedb-ops`,
`references/proxy.md`.
