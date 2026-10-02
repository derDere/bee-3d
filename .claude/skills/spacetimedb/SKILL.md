---
name: spacetimedb
description: Use when planning, writing, reviewing or debugging anything that touches SpacetimeDB — module code in TypeScript or Rust (tables, indexes, reducers, procedures, views, schedule tables, event tables, lifecycle reducers), the TypeScript client SDK, the spacetime CLI, spacetime.json, generated bindings, the SpacetimeDB MCP server, version upgrades, or questions about how SpacetimeDB works and which API form is current.
---

# SpacetimeDB — foundation

SpacetimeDB is a relational database that is also the game server. The module (TypeScript or
Rust) declares tables and the functions that change them and runs inside the database; every
client keeps a live, read-only replica of the rows it subscribes to. This skill holds the house
decisions for bee-3d, the mental model, the API-truth workflow and the tooling. Four specialised
skills build on it: `spacetimedb-performance`, `spacetimedb-security`, `spacetimedb-ops` and
`spacetimedb-babylon`.

## Evidence tags

| Tag | Meaning |
|---|---|
| **[verified 2.10.2]** | Checked against SpacetimeDB 2.10.2: CLI, npm typings, Rust crate and a running lab server. |
| **[measured]** | Measured in the lab; setup and numbers in skill `spacetimedb-performance`, `references/lab-results.md`. |
| **[source]** | Read in the SpacetimeDB source (master of 2026-10-01, pre-release 2.11). The AI agent confirms it on the installed version before relying on it. |
| **[docs]** | Official documentation. The site tracks master and can describe unreleased features. |
| **[recommendation]** | Design choice of these skills; the developer confirms or changes it. |

## Mental model

- **Host → databases → module.** One SpacetimeDB process (host) runs many databases. Each
  database runs one module: its tables, reducers, procedures, views and HTTP handlers.
- **All data lives in memory.** Durability comes from a commit log (write-ahead log) plus a
  snapshot every 1,000,000 transactions; RAM bounds the data size. The commit log is never
  pruned [source].
- **Reducers** are the write path: one transaction each, executed **serially per database**,
  atomic, deterministic, without network or file access. They do not return data; clients see
  results through subscriptions.
- **Procedures** may call HTTP and open their own transactions (`withTx`); stable since 2.5.0.
- **Views** are read-only functions clients subscribe to: anonymous views are computed once for
  everyone, per-user views once per subscriber.
- **Schedule tables** run a reducer or procedure at a time or interval; **event tables**
  broadcast rows that exist only for the duration of their transaction.
- **Subscriptions** replicate the rows matched by queries. The server evaluates only the delta
  of each transaction, shares identical queries between clients and prunes queries with a
  single `column = value` filter by that value [source].
- **Identity** = hash of the token's `iss` and `sub` claims; a `ConnectionId` names one
  connection. Anonymous clients receive a server-issued token (`iss` `localhost`, no expiry)
  [verified 2.10.2].

## Version and license

- Current release **2.10.2** (2026-09-29): Docker `clockworklabs/spacetime:v2.10.2`, npm
  `spacetimedb@2.10.2`, crate `spacetimedb = "=2.10.2"` [verified 2.10.2]. Releases arrive
  roughly weekly.
- **Lockstep rule:** server image, CLI, module library, client SDK and generated bindings carry
  the same version. A mismatch shows up as confusing build, publish or serialization errors.
  Upgrade procedure: skill `spacetimedb-ops`.
- **License BSL 1.1:** production use is granted for at most **one SpacetimeDB instance in
  production** (one server process; many databases inside it are fine) and not as a database
  service for third parties. The code converts to AGPLv3 with a linking exception on the change
  date (2031-09-15 for 2.11) [source]. Development and staging instances are not production.
- **Announced, not released:** asynchronous inter-database calls and tiered storage
  (planned 2026-10-31). The AI agent checks the release notes before designing around them.

## Stack decisions for bee-3d [recommendation]

| Area | Decision | Reason |
|---|---|---|
| Server module | **TypeScript** (`spacetimedb/server`), bundled by `spacetime build` | Same server CPU as Rust for fan-out-heavy game reducers [measured]; one language with the browser client; shared pure code; no Rust toolchain |
| Heavy server simulation | Rust only in a separate module and database, and only after a measured reducer exceeds its budget | Rust is 1.5–5× faster in tight loops [measured]; one module cannot mix languages |
| Shared code | `shared/` with pure TypeScript (constants, cell packing, validation limits) imported by module and client | Relative imports outside the module folder bundle fine [verified 2.10.2] |
| Client | Babylon.js in the browser with the npm `spacetimedb` SDK and generated bindings | Skill `spacetimedb-babylon` |
| Hosting | One self-hosted SpacetimeDB container next to the web-client container | BSL one-instance grant; skill `spacetimedb-ops` |
| Databases | One world database `bee-world`; more databases (shards, rooms) only after measurement | Execution is serial per database |
| Movement | Validated client authority, coalesced by a 20 Hz world tick | Skill `spacetimedb-babylon`, `references/movement.md` |
| Authentication | Open decision: guest identities or an OIDC provider | Skill `spacetimedb-security`, `references/auth.md` |

## API truth: look it up, then write

Training data mixes SpacetimeDB 0.x, 1.x and 2.x, and the documentation site describes master,
including features that are not released yet. Example: environment variables (`ctx.env`,
`spacetime env`) are documented but missing from 2.10.2 [verified 2.10.2]. For every SpacetimeDB
API that lands in code, the AI agent checks in this order:

1. **Installed version:** `node_modules/spacetimedb/dist/server/*.d.ts` (module),
   `dist/sdk/*.d.ts` (client), the generated bindings, `spacetime <command> --help`.
2. **Repository at the matching tag:**
   `https://raw.githubusercontent.com/clockworklabs/SpacetimeDB/v2.10.2/<path>` — `docs/docs/`,
   `skills/<name>/SKILL.md` (official agent skills), `crates/bindings-typescript/src/`,
   `crates/bindings/src/` (Rust), `crates/core/src/` (engine).
3. **Context7:** `/websites/spacetimedb` (site) or `/clockworklabs/spacetimedb` (repository).
   `/clockworklabs/spacetime-docs` and `/clockworklabs/spacetimedb-typescript-sdk` are stale 1.x
   repositories.
4. **DeepWiki MCP:** `ask_wiki_question` with repository `clockworklabs/SpacetimeDB` for engine
   internals. Answers are AI-generated summaries; the AI agent confirms them in the source.
5. **Release notes:** `https://api.github.com/repos/clockworklabs/SpacetimeDB/releases`.

Agent `spacetimedb-api-verifier` runs larger lookups and keeps the documentation out of the main
context. Where sources disagree, the installed typings and the source win.

### Known gaps between documentation and 2.10.2

| Documentation | Actual behaviour |
|---|---|
| Rust procedures need `features = ["unstable"]` | Stable since 2.5.0; `unstable` gates RLS filters and HTTP handlers only [source] |
| `subscriptionBuilder().onError((ctx, error) => …)` | One parameter; the error is `ctx.event` [verified 2.10.2] |
| `spacetime env`, `ctx.env`, `schema(…, { env })` | Not in 2.10.2 [verified 2.10.2] |
| Adding a unique or primary-key constraint is a forbidden migration | Allowed since 2.7.0 when existing rows satisfy it (release notes) |
| The TS client cache has no btree index access | `filter()` exists, but `find()` and `filter()` scan the whole cached table [source] |
| `ScheduleAt` is imported from `spacetimedb` | Also exported by `spacetimedb/server` [verified 2.10.2] |
| WebSocket `incoming-queue-length` example 2048 | Built-in default 16384 [source] |

## Rules that always apply

1. Reducers are the only write path. No I/O, no module-level mutable state; time and randomness
   come from `ctx.timestamp` and `ctx.random`.
2. Authorize with `ctx.sender` — never with an identity passed as an argument.
3. Tables are private by default. `public` exposes every row and column to anyone who reaches
   the server, including anonymous HTTP SQL [verified 2.10.2].
4. Hot paths use indexes: `find` on primary key or unique columns, `filter` on btree columns.
5. Only the primary-key accessor has `update()`; client `onUpdate` exists only for tables and
   views with a primary key.
6. Auto-increment values have gaps (blocks of 4096 per restart); they never define an order.
7. Validate every reducer argument: finite numbers, ranges, string and array lengths. A single
   WebSocket message may carry 32 MiB [source].
8. Transient effects go into event tables; everything else is persistent and needs a cleanup
   plan.
9. After every schema change: `spacetime generate`; module and client ship together.
10. Bounded work per reducer: the database executes one reducer at a time, so a slow reducer
    stalls every player.

## Tooling

| Tool | Purpose | Provision |
|---|---|---|
| `spacetime` CLI 2.10.2 | `build`, `publish`, `generate`, `sql`, `call`, `logs`, `describe`, `mcp`, `lock` | The developer installs it: Windows `iwr https://windows.spacetimedb.com -useb \| iex`, then `spacetime version install 2.10.2` and `spacetime version use 2.10.2` |
| MCP `spacetimedb` | `list_databases`, `get_schema`, `sql`, `call`, `ping` against the local stack (`http://127.0.0.1:3000`) | `.mcp.json`: `spacetime --config-path mounts/spacetime-cli/cli.toml mcp` over stdio, i.e. the owner identity of the publish tool; needs the CLI; after the first `make start` the developer restarts the MCP server (`/mcp`) so it loads the owner token |
| MCP `deepwiki` | Questions about the SpacetimeDB source | `.mcp.json` (remote, no account); questions leave the machine — never include project secrets |
| MCP `context7` | Documentation lookups | User scope |
| `https://spacetimedb.com/llms.txt` | Documentation index for agents | WebFetch |

MCP rules [verified 2.10.2]: the tools act with the identity of the CLI configuration — in this
project the database owner, so `sql` sees private tables and accepts `INSERT`, `UPDATE` and
`DELETE`. `get_schema` is read-only; `sql` and `call` are flagged destructive. The AI agent
runs `SELECT` statements and calls reducers only on development databases, writes through
`sql` only at the developer's request, and never touches production. Without an owner token
(before the first publish) the tools run anonymously; `no such table` then means a private
table.

## Project layout [recommendation]

```
spacetime.json          CLI project config: database, server, module-path, generate target
spacetime.local.json    developer overrides (git-ignored)
server/                 SpacetimeDB module (TypeScript): package.json, tsconfig.json, src/index.ts
shared/                 pure TypeScript used by module and client (no imports from either side)
src/net/                client networking → skill spacetimedb-babylon
src/net/bindings/       output of `spacetime generate` — never edited by hand
tools/loadtest/         headless bot harness → skill spacetimedb-performance
docker/spacetimedb/     config.toml of the server container → skill spacetimedb-ops
tools/spacetimedb_publish.py  publish step of make start/update → skill spacetimedb-ops
mounts/spacetimedb/     server keys and data; mounts/spacetime-cli/ owner token (git-ignored)
```

## Workflow

1. Model tables by access pattern and update frequency (skill `spacetimedb-performance`);
   decide public, private, view or event table for each (skill `spacetimedb-security`).
2. Write reducers with argument validation and `ctx.sender` checks.
3. Publish to the local server, run `spacetime generate`, integrate the client
   (skill `spacetimedb-babylon`).
4. Agent `spacetimedb-module-reviewer` checks security and performance; agent
   `spacetimedb-load-tester` measures with headless bots.
5. Build, deploy, back up and upgrade with skill `spacetimedb-ops`.

## Signposts

| Topic | Skill / agent |
|---|---|
| Cost model, schema and tick design, interest management, load tests, sizing | Skill `spacetimedb-performance`, agent `spacetimedb-load-tester` |
| Authentication, authorization, input validation, anti-cheat, exposure, hardening | Skill `spacetimedb-security`, agent `spacetimedb-module-reviewer` |
| Docker image, reverse proxy, make targets, publishing, migrations, backups, upgrades | Skill `spacetimedb-ops` |
| Connection, replication into Babylon.js, interpolation, prediction, time sync | Skill `spacetimedb-babylon` |
| Verify an API against the installed version | Agent `spacetimedb-api-verifier` |

## Reference files

| File | Content |
|---|---|
| [module-api.md](references/module-api.md) | TypeScript module API 2.10.2 with Rust equivalents: tables, indexes, reducers, lifecycle, schedules, event tables, views, procedures, auth context |
| [client-api.md](references/client-api.md) | TypeScript client SDK 2.10.2: builder options, subscriptions, query builder, row callbacks, reducer calls, cache limits |
| [cli-config.md](references/cli-config.md) | CLI commands, `spacetime.json`, server `config.toml`, version management, HTTP API routes |
| [sources.md](references/sources.md) | Documentation, source files, release notes and articles behind these skills |
