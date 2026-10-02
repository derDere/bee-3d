---
name: spacetimedb-babylon
description: Use when connecting the Babylon.js browser client of bee-3d to SpacetimeDB — connection setup, tokens and guest or OIDC accounts, reconnect and background tabs, the protocol version check, cell subscriptions, replicating remote bees with interpolation, server clock and time sync, sending the own pose and applying server corrections, buzz and other events, shared time of day and weather, the network part of the debug API, or wiring the network layer into the game loop.
---

# SpacetimeDB in the Babylon.js client

The browser client talks to SpacetimeDB through a small network layer in `src/net/`. It flies
the own bee locally, reports poses, follows the server when it clamps, and renders other bees
from replicated rows. Every template here passed strict `tsc` against generated 2.10.2
bindings and Babylon 9.29. `NetClient` ran against a lab server: spawn, clamps, reconnect and
mutual replication [verified 2.10.2]. Foundation and API facts: skill `spacetimedb`.

## Architecture

```
SpacetimeSession ── DbConnection (reconnect, tokens)
      │
NetClient (FrameSystem) ── protocolVersion check, join, own profile and own row
      ├─ CellSubscriptions   3×3 cells around the player: bee_state + buzz_event
      ├─ PoseReporter        own pose at 15 Hz, heartbeat, deviation check
      ├─ RemoteBees          per-bee sample buffers, survives reconnects
      └─ ServerClock         server tick estimate from row ticks
RemoteBeeViews (FrameSystem) ── interpolated poses → pooled Babylon nodes
```

## Templates

| Template | Project path | Role |
|---|---|---|
| `templates/shared/world.ts` | `shared/world.ts` | Tick rate, cells, speed limits, angle quantisation; shared with the module |
| `templates/shared/protocol.ts` | `shared/protocol.ts` | `ProtocolVersion`; shared with the module |
| `templates/net/spacetimeSession.ts` | `src/net/` | Connection lifecycle with backoff; `TokenStore`, `MemoryTokenStore` |
| `templates/net/browserSession.ts` | `src/net/` | `BrowserTokenStore`, `bindPageLifecycle` |
| `templates/net/oidcTokenStore.ts` | `src/net/` | Token store for OIDC accounts |
| `templates/net/netConfig.ts` | `src/net/` | URI and database from Vite variables, same-origin default |
| `templates/net/netClient.ts` | `src/net/` | Glue: version check, join, subscriptions, corrections, `NetStatus`, `state()` |
| `templates/net/cellSubscriptions.ts` | `src/net/` | Interest management by cells |
| `templates/net/remoteBees.ts` | `src/net/` | Replication buffers and interpolation |
| `templates/net/serverClock.ts` | `src/net/` | Time sync |
| `templates/net/poseReporter.ts` | `src/net/` | Pose sending and deviation check |
| `templates/entities/remoteBeeViews.ts` | `src/entities/` | Remote bees in the scene |

The module counterpart is `templates/server/` in skill `spacetimedb`; table and reducer names
in these files match it. `src/net/bindings/` comes from `spacetime generate` (skill
`spacetimedb-ops`, `make compile`).

## Rules

1. The network layer never blocks the frame: SDK callbacks store data, frame systems apply it.
2. The client keeps its own `Map`s from row callbacks; SDK `find()`/`filter()` scan whole
   tables.
3. One equality query per cell, never range or `OR` filters for areas.
4. Subscribe the new set before unsubscribing the old one.
5. The protocol version check runs before any table subscription; a mismatch stops
   reconnecting and asks for a reload.
6. Game connection: compression `none`, confirmed reads off.
7. The own bee is simulated locally and corrected only when the server disagrees by more than
   3 m; other bees render 2 ticks in the past.
8. Shared time of day and weather derive from the server tick and rare rows, never from
   per-tick writes.
9. Every class with callbacks, subscriptions or scene nodes has `dispose()`.

## Debug API extension

Dev and profile builds add `window.__game.net` to the contract in skill `babylon-game-dev`
(`references/debug-api.md`):

```ts
/** Netz-Steuerung für Prüf-Agenten und Tests (Netz-Debug). */
export interface NetDebugApi {
  state(): NetState; // Status, Identität, Spieler-ID, Server-Takt, Zahl sichtbarer Bienen
  dropConnection(): void; // Netzabbruch simulieren; die Sitzung verbindet selbst neu
}
```

`NetState` and both methods come from `NetClient`. Agents wait for `state().status ===
'online'` before judging multiplayer views.

## Reference files

| File | Content |
|---|---|
| [session.md](references/session.md) | Target URI, tokens (guest, OIDC), session lifecycle, `NetClient` flow, wiring into the game loop |
| [replication.md](references/replication.md) | Subscriptions, own registries, server clock, interpolation, events, shared time of day and weather |
| [movement.md](references/movement.md) | Validated client authority, reporting, server clamp, corrections, spawn and reconnect, view range, knobs |
