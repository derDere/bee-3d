---
name: spacetimedb-security
description: Use when designing or reviewing who may connect to a SpacetimeDB database, what each player may read or change, or how the server is exposed — authentication with guest tokens or OIDC providers, issuer and audience checks, authorization in reducers, input validation, rate limiting, cheat resistance, public versus private tables and views, secrets, reverse-proxy route allowlists, open publishing on standalone servers, metrics exposure, signing keys and outbound HTTP from modules.
---

# SpacetimeDB security

A SpacetimeDB module is the backend, and it sits directly on the internet: every client talks to
the database itself. Security therefore lives in three places — the module (who may do what),
the data model (who may see what) and the infrastructure in front of the server (which HTTP
routes exist at all). This skill holds the threat model, the rules and the checks.

**REQUIRED BACKGROUND:** skill `spacetimedb` (rules, API, evidence tags).

## Threat model

| Exposure | Fact | Consequence |
|---|---|---|
| Anyone can connect | A client without token gets a fresh server-issued identity (`iss` `localhost`, no expiry) [verified 2.10.2] | Unlimited anonymous identities; per-identity limits alone do not stop floods |
| Any OIDC token is accepted | The server validates the signature of any issuer via discovery and JWKS; it checks neither issuer nor audience [source] | The module must check `iss` and `aud` itself |
| Public tables | Every row and column of a public table is readable by any client, also through anonymous HTTP SQL [verified 2.10.2] | "Public" means "published to the internet" |
| Schema | Anonymous `GET /v1/database/<db>/schema` lists all tables (private ones too) and all reducers [verified 2.10.2] | Names and shapes are not secret |
| Standalone server | Anonymous clients may **create new databases** by publishing [verified 2.10.2] | Without a route allowlist strangers run code on the host |
| Monitoring routes | `/v1/metrics` and `/internal/*` need no authentication [verified 2.10.2] [source] | Internal network only |
| Reducer arguments | One WebSocket message may carry 32 MiB [source] | Every argument needs size limits |
| Serial execution | One slow reducer blocks the database; the WASM budget is about one minute, the V8 timeout is not wired up [source] | Bounded work per call |
| Token discovery | Validating a foreign token makes the server fetch `<iss>/.well-known/openid-configuration` [source] | Outbound requests to attacker-chosen URLs; restrict egress |
| Hostile client | The client is modified at will | Server authority over every game rule |
| Browser token | The long-lived token sits in `localStorage` | XSS steals accounts; strict CSP |

## Rules

1. **Gate every connection.** `clientConnected` checks the token: owner identity → allowed;
   `iss === 'localhost'` → guest, allowed only by explicit policy; otherwise the issuer must be
   on the allowlist and its `aud` must contain the game's client id. Throwing rejects the
   connection. Code: [references/auth.md](references/auth.md).
2. **Authorize every reducer with `ctx.sender`.** Resolve the caller's account by index and
   check ownership of every row the call touches. Identities or player ids in arguments are
   claims to verify, never facts.
3. **Validate every argument.** Finite numbers, value ranges, string lengths in code points,
   allowed characters, array lengths, known enum tags — before any table access.
4. **Bound the work.** Index lookups only; loops capped by validated sizes; no reducer whose
   cost grows with input the client controls.
5. **Limit rates in the module and at the proxy.** Cooldown rows and inbox overwrites per player
   in the module; connection and request limits per IP at the reverse proxy.
6. **Server authority over game state.** Clients send intents and poses; the module decides
   outcomes (collecting, scoring, inventory) and checks plausibility (speed, range, cooldowns).
7. **Private by default, public on purpose.** A table is public only when every row and column
   may be seen by anyone. Private per-player data reaches its owner through a per-user view;
   secrets never sit in public tables or view results.
8. **Fair randomness needs a secret.** `ctx.random` is seeded from the transaction timestamp
   [source]; loot and odds mix in secret state from a private table.
9. **Expose three routes, nothing else.** The public reverse proxy forwards only the WebSocket
   subscribe route, the WebSocket token exchange and (optionally) module HTTP routes. Publishing,
   SQL, schema, logs, metrics, MCP and `/internal` stay internal.
10. **Keep keys and versions under control.** Persist and back up the JWT signing keys, lock the
    production database, disable module HTTP unless needed, restrict egress, follow security
    fixes in releases.

Details: module side in [references/module-hardening.md](references/module-hardening.md),
infrastructure in [references/infrastructure.md](references/infrastructure.md).

## Authentication for bee-3d — open decision

| Option | Effort | Player experience | Risks |
|---|---|---|---|
| Guests only (server-issued tokens) | none | instant play; progress tied to one browser | lost on cleared storage, no recovery, unlimited identities |
| Guests plus optional account linking | link flow (see auth.md) | play first, secure progress later | linking must be one-time and short-lived |
| OIDC provider only | provider setup | login before playing | provider availability; issuer must be reachable from the SpacetimeDB container |

[recommendation] Start with guests behind the connection gate and the proxy limits; add an OIDC
provider with account linking before progress becomes valuable. The developer decides.

## Review

Agent `spacetimedb-module-reviewer` audits module, client and infrastructure against
[references/review-checklist.md](references/review-checklist.md). The AI agent requests a review
after every change to `clientConnected`, to a public table or view, to reducers that change
shared state, and to the proxy or Docker configuration.

## Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| No issuer/audience check | Tokens from any OIDC provider, issued for any app, work | Allowlist in `clientConnected` |
| Owner tools blocked by the gate | CLI and MCP calls rejected | Owner identity stored in `init` passes first |
| Creating rows in `clientConnected` | Every anonymous HTTP request creates a row | Create accounts in an explicit, rate-limited reducer |
| `playerId` argument trusted | Players act for others | Derive from `ctx.sender` |
| Float arguments unchecked | `NaN`/`Infinity` poison positions and indexes | `Number.isFinite` before use |
| Secrets in a public table or returned by a view | Readable by everyone | Private table, owner-only reducers |
| Whole server published behind the proxy | Strangers publish databases, read metrics | Route allowlist |
| Signing keys regenerated on redeploy | Every guest account lost (`InvalidSignature`) | Keys on the persistent volume, in backups |
