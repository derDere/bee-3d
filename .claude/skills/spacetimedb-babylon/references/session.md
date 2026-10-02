# Connection, tokens, reconnect, version check

Templates: `net/spacetimeSession.ts`, `net/browserSession.ts`, `net/netConfig.ts`,
`net/oidcTokenStore.ts`, `net/netClient.ts`. All of them passed `tsc` in strict mode against
generated 2.10.2 bindings; `NetClient` ran against a lab server [verified 2.10.2].

## Target

`resolveSessionOptions(import.meta.env, window.location)` (`netConfig.ts`):

| Environment | `VITE_SPACETIMEDB_HOST` | Result |
|---|---|---|
| Development (Vite on `127.0.0.1:5173`) | `ws://127.0.0.1:3000` in `.env` | Direct connection to the container port |
| Production behind the proxy | unset | `wss://<host>/stdb/` (same origin) |

- `VITE_SPACETIMEDB_HOST` and `VITE_SPACETIMEDB_DB_NAME` carry the names of the official
  SpacetimeDB Vite templates [source]. They live in the stack's `.env` and `env.example` (skill
  `dev-env`); Vite reads the same file. `src/vite-env.d.ts` declares both in `ImportMetaEnv`.
- The SDK resolves `v1/…` relative to the URI: a path prefix needs the trailing slash
  (`/stdb/`) [verified 2.10.2].
- The server answers CORS with `Access-Control-Allow-Origin: *`, so the development client on
  another port can exchange tokens [verified 2.10.2].
- Game connection: compression `none`, confirmed reads off (skill `spacetimedb-performance`,
  `references/tuning.md`).

## Tokens

| Store | Use | Behaviour |
|---|---|---|
| `BrowserTokenStore(uri, database)` | Guests | `localStorage` key `spacetimedb:<uri>:<database>:token`; memory fallback when storage is blocked |
| `OidcTokenStore(source)` | Accounts at an OIDC provider | `load()` returns the provider's current ID token on every connect; `clear()` asks for a new sign-in |
| `MemoryTokenStore` | Bots, tests | Token lives as long as the process |

- `onConnect` delivers the long-lived token; the session saves it. The short-lived WebSocket
  token from `POST /v1/identity/websocket-token` never reaches the store [source].
- A rejected token ("Failed to verify token", e.g. after the server's keys changed) is
  cleared, `onTokenRejected` fires, and the next attempt connects without a token: guests get a
  new identity and lose their progress (skill `spacetimedb-security`, `references/auth.md`).

## Session lifecycle

`SpacetimeSession` owns the `DbConnection` and rebuilds it; the vanilla SDK connection never
reconnects by itself [docs]:

- Backoff 1 s doubling to 30 s with jitter, reset after a successful connect.
- Callbacks of replaced connections are ignored (`pending`/`current` guards).
- `resumeNow()` replaces a socket that died without `onclose` (frozen background tab) and pulls
  a waiting reconnect forward. `bindPageLifecycle(net)` calls it on `visibilitychange`,
  `focus`, `online` and `pageshow` and returns a function that removes the listeners.
- A mid-session WebSocket error ends in `onDisconnect` from 2.10.0 on (release notes); the
  session treats every end the same way.

## NetClient flow

```
start → connecting → [onReady] protocolVersion() ─ mismatch → session.stop() → reload-required
                                    │ match
                                    ▼
          joining: subscribe own profile, join({ name }), attach RemoteBees and cell subscriptions
                                    │ own profile → playerId → subscribe own bee_state by primary key
                                    ▼
          online: first own row = spawn point → LocalBee.correctTo → poses flow, cells follow
[onLost] → reconnecting → backoff → onReady …
```

- The version check runs before any table subscription, so old client code never decodes rows
  of a changed schema (skill `spacetimedb-ops`, `references/lifecycle.md`).
- A failed `protocolVersion` call on a live connection counts as a mismatch: the module is
  older than the client.
- `onStatus` feeds the HUD; `reload-required` shows a reload button and nothing reconnects.
- `RemoteBees` survives reconnects: `attach` hooks the new connection, `detach` lets every bee
  run out with the 250 ms grace period unless the new subscription re-inserts it.
- `dropConnection()` closes the socket like a network failure; the session reconnects. The
  debug API exposes it for reconnect tests.

## Wiring

```ts
// src/core/game.ts (Ausschnitt) — Netzschicht anbinden
const options = resolveSessionOptions(import.meta.env, window.location);
const net = new NetClient(options, new BrowserTokenStore(options.uri, options.database), player, playerName, {
  onStatus: (status) => hud.showNetStatus(status),
  onBuzz: (playerId) => effects.buzzAt(net.remoteBees.poseOf(playerId) ?? player),
  onTokenRejected: () => hud.notice('Neues Gastkonto angelegt'),
});
loop.addFrame(net); // Korrektur, Zell-Abos, Posen
loop.addFrame(new RemoteBeeViews(net.remoteBees, net.clock, beeViewFactory, 2));
const unbindLifecycle = bindPageLifecycle(net);
net.start();
```

- `player` implements `LocalBee` (position, yaw, pitch in radians, `correctTo`).
- `NetClient` runs as a frame system: input and flight physics stay in the fixed step of the
  game loop (skill `babylon-gameplay`); the network layer reads the simulated pose once per
  rendered frame.
- `dispose()` on scene exit: `net.dispose()`, the views' `dispose()`, `unbindLifecycle()`.

## Node clients

`SpacetimeSession`, `MemoryTokenStore`, `CellSubscriptions` and `PoseReporter` run in Node 22+
(global `WebSocket`); the load-test bots use them (skill `spacetimedb-performance`).
`browserSession.ts` is browser-only.
