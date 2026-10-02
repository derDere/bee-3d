# Security and performance review checklist

Agent `spacetimedb-module-reviewer` works through this list; the AI agent in the main context uses
it for quick self-checks. Every finding names file and line, the risk, and the concrete fix.
Severity: **critical** (exploitable or data loss), **high** (cheating, outage under load),
**medium** (cost, robustness), **low** (hygiene).

## Connection and identity

- [ ] `clientConnected` exists, is exported and calls the connection gate first.
- [ ] Owner identity is stored in `init` and passes the gate.
- [ ] Guests (`iss` `localhost`) are allowed or rejected by an explicit flag.
- [ ] Non-guest tokens: issuer on the allowlist **and** `aud` contains the game's client id.
- [ ] `clientConnected` creates no persistent rows (it also runs for every HTTP request).
- [ ] `clientDisconnected` cleans up hot rows only when no other connection of the player is open.

## Reducers

- [ ] Every client reducer resolves the caller via `ctx.sender`; no "who" from arguments.
- [ ] Every argument validated: `Number.isFinite`, ranges, string length in code points,
      character set, array caps, enum tags.
- [ ] Ownership of every touched row is checked.
- [ ] Work per call is bounded; no `iter()` over tables that grow with players, no loops bounded
      by client input without a cap.
- [ ] Actions with gameplay value have cooldowns or token buckets; high-frequency input uses an
      overwritten inbox row.
- [ ] Outcomes (collect, score, damage, loot) are decided in the module; client-reported results
      are never accepted as facts.
- [ ] Movement is clamped against speed, bounds and (when present) island colliders in the tick.
- [ ] Randomness with value uses secret-mixed state, not plain `ctx.random`.
- [ ] `SenderError` for rejections; no secrets or personal data in messages and logs.

## Data exposure

- [ ] Every `public: true` table is justified: all rows and all columns may be seen by anyone.
- [ ] Hot public tables carry compact ids, no `Identity`, no strings.
- [ ] Private per-player data reaches clients only through per-user views with narrowed row types.
- [ ] Views never return secrets; a view's row type matches what the client may see.
- [ ] No secrets in public tables, view results, procedure results or logs.
- [ ] Event tables carry only what all subscribers of that query may see; scoped by `cell` or
      group where needed.
- [ ] Scheduled reducers and procedures are not re-exported as public wrappers without checks.

## Procedures and HTTP

- [ ] Outbound HTTP only to fixed hosts; no URL from arguments.
- [ ] `withTx` callbacks free of side effects.
- [ ] Module HTTP handlers authenticate requests themselves; the server does not.
- [ ] `[module-http] enabled = false` when no procedure needs outbound HTTP.

## Performance (from skill `spacetimedb-performance`)

- [ ] Input coalesced into a tick; the tick stays under 20 % of its interval in the last load test.
- [ ] Hot queries are single-column equality on an indexed column (`cell = K`); no `OR`/range
      filters on hot tables; no `subscribeToAllTables` in the game client.
- [ ] No per-user views over hot or shared data.
- [ ] Unchanged rows are skipped; the tick number comes from `ctx.timestamp`, not from a row
      rewritten every tick.
- [ ] The speed clamp caps elapsed ticks (`MaxElapsedTicks`), so rest builds no jump budget.
- [ ] Proximity uses the cell index, not pairwise scans.

## Client (TypeScript SDK)

- [ ] Token stored per server and database; never logged; CSP forbids inline and third-party
      scripts.
- [ ] Reconnect with backoff; the session ignores callbacks of replaced connections.
- [ ] Protocol version check before the first subscription; `ProtocolVersion` raised with every
      client-visible module change.
- [ ] No `find()`/`filter()` on the SDK cache in per-frame code; own `Map` registries.
- [ ] Every reducer promise has a `.catch`.
- [ ] Game connection: `withConfirmedReads(false)`, `withCompression('none')` unless measured
      otherwise.

## Infrastructure (skill `spacetimedb-ops`)

- [ ] Proxy forwards only the allowlisted routes; publish, SQL, schema, logs, metrics, MCP,
      `/internal` and PGWire are unreachable from the internet.
- [ ] Per-IP connection and request limits configured.
- [ ] Access logs without query strings on the SpacetimeDB routes.
- [ ] Image version pinned and equal to CLI, module library and client SDK versions.
- [ ] Data volume (data, keys, CLI owner config) persistent and backed up; restore tested.
- [ ] Production database locked (`spacetime lock`).
- [ ] Egress of the container restricted; Docker socket not mounted.
- [ ] Compose service stops with `stop_signal: SIGINT`; server port bound to `127.0.0.1`.
