# Sources

What each source contributes to the `spacetimedb-*` skills. Retrieved 2026-10-01/02 for
SpacetimeDB 2.10.2; repository state: master commit `0ba810e` (2026-10-01).

## Official documentation (repository `docs/docs/`, site https://spacetimedb.com/docs)

| Page | Contribution |
|---|---|
| Intro: what-is, zen, key architecture, FAQ | Mental model, identity derivation, room-per-database pattern, license summary, version-mismatch errors |
| Tables, column types, indexes, constraints, auto-increment, default values, access permissions, schedule tables, event tables, performance | Data modeling rules, index kinds (btree, direct), sequence batches of 4096, decomposition by access pattern, schedule semantics, event-table semantics |
| Functions: reducers, reducer context, lifecycle, error handling, procedures, views, HTTP handlers | Transaction rules, `SenderError`, owner identity in `init`, connection rejection, procedure `withTx` re-execution, view read sets and anonymous vs per-user cost, handler authentication |
| Subscriptions, subscription semantics, SQL reference | Query rules (one table, two-way joins on indexed columns), grouping by lifetime, subscribe-before-unsubscribe, ordering guarantees, `row_limit` |
| Authentication, auth claims, SpacetimeAuth, Steam, BetterAuth | OIDC flow, `iss`/`aud` checks, short-lived WebSocket tokens, discovery and JWKS requirements |
| Clients: connection, TypeScript reference | Builder options, reconnect behaviour, cache API, React provider backoff |
| Migrations: automatic, incremental | Allowed and forbidden schema changes, Lightfox incremental-migration pattern |
| How-to: self-hosting, Railway, PG wire, logging, row-level security, reject connections, migrating to 2.0, self-hosted key rotation, troubleshooting | Reverse-proxy route allowlist, data volume at `/stdb`, PGWire limits, RLS status, 2.0 semantics (confirmed reads), key rotation strategies, prebuilt-artifact image with self-publishing entrypoint |
| Reference: CLI, `spacetime.json`, standalone config, MCP, HTTP API, BSATN, commit log | Commands and flags, config layering, `config.toml` keys, MCP tools, HTTP routes, encoding sizes, WAL format and compression |
| Environment variables | Feature of master (2.11); absent in 2.10.2 |

## Official agent tooling

| Source | Contribution |
|---|---|
| `skills/{concepts,cli,mcp,rust-server,typescript-server,typescript-client}/SKILL.md` | Current 2.x syntax per language, TypeScript pitfalls, MCP tool shapes |
| `.claude-plugin/marketplace.json`, `codex-plugin/` | Official Claude plugin (`spacetimedb@spacetimedb-plugins`) and its MCP command `spacetime mcp` |
| https://spacetimedb.com/agent-setup.md, https://spacetimedb.com/llms.txt | Agent setup guide, documentation index |

## Source code (master, ≈2.11)

| File | Contribution |
|---|---|
| `LICENSE.txt` | BSL additional use grant: one production instance, no database service; change date |
| `crates/core/src/subscription/module_subscription_manager.rs`, `module_subscription_actor.rs`, `crates/physical-plan/src/plan.rs` | Query sharing across clients, search-argument pruning for single-column equality, sequential evaluation in the commit path |
| `crates/engine/src/relational_db.rs`, `snapshot.rs`, `crates/durability/src/imp/local.rs` | Snapshot every 1,000,000 transactions, segment compression after snapshots, group-commit fsync |
| `crates/client-api/src/routes/{mod,subscribe,metrics,internal}.rs` | Route table, unauthenticated metrics, incoming queue, message size limit, compression enum, `confirmed` default, `session_id` |
| `crates/core/src/client/client_connection.rs` | Outgoing queue capacity and kicking slow clients |
| `crates/core/src/auth/token_validation.rs`, `crates/client-api/src/auth.rs`, `crates/standalone/src/lib.rs` | Local issuer `localhost`, OIDC discovery without issuer allowlist, `aud` not validated, optional `exp` |
| `crates/client-api-messages/src/energy.rs`, `crates/core/src/host/v8/mod.rs` | Reducer budget ≈1 minute (WASM fuel), missing V8 timeout |
| `crates/bindings-typescript/src/sdk/{db_connection_builder,ws,table_cache,connection_manager,subscription_builder_impl}.ts` | Builder defaults, token exchange, O(n) cache lookups, provider reconnect logic |
| `crates/cli/src/subcommands/start.rs`, `crates/paths/src/lib.rs`, `crates/update/src/cli.rs` | `--root-dir` layout, key directory, version subcommands; `spacetime start` replaces its process with the server |
| `crates/standalone/src/subcommands/start.rs` (also at tag v2.10.2) | Graceful shutdown only on Ctrl-C (SIGINT) |
| `crates/standalone/src/lib.rs` (`leader`), `crates/client-api/src/routes/database.rs` | Databases launch on the first request that needs them (`subscribe`, `call`, `sql`, `schema`, `logs`, routes) |
| `crates/client-api/src/routes/mod.rs` | CORS: any origin, any method on `/v1` |
| `crates/cli/src/tasks/javascript.rs` | TypeScript build: `tsc --noEmit` only from the module's own `node_modules`, rolldown bundle `dist/bundle.js` |
| `Dockerfile` (also at tag v2.10.2) | Official image: Rust/.NET toolchains, `curl`, user `spacetime` from `useradd`, entrypoint `spacetime`, port 3000 |

## Release notes and issues

| Source | Contribution |
|---|---|
| GitHub releases v2.4.1 … v2.10.2 | Procedures stable (2.5), view primary keys (2.6), camelCase handles and unique/PK migrations (2.7), submodules and schedule-delay metric (2.8), `spacetime mcp` (2.8.1), Claude plugin (2.8.2), schedule anchoring (2.8.3), `[module-http]` and commit-log durability fix (2.9), TS SDK error routing (2.10.0), concurrent scheduled dispatch (2.10.1) |
| PR #5975 (scoped views, open) | Cost of per-user views: one shared write seen by 250 per-user views 42.6 ms (TS) / 31.7 ms (Rust) |
| Issue #5317 (open) | TS client cache scans the whole table on `find`/`filter` |
| PR #5017 (merged) | Rejecting malformed reducer arguments, disconnecting misbehaving clients |
| Issues #5927, #5903, #5908 (open) | Vanilla TS auto-reconnect, rate-limit and lobby submodules still pending |

## Articles, benchmarks, examples

| Source | Contribution |
|---|---|
| [Ok, but does it scale?](https://spacetimedb.com/blog/how-does-spacetime-scale) (2026-09-03) | Single-threaded execution per database by design, ~300k TPS, BitCraft root and region databases, inter-database communication roadmap |
| `templates/keynote-2/README.md` | Benchmark method and numbers (i9-14900K, 279k–304k TPS with 40 in-flight requests) |
| [Critical look at the v2 benchmark](https://dev.to/tanay/a-closer-look-at-the-spacetimedb-v2-benchmark-is-it-really-23x-faster-than-sqlite-2l9f) | Asymmetric pipelining, latency costs of high in-flight counts |
| [Hacker News: SpacetimeDB ThreeJS support](https://news.ycombinator.com/item?id=47157265) | Practitioner reports, single-instance license concern |
| `demo/Blackholio` (Rust server, Phaser web client) | Reference game: 50 ms tick, input reducer, interpolation, event table for effects, existence-based tables |
| `templates/browser-ts` | Vite client wiring with `VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB_NAME` |

## Lab measurements

Skill `spacetimedb-performance`, `references/lab-results.md`: SpacetimeDB 2.10.2 standalone on the
development machine, TypeScript and Rust twin modules, headless bots; security probes against
the same server, including the idle commit-log comparison of the two tick designs. Operations
probes on that server (restore drill, publish outcomes of schema changes, `--delete-data`,
replay speed, MCP identity) are recorded in skill `spacetimedb-ops`; the two-client `NetClient`
run in skill `spacetimedb-babylon`.
