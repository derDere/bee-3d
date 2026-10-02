# Module hardening

Rules for reducer code, data exposure and cheat resistance. Code fragments come from the
reference module `skills/spacetimedb/templates/server/src/index.ts` [verified 2.10.2] unless
tagged otherwise.

## Order inside every client reducer

1. Validate the shape and size of every argument (no table access yet).
2. Resolve the caller: `requirePlayerId(ctx)` via `account.identity.find(ctx.sender)`.
3. Check ownership and state of every row the call touches (indexed lookups).
4. Check rate limits and cooldowns.
5. Apply changes.

Throw `SenderError` for every rejection; the whole transaction rolls back.

## Argument validation

| Type | Check |
|---|---|
| `f32`/`f64` | `Number.isFinite` (rejects `NaN`, `±Infinity`); range against world bounds or game limits |
| integers | range; `u32`/`i16` wrap is done by the decoder, values outside the type never arrive |
| `string` | trim; length in code points (`[...s].length`), not UTF-16 units; allowed characters (`/^[\p{L}\p{N} _-]+$/u` for names); reject control characters |
| arrays (`t.array`) | maximum length before iterating; validate each element |
| enums (`t.enum`) | `tag` from the expected set; payload validated per variant |
| identities, player ids | never trusted as "who"; only as "whom", resolved and checked |
| timestamps from clients | ignored for game logic; the server's `ctx.timestamp` decides |

Malformed binary arguments (wrong type, trailing bytes) are rejected by the host, and clients
that keep sending them are disconnected (2.8 release line, PR #5017).

## Bounded work

- Reducers run one at a time per database; a reducer with input-dependent cost turns any client
  into a lag switch for everybody.
- Use `find`/`filter` on indexes; `iter()` only on tables whose size the module controls
  (the inbox, small configuration).
- Cap loops by validated sizes; split large jobs into scheduled batches.
- TypeScript modules have no working execution timeout yet [source]; a `while (true)` hangs the
  database until restart.

## Rate limits

| Need | Pattern |
|---|---|
| High-frequency input (poses) | One inbox row per player, overwritten; the tick reads it — extra calls only overwrite |
| Actions with cooldown | Private row per player with `nextAllowedAtMs: u64`; compare with `ctx.timestamp.microsSinceUnixEpoch / 1000n` |
| Bursty actions (chat) | Token bucket per player: `tokens`, `updatedAtMs` in a private row; refill on use |
| New identities, connections, HTTP requests | Reverse proxy per IP (references/infrastructure.md) |

The cooldown pattern from the reference module:

```ts
const nowMs = ctx.timestamp.microsSinceUnixEpoch / 1000n;
const entry = ctx.db.cooldown.playerId.find(playerId);
if (entry && nowMs < entry.nextBuzzAtMs) throw new SenderError('cooldown');
const next = { playerId, nextBuzzAtMs: nowMs + BuzzCooldownMs };
if (entry) ctx.db.cooldown.playerId.update(next);
else ctx.db.cooldown.insert(next);
```

A rejected call writes nothing; an accepted one costs one row write — keep cooldown state
separate from hot replicated rows.

## Cheat resistance for a flying game

| Cheat | Server measure |
|---|---|
| Speed hack, teleport | Tick clamps the step to `MaxSpeed × SpeedSlack × elapsed ticks` against the last authoritative position; elapsed ticks are capped at `MaxElapsedTicks` (1 s), because a bee at rest writes no row and idle time must not build up a jump budget |
| Flying through islands | Coarse collision volumes of islands in a private table, checked in the tick along the step (segment against spheres/capsules) |
| Out of world | Bounds check in the report reducer |
| Fake positions near rewards | Collecting checks distance between the authoritative position and the target in the reducer |
| Action spam | Cooldowns; outcomes decided server-side |
| Reading hidden data | Hidden data stays in private tables; per-user views return only the caller's share |
| Predicting loot | Secret-mixed randomness (references/auth.md) |

The client keeps flying its own bee immediately (no input lag) and reconciles when the
authoritative position deviates beyond a threshold (skill `spacetimedb-babylon`,
`references/movement.md`).

## Data exposure

| Data | Placement |
|---|---|
| Visible to everyone (positions, names, island state) | Public table, minimal columns |
| Visible only to the owner (inventory, settings, mail) | Private table + per-user view (`ctx.sender`) with a primary key |
| Visible to a group | Public table keyed by group only when the group data may be public; otherwise per-user view |
| Transient effects | Event table; same public/private choice |
| Secrets (API keys, seeds) | Private table written by an owner-only reducer; never returned by views, procedures or logs |
| Moderation data, IP-like data | Private; avoid storing personal data at all |

- Row-level security filters (`clientVisibilityFilter`) are experimental and gated behind
  `unstable` in Rust; views are the supported access-control tool.
- A view that returns a row exposes every column of that row: return a narrowed row type.
- Changing a private table to public is a silent, allowed migration — the review checklist flags
  every `public: true`.
- Environment variables for secrets arrive with 2.11; in 2.10.2 secrets live in private tables.

## Logging hygiene

- `console.*` / `log::*` lines go to the database log, readable by the owner and stored on the
  server. Never log tokens, JWT payloads or personal data.
- Rejections at `warn`, not `error`, once the game runs; sampled timings only.

## Procedures and outbound HTTP

- Only procedures can call HTTP. A procedure that fetches a URL from an argument is an SSRF hole:
  fixed hosts only, and `[module-http] enabled = false` on servers whose modules need no outbound
  calls.
- `withTx` callbacks may run several times; side effects (HTTP, counters outside the
  transaction) stay outside them.
- Scheduled reducers and procedures are private: clients cannot call them; the owner can.
